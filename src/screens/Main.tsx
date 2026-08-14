import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Globe, Moon, Settings as SettingsIcon } from "lucide-react";
import { useApp } from "../store";
import { useHostStatus } from "../lib/useHostStatus";
import { useConnect, type ConnectAction } from "../lib/useConnect";
import {
  api,
  hostWebUrl,
  onRdpEnded,
  onSessionSwitch,
  onStreamEnded,
  onStreamReconnect,
} from "../lib/api";
import { ActionCard } from "../components/ActionCard";
import { ConnectOverlay } from "../components/ConnectOverlay";
import { HostTotem, PlayScene, StreamScene, WorkScene } from "../components/artwork";
import { Button, Field, Toggle } from "../components/ui";
import { sounds } from "../lib/sounds";
import { webLinkLabel } from "../lib/flavour";
import { setSessionActive } from "../lib/calm";
import { t } from "../lib/i18n";

type Toast = {
  msg: string;
  tone: "ok" | "err";
  /** Optional inline action button ("Koble til igjen", "Legg i dvale"). */
  action?: { label: string; run: () => void };
} | null;

const EASE = [0.22, 1, 0.36, 1] as const;

/* The status word lives beside the cairn now — the flame shows life, the
   word names the state. Keys, not copy: this map is a module constant,
   evaluated before setLang() has run — t() must happen at render time. */
const STATE_LABEL_KEY: Record<string, string> = {
  offline: "mn.stateAsleep",
  waking: "mn.stateWaking",
  online: "mn.stateReady",
  in_use: "mn.stateInUse",
};
const STATE_COLOR: Record<string, string> = {
  offline: "var(--offline)",
  waking: "var(--waking)",
  online: "var(--online)",
  in_use: "var(--inuse)",
};

