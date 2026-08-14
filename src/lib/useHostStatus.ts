import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { isCalm } from "./calm";
import type { HostState, HostStatus } from "../types";

const POLL_MS = 5000;
/** Poll interval while a session runs or the window is hidden — the status is
 *  either known (in use) or nobody is looking at it. */
const POLL_CALM_MS = 45_000;
/** Consecutive offline polls before we suspect a stale IP and try mDNS. */
const HEAL_OFFLINE_STREAK = 4;
/** Minimum time between relocation attempts — the PC being asleep also looks
 *  offline, and there's no point browsing mDNS every few seconds for it. */
const HEAL_COOLDOWN_MS = 5 * 60_000;

export interface HealOptions {
  hostId: string;
  /** Called when the host was found at a different address (MAC-verified). */
  onRelocated: (address: string) => void;
}

/**
 * Poll a host's status every 5s, plus an instant refresh whenever the window
 * regains focus. `override` lets callers force a transient state (e.g. "waking"
 * during an active wake) without waiting for the next poll.
 *
 * With `heal` set, a sustained offline streak triggers an mDNS re-discovery:
 * if the host answers from a new IP (DHCP drift), `onRelocated` fires so the
 * caller can patch the saved address.
 */
export function useHostStatus(
  address: string | undefined,
  override?: HostState,
  heal?: HealOptions
) {
  const [status, setStatus] = useState<HostStatus | null>(null);
  const inFlight = useRef(false);
  const healRef = useRef(heal);
  healRef.current = heal;
  const offlineStreak = useRef(0);
  const lastHealAttempt = useRef(0);
  const healing = useRef(false);

  useEffect(() => {
    if (!address) {
      setStatus(null);
      return;
    }
    let alive = true;
    offlineStreak.current = 0;

    const maybeHeal = async () => {
      const h = healRef.current;
      if (!h || healing.current) return;
      if (offlineStreak.current < HEAL_OFFLINE_STREAK) return;
      const now = Date.now();
      if (now - lastHealAttempt.current < HEAL_COOLDOWN_MS) return;
      lastHealAttempt.current = now;
      healing.current = true;
      try {
        const found = await api.relocateHost(h.hostId);
        if (alive && found && found !== address) {
          healRef.current?.onRelocated(found);
        }
      } catch {
        /* discovery unavailable — try again after the cooldown */
      } finally {
        healing.current = false;
      }
    };

    const tick = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const s = await api.hostStatus(address);
        if (alive) {
          setStatus(s);
          if (s.reachable) {
            offlineStreak.current = 0;
          } else {
            offlineStreak.current++;
            void maybeHeal();
          }
        }
      } catch {
        /* transient — keep last known status */
      } finally {
        inFlight.current = false;
      }
    };

    // A timeout chain instead of setInterval, so each round can pick its
    // delay from the current calm state.
    let timer: number | undefined;
    const loop = async () => {
      await tick();
      if (!alive) return;
      timer = window.setTimeout(loop, isCalm() ? POLL_CALM_MS : POLL_MS);
    };
    loop();
    const onFocus = () => tick();
    window.addEventListener("focus", onFocus);

    return () => {
      alive = false;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [address]);

  const state: HostState = override ?? status?.state ?? "offline";
  return { status, state };
}
