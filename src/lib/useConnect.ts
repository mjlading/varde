import { useRef, useState } from "react";
import { api } from "./api";
import { describeAutoQuality, displayHint } from "./display";
import { serviceQuestion } from "./flavour";
import { setSessionActive } from "./calm";
import { t } from "./i18n";
import type { Host, WakeReport } from "../types";

export type ConnectAction = "play" | "desktop" | "work";

export type ConnectPhase =
  | "idle"
  | "waking"
  | "launching"
  | "launched"
  | "pick_app"
  | "error";

export interface ConnectState {
  phase: ConnectPhase;
  action: ConnectAction | null;
  message: string;
  error?: string;
  wakeTimedOut?: boolean;
  /** Populated in the pick_app phase: the host's real app list. */
  apps?: string[];
  /** Set during the waking phase: when the wake started (epoch ms) and the
   *  expected duration from the last successful wake, for the progress bar. */
  wakeStartedAt?: number;
  wakeExpectedMs?: number | null;
}

export interface StartOptions {
  /** RDP password for this launch. */
  password?: string;
  /** If true, persist the password to the OS keyring — but only AFTER the
   *  launch succeeds, so a mistyped password is never saved. */
  remember?: boolean;
}

const WAKE_TIMEOUT_MS = 90_000;
/** Re-send the magic packet this often while waiting — WoL over WiFi
 *  (WoWLAN) drops packets, and re-sending is free and idempotent. */
const WAKE_RESEND_MS = 6_000;
/** If the host hasn't shown any network sign of life by these marks, try to
 *  re-find it via mDNS (the saved IP may be stale after a DHCP change). */
const RELOCATE_AT_MS = [12_000, 45_000];

// Keys, not copy: this map is a module constant, evaluated before setLang()
// has run — t() must happen at use time, not here.
const ACTION_TITLE_KEY: Record<ConnectAction, string> = {
  play: "mn.play",
  desktop: "mn.desktop",
  work: "mn.work",
};

const IDLE: ConnectState = { phase: "idle", action: null, message: "" };