export function Main() {
  const activeHost = useApp((s) => s.activeHost());
  const setView = useApp((s) => s.setView);
  const patchHost = useApp((s) => s.patchHost);
  const host = activeHost;

  const { state: statusState } = useHostStatus(
    host?.address,
    undefined,
    host
      ? {
          hostId: host.id,
          onRelocated: (address) => {
            // DHCP gave the PC a new IP — adopt it and tell the user why the
            // address in the header just changed.
            patchHost(host.id, { address });
            showToast(t("mn.newAddress", { name: host.name, address }));
          },
        }
      : undefined
  );
  const connect = useConnect(
    host ?? null,
    (patch) => host && patchHost(host.id, patch),
    () => setSavedPassword(true)
  );
  const [sleepAvailable, setSleepAvailable] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [platform, setPlatform] = useState<string>("linux");
  const [askPassword, setAskPassword] = useState(false);
  const [savedPassword, setSavedPassword] = useState(false);
  const toastTimer = useRef<number | null>(null);
  /** The last stream action launched, for the "Koble til igjen" shortcut. */
  const lastStreamAction = useRef<ConnectAction | null>(null);
  // Guards the hot-switch: it takes seconds end to end, and a second press
  // mid-flight would kill the session the first one is still starting.
  const switching = useRef(false);

  // Reflect an in-progress wake as "waking" in the header.
  const headerState = connect.state.phase === "waking" ? "waking" : statusState;

  // Sound design lives on the connect state machine: each phase transition
  // has its own note, so you can hear the wake → launch → connected arc.
  // Keyed on the state object (every setState makes a fresh one) so an
  // error-after-retry that lands on the same phase still chimes; the
  // prev-guard keeps message-only updates within a phase silent.
  const prevPhase = useRef(connect.state.phase);
  useEffect(() => {
    const prev = prevPhase.current;
    const phase = connect.state.phase;
    prevPhase.current = phase;
    if (phase === "error") {
      sounds.error();
      return;
    }
    if (prev === phase) return;
    if (phase === "waking") sounds.wake();
    else if (phase === "launching") sounds.launch();
    else if (phase === "launched") sounds.success();
    else if (phase === "pick_app") sounds.click();
  }, [connect.state]);

  useEffect(() => {
    api
      .checkDependencies()
      .then((d) => setPlatform(d.platform))
      .catch(() => {});
  }, []);

  // The backend relaunches a stream that died right after starting (the
  // login-screen drop). Tell the user why the picture blinked.
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | null = null;
    onStreamReconnect(() => {
      sounds.launch();
      showToast(t("mn.streamReconnecting"));
    }).then((u) => {
      if (alive) unlisten = u;
      else u();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A stream's process exited (Moonlight closed, crashed, or the network
  // dropped): bring the launcher back to the front and offer the natural
  // follow-up — reconnect after a drop, or sleep the PC after a real session.
  // The listener registers once and reads live state through a ref: the host's
  // address can be relocated at any time, and a render-frozen closure would
  // reconnect against the old IP.
  const streamEndCtx = useRef({ connect, host, sleepAvailable });
  streamEndCtx.current = { connect, host, sleepAvailable };
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | null = null;
    onStreamEnded(({ elapsedSecs, errored }) => {
      if (!alive) return;
      // A hot-switch ends the stream on purpose — don't offer to reconnect to
      // the thing the user just asked us to leave.
      if (switching.current) return;
      const ctx = streamEndCtx.current;
      api.focusSelf().catch(() => {});
      const reconnect = {
        label: t("mn.reconnect"),
        run: () => {
          sounds.click();
          streamEndCtx.current.connect.start(lastStreamAction.current ?? "play");
        },
      };
      if (errored) {
        sounds.error();
        showToast(t("mn.streamDropped"), "err", {
          action: reconnect,
          duration: 12_000,
        });
      } else if (elapsedSecs < 300) {
        // A clean exit within a few minutes — likely not a finished session.
        sounds.click();
        showToast(t("mn.streamEnded"), "ok", {
          action: reconnect,
          duration: 10_000,
        });
      } else if (ctx.sleepAvailable && ctx.host) {
        sounds.click();
        showToast(
          t("mn.doneForTonight", { name: ctx.host.name }),
          "ok",
          {
            action: {
              label: t("mn.putToSleep"),
              run: async () => {
                const h = streamEndCtx.current.host;
                if (!h) return;
                try {
                  await api.sleepHost(h.id);
                  sounds.sleep();
                  showToast(t("mn.goingToSleep", { name: h.name }));
                } catch (e) {
                  sounds.error();
                  showToast(String(e), "err");
                }
              },
            },
            duration: 15_000,
          }
        );
      }
    }).then((u) => {
      if (alive) unlisten = u;
      else u();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The remote-desktop window closed. Windows leaves that session holding the
  // desktop, so until it is moved back to the console, streaming captures a
  // black screen. Success is silent — this only speaks up when the handover
  // failed, while the user is still here to retry it.
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | null = null;
    onRdpEnded(({ reclaimed, error }) => {
      if (!alive) return;
      // Mid-switch the console handover is done by the switch itself, and
      // pulling the launcher forward would land it on top of the stream we
      // are starting.
      if (switching.current) return;
      api.focusSelf().catch(() => {});
      if (reclaimed) return;
      sounds.error();
      showToast(error ?? t("mn.consoleNotReclaimed"), "err", {
        action: {
          label: t("mn.tryAgain"),
          run: async () => {
            const h = streamEndCtx.current.host;
            if (!h) return;
            try {
              await api.reclaimConsole(h.id);
              sounds.success();
              showToast(t("mn.consoleReclaimed"));
            } catch (e) {
              sounds.error();
              showToast(String(e), "err");
            }
          },
        },
        duration: 15_000,
      });
    }).then((u) => {
      if (alive) unlisten = u;
      else u();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The global shortcut fired: swap streaming <-> remote desktop in place.
  // Arrives as an event rather than a keypress because the launcher window is
  // behind a fullscreen client whenever a session is actually running.
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | null = null;
    onSessionSwitch(async () => {
      if (!alive) return;
      const h = streamEndCtx.current.host;
      // A switch takes a few seconds end to end; a second press mid-flight
      // would kill the session we are in the middle of starting.
      if (!h || switching.current) return;
      switching.current = true;
      sounds.click();
      try {
        const r = await api.switchSession(h.id);
        // The rdp:ended/stream:ended fired during the switch cleared the
        // session flag; the new leg is up, so set it back.
        setSessionActive(true);
        sounds.success();
        showToast(r.detail);
      } catch (e) {
        sounds.error();
        showToast(String(e), "err", { duration: 8_000 });
      } finally {
        switching.current = false;
      }
    }).then((u) => {
      if (alive) unlisten = u;
      else u();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Identify the host software once, the first time the PC is reachable, so
  // the UI can call it by its actual name instead of guessing. Cached on the
  // host afterwards; failure just leaves the copy neutral.
  useEffect(() => {
    if (!host || host.flavour || statusState === "offline") return;
    let alive = true;
    api
      .detectFlavour(host.id)
      .then((f) => {
        if (alive && f) patchHost(host.id, { flavour: f });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [host?.id, host?.flavour, statusState, patchHost]);

  // Is an RDP password already saved in the OS keyring?
  useEffect(() => {
    let alive = true;
    setSavedPassword(false);
    const hid = host?.id;
    if (hid) {
      api
        .hasRdpPassword(hid)
        .then((v) => alive && setSavedPassword(v))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [host?.id]);

  useEffect(() => {
    let alive = true;
    setSleepAvailable(false);
    const hid = host?.id;
    if (hid && host?.ssh) {
      api
        .checkSsh(hid)
        .then((ok) => alive && setSleepAvailable(ok))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [host?.id, host?.ssh]);

  function showToast(
    msg: string,
    tone: "ok" | "err" = "ok",
    opts?: { action?: { label: string; run: () => void }; duration?: number }
  ) {
    if (toastTimer.current != null) window.clearTimeout(toastTimer.current);
    setToast({ msg, tone, action: opts?.action });
    toastTimer.current = window.setTimeout(
      () => setToast(null),
      opts?.duration ?? 3200
    );
  }

  if (!host) return null;
  const pc = host;

  function run(action: ConnectAction) {
    sounds.click();
    if (action !== "work") lastStreamAction.current = action;
    if (action === "work" && platform !== "windows" && !savedPassword) {
      // FreeRDP needs the password up front (mstsc prompts natively on
      // Windows). Collected in-app; saved to the OS keyring only if the
      // user opts in. With a saved password, Work is one click.
      setAskPassword(true);
      return;
    }
    connect.start(action);
  }

  async function sleepPc() {
    try {
      await api.sleepHost(pc.id);
      sounds.sleep();
      showToast(t("mn.goingToSleep", { name: pc.name }));
    } catch (e) {
      sounds.error();
      showToast(String(e), "err");
    }
  }

  // Keyboard shortcuts: 1/2/3 launch, W wake, S settings.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (connect.state.phase !== "idle" || askPassword) return;
      switch (e.key) {
        case "1":
          run("play");
          break;
        case "2":
          run("desktop");
          break;
        case "3":
          run("work");
          break;
        case "s":
        case "S":
          setView("settings");
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connect.state.phase, askPassword, platform, pc.id, savedPassword]);

  return (
    <div className="app-shell">
      <div className="scroll-area">
        <motion.div
          className="page"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE }}
        >
          {/* Header: the totem tells the state before you read a word */}
          <header
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 38,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <HostTotem state={headerState} size={78} />
              <div>
                <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.015em" }}>{pc.name}</h1>
                <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginTop: 4 }}>
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={headerState}
                      initial={{ opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -3 }}
                      transition={{ duration: 0.18, ease: EASE }}
                      style={{
                        color: STATE_COLOR[headerState],
                        fontSize: 13.5,
                        fontWeight: 650,
                      }}
                    >
                      {t(STATE_LABEL_KEY[headerState])}
                    </motion.span>
                  </AnimatePresence>
                  <span className="text-3" style={{ fontSize: 12 }}>·</span>
                  <span className="text-3 mono" style={{ fontSize: 12 }}>{pc.address}</span>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button
                className="icon-btn"
                aria-label={t("mn.settings")}
                onClick={() => {
                  sounds.click();
                  setView("settings");
                }}
              >
                <SettingsIcon size={19} strokeWidth={1.75} />
              </button>
            </div>
          </header>

          {/* De tre dørene */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(215px, 1fr))", gap: 14 }}>
            <ActionCard
              index={0}
              art={<PlayScene />}
              tint="rgba(139, 123, 255, 0.10)"
              beam="rgba(139, 123, 255, 0.9)"
              title={t("mn.play")}
              sub={t("mn.playSub", { app: pc.steamAppName })}
              keycap="1"
              onClick={() => run("play")}
            />
            <ActionCard
              index={1}
              art={<StreamScene />}
              tint="rgba(79, 216, 232, 0.09)"
              beam="rgba(79, 216, 232, 0.9)"
              title={t("mn.desktop")}
              sub={t("mn.desktopSub")}
              keycap="2"
              onClick={() => run("desktop")}
            />
            <ActionCard
              index={2}
              art={<WorkScene />}
              tint="rgba(243, 183, 59, 0.08)"
              beam="rgba(243, 183, 59, 0.85)"
              title={t("mn.work")}
              sub={t("mn.workSub")}
              keycap="3"
              onClick={() => run("work")}
            />
          </div>

          {/* Utility row: words, not icons */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.32, duration: 0.4 }}
            style={{
              display: "flex",
              gap: 6,
              justifyContent: "center",
              alignItems: "center",
              marginTop: 30,
              flexWrap: "wrap",
            }}
          >
            {sleepAvailable && (
              <>
                <button className="btn btn-quiet" onClick={sleepPc}>
                  <Moon size={16} strokeWidth={1.9} />
                  {t("mn.putToSleep")}
                </button>
                <span className="text-3" aria-hidden="true">·</span>
              </>
            )}
            <button
              className="btn btn-quiet"
              onClick={() => {
                sounds.click();
                api.openUrl(hostWebUrl(pc.address));
              }}
            >
              <Globe size={16} strokeWidth={1.9} />
              {webLinkLabel(pc)}
            </button>
          </motion.div>
        </motion.div>
      </div>

      <ConnectOverlay
        state={connect.state}
        host={pc}
        onClose={connect.reset}
        onRetry={connect.retry}
        onPickApp={connect.pickApp}
        onReenterPassword={async () => {
          // Stale saved password (e.g. the Windows account password changed):
          // forget it and collect a fresh one.
          await api.forgetRdpPassword(pc.id).catch(() => {});
          setSavedPassword(false);
          connect.reset();
          if (platform !== "windows") setAskPassword(true);
        }}
      />

      <AnimatePresence>
        {askPassword && (
          <PasswordSheet
            username={pc.rdpUsername ?? ""}
            onCancel={() => setAskPassword(false)}
            onSubmit={(pw, remember) => {
              setAskPassword(false);
              // Storage happens inside the connect flow — only after the launch
              // succeeds, so a mistyped password is never persisted.
              connect.start("work", { password: pw, remember });
            }}
          />
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.22, ease: EASE }}
            style={{
              position: "fixed",
              bottom: 26,
              left: "50%",
              transform: "translateX(-50%)",
              padding: "12px 18px",
              borderRadius: 999,
              fontSize: 13.5,
              fontWeight: 500,
              background: "var(--surface-2)",
              border: `1px solid ${
                toast.tone === "err"
                  ? "rgba(255,107,107,0.35)"
                  : "var(--hairline-strong)"
              }`,
              color: toast.tone === "err" ? "#ffb4b4" : "var(--text)",
              backdropFilter: "blur(20px)",
              zIndex: 60,
              display: "flex",
              alignItems: "center",
              gap: 12,
              maxWidth: "min(92vw, 560px)",
            }}
          >
            <span>{toast.msg}</span>
            {toast.action && (
              <button
                className="btn btn-ghost"
                style={{ padding: "5px 13px", fontSize: 13, flex: "none" }}
                onClick={() => {
                  if (toastTimer.current != null)
                    window.clearTimeout(toastTimer.current);
                  setToast(null);
                  toast.action!.run();
                }}
              >
                {toast.action.label}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** RDP password prompt. By default the password is remembered in the OS
 *  keyring (GNOME Keyring / Credential Manager) so Work becomes one click;
 *  untick to use it once and keep nothing. Never written to settings.json. */
function PasswordSheet({
  username,
  onCancel,
  onSubmit,
}: {
  username: string;
  onCancel: () => void;
  onSubmit: (password: string, remember: boolean) => void;
}) {
  const [pw, setPw] = useState("");
  const [remember, setRemember] = useState(true);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <motion.div
      className="overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.form
        ref={formRef}
        className="dialog"
        style={{ width: "100%", maxWidth: 400, padding: "32px 30px" }}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 6 }}
        transition={{ duration: 0.24, ease: EASE }}
        onSubmit={(e) => {
          e.preventDefault();
          if (pw) {
            sounds.click();
            onSubmit(pw, remember);
          }
        }}
      >
        <h2 style={{ fontSize: 20 }}>{t("mn.signInWindows")}</h2>
        <p className="text-2" style={{ marginTop: 6, fontSize: 13.5 }}>
          {username ? (
            <>
              {t("mn.connectingAs")}{" "}
              <strong style={{ color: "var(--text)" }}>{username}</strong>
            </>
          ) : (
            t("mn.enterWindowsPassword")
          )}
        </p>
        <div style={{ marginTop: 18 }}>
          <Field label={t("mn.password")} type="password" value={pw} onChange={setPw} autoFocus />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 16,
          }}
        >
          <Toggle on={remember} onChange={setRemember} />
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 550 }}>{t("mn.rememberOnThisMachine")}</div>
            <div className="text-3" style={{ fontSize: 12, marginTop: 2 }}>
              {remember ? t("mn.rememberOnDetail") : t("mn.rememberOffDetail")}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 22 }}>
          <Button variant="quiet" onClick={onCancel}>
            {t("mn.cancel")}
          </Button>
          <Button variant="primary" type="submit" disabled={!pw}>
            {t("mn.connect")}
          </Button>
        </div>
      </motion.form>
    </motion.div>
  );
}
