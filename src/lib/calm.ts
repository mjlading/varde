// Calm mode: the launcher's idle discipline.
//
// While a stream or remote-desktop session runs, every CPU cycle the launcher
// burns is stolen from video decoding — and nobody is looking at the launcher
// anyway. The same goes for a hidden window. "Calm" is that one shared fact:
// session running OR window hidden. Consumers use it to freeze ambient
// animation and slow the status poll; everything resumes the moment the user
// is actually back.

import { create } from "zustand";
import { api, onRdpEnded, onStreamEnded } from "./api";

interface CalmState {
  sessionActive: boolean;
  hidden: boolean;
}

export const useCalmStore = create<CalmState>(() => ({
  sessionActive: false,
  hidden: document.visibilityState === "hidden",
}));

/** True when ambient work should stop. */
export function useCalm(): boolean {
  return useCalmStore((s) => s.sessionActive || s.hidden);
}

/** Non-reactive read, for timers deciding their next delay. */
export function isCalm(): boolean {
  const s = useCalmStore.getState();
  return s.sessionActive || s.hidden;
}

export function setSessionActive(active: boolean) {
  useCalmStore.setState({ sessionActive: active });
}

/** How often a session marked active is re-verified against the backend —
 *  events can be missed (a listener torn down mid-switch, a crashed client),
 *  and a stuck "calm" would freeze the UI forever. */
const RESYNC_MS = 60_000;

async function resync() {
  try {
    const kind = await api.currentSession();
    setSessionActive(kind != null);
  } catch {
    /* backend briefly unavailable — keep the current belief */
  }
}

/** Wire the calm sources once, from App. Returns the teardown. */
export function initCalm(): () => void {
  let alive = true;
  const unlistens: (() => void)[] = [];

  const onVisibility = () => {
    useCalmStore.setState({ hidden: document.visibilityState === "hidden" });
    // Coming back into view is the moment a stale sessionActive would be
    // visible as a frozen UI — verify it right away.
    if (document.visibilityState === "visible") void resync();
  };
  document.addEventListener("visibilitychange", onVisibility);

  // Session end is pushed by the backend watchers; start is set by useConnect
  // at launch. The events fire regardless of which screen is mounted.
  onStreamEnded(() => setSessionActive(false)).then((u) => {
    if (alive) unlistens.push(u);
    else u();
  });
  onRdpEnded(() => setSessionActive(false)).then((u) => {
    if (alive) unlistens.push(u);
    else u();
  });

  // Belt and braces: while a session is believed active, confirm it exists.
  const timer = window.setInterval(() => {
    if (useCalmStore.getState().sessionActive) void resync();
  }, RESYNC_MS);

  void resync();

  return () => {
    alive = false;
    document.removeEventListener("visibilitychange", onVisibility);
    window.clearInterval(timer);
    unlistens.forEach((u) => u());
  };
}
