// TypeScript mirrors of the Rust models (see src-tauri/src/settings.rs, net.rs,
// deps.rs). Kept in sync by hand — both sides use camelCase on the wire.

export type QualityPreset = "auto" | "balanced" | "quality" | "custom";
export type VideoCodec = "auto" | "H.264" | "HEVC" | "AV1";

export interface StreamQuality {
  width: number;
  height: number;
  fps: number;
  bitrateKbps: number;
  vsync: boolean;
  framePacing: boolean;
  codec: VideoCodec;
  hdr: boolean;
}

/** RDP8 graphics pipeline mode: Windows sends static text losslessly and routes
 *  only the moving regions through H.264. "avc444" keeps full colour so small
 *  text stays sharp; "avc420" is cheaper to decode; "off" is the legacy path. */
export type GfxMode = "off" | "avc420" | "avc444";

export interface RdpOptions {
  dynamicResolution: boolean;
  clipboard: boolean;
  audio: boolean;
  fullscreen: boolean;
  /** Hand the desktop back to the physical console (over SSH) when the RDP
   *  session closes, so streaming can capture the screen again. */
  reclaimConsole: boolean;
  gfx: GfxMode;
  /** Override for the console-reclaim command. The built-in tscon call needs
   *  rights to redirect another session, which Windows OpenSSH may not grant —
   *  the usual fix is a scheduled task running as SYSTEM. `{user}` is
   *  substituted with the Windows username. */
  reclaimCommand: string | null;
}

export interface HttpWake {
  url: string;
  method: string;
  body: string | null;
  header: string | null;
  insecure: boolean;
}

export interface RelayWake {
  address: string;
  username: string;
  port: number;
  command: string | null;
}

export interface WakeConfig {
  wol: boolean;
  http: HttpWake | null;
  relay: RelayWake | null;
}

export interface WakeAttempt {
  method: "wol" | "http" | "relay";
  ok: boolean;
  detail: string;
}

export interface WakeReport {
  anyOk: boolean;
  attempts: WakeAttempt[];
}

/** One diagnosed condition on the host that decides whether Wake-on-LAN can
 *  work at all. `warn` marks advisory items rather than pass/fail. */
export interface WakeCheck {
  ok: boolean;
  warn: boolean;
  label: string;
  detail: string;
  fix: string | null;
}

/** Which leg is currently up on screen. */
export type SessionKind = "stream" | "rdp";

/** What a hot-switch is bringing up. */
export interface SwitchReport {
  to: SessionKind;
  detail: string;
}

/** What had to happen before a stream could see a real desktop. */
export interface PrepareReport {
  action: "ready" | "reclaimed" | "loggedIn" | "loginNeeded" | "unknown";
  detail: string;
}

export interface SshConfig {
  username: string;
  port: number;
}

export interface Host {
  id: string;
  name: string;
  address: string;
  macs: string[];
  rdpUsername: string | null;
  rdp: RdpOptions;
  qualityPreset: QualityPreset;
  qualityCustom: StreamQuality;
  steamAppName: string;
  desktopAppName: string;
  paired: boolean;
  ssh: SshConfig | null;
  /** How this PC is woken. Magic packets are local-only; the HTTP and relay
   *  transports also reach it from outside the house. */
  wake: WakeConfig;
  /** Duration of the last successful wake (signal → service up), for the
   *  calibrated progress bar. */
  lastWakeMs: number | null;
  /** "Sunshine" | "Apollo" | null — detected once, used only to name the host
   *  software in the UI. Null keeps the copy neutral rather than wrong. */
  flavour: string | null;
}

export interface Settings {
  version: number;
  onboarded: boolean;
  hosts: Host[];
  activeHostId: string | null;
  moonlightPathOverride: string | null;
  theme: string;
  uiScale: number;
  sounds: boolean;
  /** "en" | "nb" | null (= follow the system locale). */
  language: string | null;
}

export type HostState = "offline" | "waking" | "online" | "in_use";

export interface HostStatus {
  reachable: boolean;
  streamOpen: boolean;
  rdpOpen: boolean;
  webOpen: boolean;
  inUse: boolean;
  paired: boolean | null;
  state: Exclude<HostState, "waking">;
}

export interface DiscoveredHost {
  name: string;
  address: string;
  hostname: string;
  port: number;
}

export interface ProbeResult {
  ip: string;
  mac: string | null;
  status: HostStatus;
}

export interface DepInfo {
  available: boolean;
  kind: "flatpak" | "native" | "windows" | "builtin" | "missing";
  detail: string;
  installHint: string;
  installCommand: string | null;
  installUrl: string | null;
}

export interface DependencyStatus {
  platform: "linux" | "windows" | "macos";
  moonlight: DepInfo;
  rdp: DepInfo;
  ssh: DepInfo;
}

export interface PairResult {
  paired: boolean;
  pin: string | null;
  message: string;
}

// ---- Defaults used when building a fresh host ------------------------------

export const BALANCED: StreamQuality = {
  width: 1920,
  height: 1080,
  fps: 60,
  bitrateKbps: 40000,
  vsync: false,
  framePacing: false,
  codec: "auto",
  hdr: false,
};

export function newHost(partial: Partial<Host> = {}): Host {
  return {
    id: crypto.randomUUID(),
    name: "Min PC",
    address: "",
    macs: [],
    rdpUsername: null,
    rdp: {
      dynamicResolution: true,
      clipboard: true,
      audio: true,
      fullscreen: true,
      reclaimConsole: true,
      gfx: "avc444",
      reclaimCommand: null,
    },
    qualityPreset: "auto",
    qualityCustom: { ...BALANCED },
    steamAppName: "Steam",
    desktopAppName: "Desktop",
    paired: false,
    ssh: null,
    wake: { wol: true, http: null, relay: null },
    lastWakeMs: null,
    flavour: null,
    ...partial,
  };
}
