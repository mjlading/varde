/* Throwaway harness for capturing README screenshots without a desktop.
 *
 * Boots the REAL app in a plain browser by standing in for the Tauri IPC
 * layer, with a fictional PC so no personal data can reach the images.
 * Query params: ?theme=dark|oled&state=online|offline|in_use
 * Not part of the app; delete after capture. */

const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "oled" ? "oled" : "dark";
const state = params.get("state") ?? "online";

const HOST = {
  id: "demo",
  name: "Rig",
  address: "192.168.1.42",
  macs: ["A4:B1:C2:D3:E4:F5"],
  rdpUsername: "player",
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
  qualityCustom: {
    width: 1920,
    height: 1080,
    fps: 60,
    bitrateKbps: 40000,
    vsync: false,
    framePacing: true,
    codec: "auto",
    hdr: false,
  },
  steamAppName: "Steam Big Picture",
  desktopAppName: "Desktop",
  paired: true,
  ssh: { username: "player", port: 22 },
  wake: { wol: true, http: null, relay: null },
  lastWakeMs: 38000,
  flavour: "Sunshine",
};

const SETTINGS = {
  version: 2,
  onboarded: true,
  hosts: [HOST],
  activeHostId: "demo",
  moonlightPathOverride: null,
  theme,
  uiScale: 1,
  sounds: false,
  language: "en",
};

const STATUS = {
  reachable: state !== "offline",
  streamOpen: state !== "offline",
  rdpOpen: state !== "offline",
  webOpen: state !== "offline",
  inUse: state === "in_use",
  paired: true,
  state: state === "offline" ? "offline" : state === "in_use" ? "in_use" : "online",
};

const RESPONSES: Record<string, unknown> = {
  get_settings: SETTINGS,
  save_settings: null,
  host_status: STATUS,
  probe_host: { reachable: STATUS.reachable, status: STATUS },
  current_session: null,
  detect_flavour: "Sunshine",
  has_rdp_password: false,
  check_ssh: true,
  list_apps: ["Steam Big Picture", "Desktop"],
  resolve_mac: null,
  relocate_host: null,
  discover_hosts: [],
};

// Note: a headless page reports itself hidden, so the app enters calm mode and
// freezes every ambient animation. That is left alone deliberately — it is what
// makes a still capture deterministic. (Forcing visibility instead leaves
// framer-motion's entrance animations stuck at opacity 0 under virtual time.)

let callbackId = 0;

// The shape @tauri-apps/api talks to. `listen` registers a callback through
// transformCallback and then invokes the event plugin; nothing here ever
// fires, which is exactly what a still image wants.
(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
  transformCallback(callback: unknown) {
    const id = ++callbackId;
    (window as unknown as Record<string, unknown>)[`_${id}`] = callback;
    return id;
  },
  metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
  invoke(cmd: string, _args?: unknown) {
    if (cmd.startsWith("plugin:event|")) return Promise.resolve(++callbackId);
    if (cmd in RESPONSES) return Promise.resolve(RESPONSES[cmd]);
    return Promise.resolve(null);
  },
};

// Only now is it safe to pull in the app, which reads the IPC layer on import.
// Mounted without StrictMode on purpose: its double-mount leaves the first
// status poll in flight, and the retry is scheduled at the calm interval,
// which a headless page (always "hidden") never reaches.
import("./demo-mount");

export {};