export function useConnect(
  host: Host | null,
  onHostPatch?: (patch: Partial<Host>) => void,
  onPasswordSaved?: () => void
) {
  const [state, setState] = useState<ConnectState>(IDLE);
  const attempt = useRef(0);
  const password = useRef<string | undefined>(undefined);
  const remember = useRef(false);
  // Callbacks captured by older renders (e.g. a toast's "Koble til igjen"
  // action) must see the host as it is NOW — the address can change at any
  // time via relocation — so every entry point reads through this ref
  // instead of trusting the render-time prop.
  const hostRef = useRef(host);
  hostRef.current = host;

  const reset = () => {
    attempt.current++;
    password.current = undefined;
    remember.current = false;
    setState(IDLE);
  };

  async function start(action: ConnectAction, opts: StartOptions = {}) {
    const host = hostRef.current;
    if (!host) return;
    const token = ++attempt.current;
    password.current = opts.password;
    remember.current = opts.remember ?? false;

    // 1. Probe. Three cases: service ready → launch; awake but service down →
    //    a wake won't help, say what's actually wrong; unreachable → wake it.
    let inUse = false;
    try {
      const status = await api.hostStatus(host.address);
      if (token !== attempt.current) return;
      inUse = status.inUse;
      const ready = action === "work" ? status.rdpOpen : status.streamOpen;
      if (ready) {
        await doLaunch(action, token, inUse);
        return;
      }
      if (status.reachable) {
        setState({
          phase: "error",
          action,
          message: "",
          error:
            action === "work"
              ? t("mn.awakeRdpDown")
              : `${t("mn.awakeStreamDown")} ${serviceQuestion(host)}`,
        });
        return;
      }
    } catch {
      /* treat as offline and try to wake */
    }

    // 2. Offline — wake it. Magic packets need a MAC, but the HTTP and relay
    //    transports don't, so only bail when nothing at all is set up.
    const canWake =
      host.macs.length > 0 || host.wake?.http != null || host.wake?.relay != null;
    if (!canWake) {
      setState({
        phase: "error",
        action,
        message: "",
        error: t("mn.noWakeMethod"),
      });
      return;
    }

    const wakeStart = Date.now();
    const waking = (message: string) =>
      setState({
        phase: "waking",
        action,
        message,
        wakeStartedAt: wakeStart,
        wakeExpectedMs: host.lastWakeMs ?? null,
      });

    waking(t("mn.sendingWakeSignal", { name: host.name }));

    let report: WakeReport | null = null;
    try {
      report = await api.wake(host.id, host.address);
    } catch (e) {
      if (token !== attempt.current) return;
      setState({ phase: "error", action, message: "", error: String(e) });
      return;
    }

    if (token !== attempt.current) return;
    // Name the transport when it wasn't a plain magic packet — knowing the
    // webhook or relay answered is the difference between confidence and
    // staring at a spinner when you're away from home.
    const remote = report?.attempts.find((a) => a.ok && a.method !== "wol");
    waking(
      remote
        ? t("mn.remoteWakeWaiting", { detail: remote.detail })
        : t("mn.waitingForWake")
    );

    // Staged wait: poll the full host status instead of one blocking port
    // wait, so we can (a) narrate milestones — answering the network vs the
    // service being up, (b) re-send the magic packet in case the first one
    // was dropped, and (c) self-heal a stale IP via mDNS along the way.
    let addr = host.address;
    let reachedNetwork = false;
    let opened = false;
    let lastResend = wakeStart;
    let relocateIdx = 0;
    let relocated = false;

    while (Date.now() - wakeStart < WAKE_TIMEOUT_MS) {
      try {
        const st = await api.hostStatus(addr);
        if (token !== attempt.current) return;
        const ready = action === "work" ? st.rdpOpen : st.streamOpen;
        if (ready) {
          opened = true;
          break;
        }
        if (st.reachable && !reachedNetwork) {
          reachedNetwork = true;
          waking(t("mn.pcOnNetwork"));
        }
      } catch {
        /* transient probe failure — keep waiting */
      }
      if (token !== attempt.current) return;

      const now = Date.now();
      if (now - lastResend >= WAKE_RESEND_MS) {
        lastResend = now;
        api.wake(host.id, addr).catch(() => {});
      }

      if (
        !reachedNetwork &&
        relocateIdx < RELOCATE_AT_MS.length &&
        now - wakeStart >= RELOCATE_AT_MS[relocateIdx]
      ) {
        relocateIdx++;
        try {
          const found = await api.relocateHost(host.id);
          if (token !== attempt.current) return;
          if (found && found !== addr) {
            addr = found;
            relocated = true;
            onHostPatch?.({ address: found });
            waking(t("mn.foundNewAddress", { name: host.name, address: found }));
          }
        } catch {
          /* discovery unavailable — keep polling the saved address */
        }
      }

      await new Promise((r) => window.setTimeout(r, 1500));
      if (token !== attempt.current) return;
    }

    if (!opened) {
      setState({
        phase: "error",
        action,
        message: "",
        wakeTimedOut: !reachedNetwork,
        error: reachedNetwork
          ? action === "work"
            ? t("mn.wokeRdpDown")
            : `${t("mn.wokeStreamDown")} ${serviceQuestion(host)}`
          : t("mn.wakeFailed", { action: t(ACTION_TITLE_KEY[action]) }),
      });
      return;
    }

    // Remember how long the wake took, to calibrate next time's progress bar —
    // but only when this was a real wake: a relocation-assisted recovery
    // measures IP repair (the PC was already awake), and a near-instant
    // "wake" means the initial probe just misfired against an awake host.
    const wakeElapsed = Date.now() - wakeStart;
    if (!relocated && wakeElapsed >= 5_000) {
      onHostPatch?.({ lastWakeMs: wakeElapsed });
    }

    await doLaunch(action, token, false);
  }

  /** Resolve the configured app name against the host's real app list. */
  async function resolveAppName(
    action: "play" | "desktop",
    token: number
  ): Promise<string | null> {
    const host = hostRef.current;
    if (!host) return null;
    const configured = action === "play" ? host.steamAppName : host.desktopAppName;
    let apps: string[] = [];
    try {
      apps = await api.listApps(host.id);
    } catch {
      // Can't list (e.g. not paired yet) — try the configured name as-is and
      // let the launch error explain if it's wrong.
      return configured;
    }
    if (token !== attempt.current) return null;
    if (apps.length === 0) return configured;

    const lc = configured.toLowerCase();
    const exact = apps.find((a) => a.toLowerCase() === lc);
    if (exact) return exact;

    // Fuzzy: "Steam" → "Steam Big Picture", "Desktop" → "Low Res Desktop", etc.
    const keyword = action === "play" ? "steam" : "desktop";
    const fuzzy =
      apps.find((a) => a.toLowerCase().includes(lc)) ??
      apps.find((a) => a.toLowerCase().includes(keyword));
    if (fuzzy) {
      // Self-heal the saved name so next launch is exact.
      onHostPatch?.(action === "play" ? { steamAppName: fuzzy } : { desktopAppName: fuzzy });
      return fuzzy;
    }

    // Nothing sensible — hand the real list to the user.
    setState({ phase: "pick_app", action, message: "", apps });
    return null;
  }

  async function doLaunch(action: ConnectAction, token: number, inUse: boolean) {
    const host = hostRef.current;
    if (!host) return;
    setState({
      phase: "launching",
      action,
      message:
        action === "work" ? t("mn.openingRdp") : t("mn.startingMoonlight"),
    });
    try {
      if (action === "work") {
        await api.launchRdp(host.id, password.current);
        // Launch didn't fail fast (FreeRDP rejects bad auth in ~200ms, well
        // inside the backend's 2.5s watch window) — safe to remember now.
        if (remember.current && password.current) {
          try {
            await api.storeRdpPassword(host.id, password.current);
            onPasswordSaved?.();
          } catch {
            /* keyring hiccup — the connection still went through */
          }
        }
      } else {
        const appName = await resolveAppName(action, token);
        if (appName == null) return; // pick_app took over (or attempt superseded)

        // Two host states produce an identical black stream and neither is
        // fixed by reconnecting: nobody logged in (a PC that just woke sits at
        // the Windows login screen), or a desktop parked on an RDP session
        // instead of the console. Sort both out before Moonlight starts.
        // Best-effort — without SSH we can't tell, and the stream may be fine.
        if (host.ssh) {
          setState({ phase: "launching", action, message: t("mn.preparingPc") });
          try {
            const prep = await api.prepareForStream(host.id, password.current);
            if (token !== attempt.current) return;
            if (prep.action === "loggedIn" || prep.action === "reclaimed") {
              setState({
                phase: "launching",
                action,
                message: t("mn.prepDoneStarting", { detail: prep.detail }),
              });
            }
          } catch {
            /* couldn't prepare — let the launch try anyway */
          }
          if (token !== attempt.current) return;
        }

        if (inUse) {
          // Switching streams: end the current app first so Moonlight doesn't
          // refuse with "another app is running".
          await api.quitApp(host.id).catch(() => {});
        }
        // Measure the client display so the Auto preset streams at native
        // resolution and refresh rate (cached after the first launch).
        const hint = await displayHint();
        if (token !== attempt.current) return;
        if (host.qualityPreset === "auto") {
          setState({
            phase: "launching",
            action,
            message: t("mn.startingMoonlightQuality", {
              quality: describeAutoQuality(hint),
            }),
          });
        }
        await api.launchStream(host.id, appName, hint);
      }
      if (token !== attempt.current) return;
      setSessionActive(true);
      setState({
        phase: "launched",
        action,
        message: action === "work" ? t("mn.rdpOpening") : t("mn.enjoy"),
      });
      window.setTimeout(() => {
        if (token === attempt.current) reset();
      }, 1400);
    } catch (e) {
      if (token !== attempt.current) return;
      setState({ phase: "error", action, message: "", error: String(e) });
    }
  }

  /** Called from the pick_app UI with the user's choice. Saves it and launches. */
  async function pickApp(appName: string) {
    const host = hostRef.current;
    if (!host) return;
    const action = state.action;
    if (action !== "play" && action !== "desktop") return;
    onHostPatch?.(action === "play" ? { steamAppName: appName } : { desktopAppName: appName });
    const token = ++attempt.current;
    setState({ phase: "launching", action, message: t("mn.startingMoonlight") });
    try {
      const hint = await displayHint();
      await api.launchStream(host.id, appName, hint);
      if (token !== attempt.current) return;
      setSessionActive(true);
      setState({ phase: "launched", action, message: t("mn.enjoy") });
      window.setTimeout(() => {
        if (token === attempt.current) reset();
      }, 1400);
    } catch (e) {
      if (token !== attempt.current) return;
      setState({ phase: "error", action, message: "", error: String(e) });
    }
  }

  function retry() {
    if (state.action) start(state.action);
  }

  return { state, start, retry, reset, pickApp };
}
