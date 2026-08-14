import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { DisplayHint } from "./display";
import type {
  DependencyStatus,
  DiscoveredHost,
  HostStatus,
  PairResult,
  PrepareReport,
  ProbeResult,
  SessionKind,
  Settings,
  SwitchReport,
  WakeCheck,
  WakeReport,
} from "../types";

export const PORT_STREAM = 47989;
export const PORT_RDP = 3389;

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),

  discoverHosts: (timeoutMs = 4000) =>
    invoke<DiscoveredHost[]>("discover_hosts", { timeoutMs }),
  probeHost: (address: string) => invoke<ProbeResult>("probe_host", { address }),
  resolveMac: (address: string) => invoke<string | null>("resolve_mac", { address }),
  hostStatus: (address: string) => invoke<HostStatus>("host_status", { address }),

  /** Wake a PC through every transport it has configured (magic packets, HTTP
   *  endpoint, SSH relay). `address` overrides the saved one mid-relocation. */
  wake: (hostId: string, address?: string) =>
    invoke<WakeReport>("wake", { hostId, address: address ?? null }),
  /** Re-find a host whose saved IP went stale (DHCP drift): mDNS discovery,
   *  MAC-verified. Resolves to the new address, or null if not found. */
  relocateHost: (hostId: string) =>
    invoke<string | null>("relocate_host", { hostId }),
  waitForPort: (address: string, port: number, timeoutMs: number) =>
    invoke<boolean>("wait_for_port", { address, port, timeoutMs }),

  checkDependencies: () => invoke<DependencyStatus>("check_dependencies"),

  startPairing: (address: string) => invoke<PairResult>("start_pairing", { address }),

  launchStream: (hostId: string, appName: string, displayHint?: DisplayHint) =>
    invoke<void>("launch_stream", { hostId, appName, displayHint: displayHint ?? null }),
  listApps: (hostId: string) => invoke<string[]>("list_apps", { hostId }),
  launchRdp: (hostId: string, password?: string) =>
    invoke<void>("launch_rdp", { hostId, password: password ?? null }),
  hasRdpPassword: (hostId: string) => invoke<boolean>("has_rdp_password", { hostId }),
  storeRdpPassword: (hostId: string, password: string) =>
    invoke<void>("store_rdp_password", { hostId, password }),
  forgetRdpPassword: (hostId: string) => invoke<void>("forget_rdp_password", { hostId }),
  quitApp: (hostId: string) => invoke<void>("quit_app", { hostId }),

  sleepHost: (hostId: string) => invoke<void>("sleep_host", { hostId }),
  checkSsh: (hostId: string) => invoke<boolean>("check_ssh", { hostId }),
  /** Identify the host software ("Sunshine" / "Apollo") for UI copy. */
  detectFlavour: (hostId: string) => invoke<string | null>("detect_flavour", { hostId }),
  /** Check the Windows settings that decide whether Wake-on-LAN can work.
   *  Needs the PC awake and reachable over SSH. */
  diagnoseWake: (hostId: string) => invoke<WakeCheck[]>("diagnose_wake", { hostId }),
  /** Read the host-side registry state that decides RDP picture quality:
   *  is AVC444 allowed, and is the frame-rate cap raised to 60? Needs SSH. */
  rdpHostCheck: (hostId: string) => invoke<WakeCheck[]>("rdp_host_check", { hostId }),
  /** Apply both host-side quality settings, then re-read the state. */
  rdpHostOptimize: (hostId: string) => invoke<WakeCheck[]>("rdp_host_optimize", { hostId }),
  /** Hand the desktop back to the physical console, so streaming can capture
   *  the screen again after a remote-desktop session. Requires SSH. */
  reclaimConsole: (hostId: string) => invoke<void>("reclaim_console", { hostId }),
  /** Make sure someone is logged in and their desktop is on the console, so
   *  the stream has something real to capture. Needs SSH; best-effort. */
  prepareForStream: (hostId: string, password?: string) =>
    invoke<PrepareReport>("prepare_for_stream", { hostId, password: password ?? null }),

  /** Which leg is up right now, if any. */
  currentSession: () => invoke<SessionKind | null>("current_session"),
  /** Swap the running session for the other kind. The two can't coexist —
   *  streaming captures the console, RDP moves the desktop off it — so this
   *  ends one, hands the console over, and starts the other. */
  switchSession: (hostId: string, password?: string) =>
    invoke<SwitchReport>("switch_session", { hostId, password: password ?? null }),

  openUrl: (url: string) => openUrl(url),

  /** Bring the launcher window back to the front (e.g. when a stream ends). */
  focusSelf: async () => {
    const win = getCurrentWindow();
    await win.unminimize().catch(() => {});
    await win.setFocus().catch(() => {});
  },
};

/** Subscribe to the pairing PIN emitted by the backend. */
export function onPairingPin(cb: (pin: string) => void): Promise<UnlistenFn> {
  return listen<string>("pair:pin", (e) => cb(e.payload));
}

/** Fired when a stream died right after launch and is being relaunched
 *  automatically (typically: the first connect hit the Windows login screen). */
export function onStreamReconnect(cb: () => void): Promise<UnlistenFn> {
  return listen("stream:reconnect", () => cb());
}

export interface StreamEnded {
  elapsedSecs: number;
  errored: boolean;
}

/** Fired when a launched stream's process exits without being auto-reconnected
 *  (and when the auto-reconnected stream itself exits). */
export function onStreamEnded(cb: (e: StreamEnded) => void): Promise<UnlistenFn> {
  return listen<StreamEnded>("stream:ended", (e) => cb(e.payload));
}

export interface RdpEnded {
  reclaimed: boolean;
  error: string | null;
}

/** Fired when the remote-desktop window closes, carrying whether the desktop
 *  was successfully handed back to the physical console. If it wasn't,
 *  streaming will show a black screen until it is. */
export function onRdpEnded(cb: (e: RdpEnded) => void): Promise<UnlistenFn> {
  return listen<RdpEnded>("rdp:ended", (e) => cb(e.payload));
}

/** Fired by the global shortcut: swap streaming <-> remote desktop in place.
 *  Delivered as an event because during a session the launcher window is
 *  behind a fullscreen client and never sees the keypress itself. */
export function onSessionSwitch(cb: () => void): Promise<UnlistenFn> {
  return listen("session:switch", () => cb());
}

export function hostPinUrl(address: string): string {
  return `https://${address}:47990/pin`;
}

export function hostWebUrl(address: string): string {
  return `https://${address}:47990`;
}
