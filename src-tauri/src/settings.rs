//! Persisted application state (`settings.json`), fully managed by the app.
//! The user never edits this file by hand.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const SETTINGS_FILE: &str = "settings.json";
const CURRENT_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub version: u32,
    /// Whether the first-run wizard has been completed.
    pub onboarded: bool,
    pub hosts: Vec<Host>,
    pub active_host_id: Option<String>,
    /// Manual override for the Moonlight executable (Windows path or Linux binary).
    pub moonlight_path_override: Option<String>,
    pub theme: String,
    /// Global UI zoom, so the launcher reads from across a living room.
    /// 1.0 = normal, ~1.7 = 40" TV.
    #[serde(default = "default_ui_scale")]
    pub ui_scale: f64,
    /// Soft UI sounds (clicks, connect chimes). Synthesized in the frontend.
    #[serde(default = "default_true")]
    pub sounds: bool,
    /// UI language: "en" | "nb" | None (= follow the system locale).
    #[serde(default)]
    pub language: Option<String>,
}

fn default_ui_scale() -> f64 {
    1.0
}

fn default_true() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        // A fresh install has no PCs and boots into the first-run wizard,
        // which builds the host from discovery + probing.
        Settings {
            version: CURRENT_VERSION,
            onboarded: false,
            active_host_id: None,
            hosts: Vec::new(),
            moonlight_path_override: None,
            theme: "dark".to_string(),
            ui_scale: 1.0,
            sounds: true,
            language: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Host {
    pub id: String,
    pub name: String,
    /// IP address or hostname of the host.
    pub address: String,
    /// One or more MAC addresses (WiFi + Ethernet). Magic packets go to all of them.
    pub macs: Vec<String>,
    pub rdp_username: Option<String>,
    pub rdp: RdpOptions,
    pub quality_preset: QualityPreset,
    pub quality_custom: StreamQuality,
    /// App name passed to `moonlight stream` for the "Play" action.
    pub steam_app_name: String,
    /// App name passed to `moonlight stream` for the "Desktop stream" action.
    pub desktop_app_name: String,
    pub paired: bool,
    /// Optional SSH config that unlocks the "Sleep PC" feature.
    pub ssh: Option<SshConfig>,
    /// How this PC is woken. Magic packets only travel the local network;
    /// the HTTP and relay transports also reach it from outside the house.
    #[serde(default)]
    pub wake: WakeConfig,
    /// How long the last successful wake took (signal sent → service up),
    /// used to calibrate the wake progress bar.
    #[serde(default)]
    pub last_wake_ms: Option<u64>,
    /// Which host software this PC runs — "Sunshine", "Apollo", or unknown.
    /// Detected once and cached; only ever used to name things in the UI.
    #[serde(default)]
    pub flavour: Option<String>,
}

impl Host {
    /// Resolve the effective stream quality for the selected preset.
    /// `Auto` needs the client's display info, which the caller supplies
    /// (frontend-measured, with a backend monitor fallback).
    pub fn effective_quality(&self, auto: Option<(u32, u32, u32)>) -> StreamQuality {
        match self.quality_preset {
            QualityPreset::Auto => {
                let (w, h, fps) = auto.unwrap_or((1920, 1080, 60));
                StreamQuality::auto(w, h, fps)
            }
            QualityPreset::Balanced => StreamQuality::balanced(),
            QualityPreset::Quality => StreamQuality::quality(),
            QualityPreset::Custom => self.quality_custom.clone(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum QualityPreset {
    /// Follow the client display: native resolution and refresh rate, with the
    /// bitrate derived from moonlight-qt's own default curve (doubled for LAN).
    Auto,
    Balanced,
    Quality,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamQuality {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate_kbps: u32,
    pub vsync: bool,
    pub frame_pacing: bool,
    /// One of: auto / H.264 / HEVC / AV1
    pub codec: String,
    pub hdr: bool,
}

impl StreamQuality {
    /// 1080p60, 40 Mbps, vsync off, pacing off — the spec's "Balanced" preset.
    pub fn balanced() -> Self {
        StreamQuality {
            width: 1920,
            height: 1080,
            fps: 60,
            bitrate_kbps: 40_000,
            vsync: false,
            frame_pacing: false,
            codec: "auto".to_string(),
            hdr: false,
        }
    }

    /// Same resolution, richer bitrate and smoothing — the "Quality" preset.
    pub fn quality() -> Self {
        StreamQuality {
            width: 1920,
            height: 1080,
            fps: 60,
            bitrate_kbps: 80_000,
            vsync: true,
            frame_pacing: true,
            codec: "HEVC".to_string(),
            hdr: false,
        }
    }

    /// The "Auto" preset: the client display's native resolution and refresh
    /// rate, bitrate from `auto_bitrate_kbps`. V-sync off (latency), frame
    /// pacing on (smoothness), codec negotiated by Moonlight.
    pub fn auto(width: u32, height: u32, fps: u32) -> Self {
        let width = width.clamp(1280, 3840);
        let height = height.clamp(720, 2160);
        let fps = fps.clamp(30, 240);
        StreamQuality {
            width,
            height,
            fps,
            bitrate_kbps: auto_bitrate_kbps(width, height, fps),
            vsync: false,
            frame_pacing: true,
            codec: "auto".to_string(),
            hdr: false,
        }
    }
}

/// moonlight-qt's default bitrate curve (`getDefaultBitrate`): linear
/// interpolation over a resolution table, fps factor linear up to 60 and
/// square-root damped beyond. Doubled here — this launcher only ever streams
/// over the LAN, where headroom is cheap — and capped at 150 Mbps.
/// Anchor points after doubling: 1080p60 → 40 Mbps, 1440p120 → ~113 Mbps,
/// 4K60 → 150 Mbps (capped).
pub fn auto_bitrate_kbps(width: u32, height: u32, fps: u32) -> u32 {
    const TABLE: [(f64, f64); 6] = [
        (640.0 * 360.0, 1.0),
        (854.0 * 480.0, 1.5),
        (1280.0 * 720.0, 5.0),
        (1920.0 * 1080.0, 10.0),
        (2560.0 * 1440.0, 20.0),
        (3840.0 * 2160.0, 40.0),
    ];
    let px = f64::from(width) * f64::from(height);
    let res_factor = if px <= TABLE[0].0 {
        TABLE[0].1
    } else if px >= TABLE[5].0 {
        TABLE[5].1
    } else {
        let i = TABLE.iter().position(|&(p, _)| px <= p).unwrap();
        let (p0, f0) = TABLE[i - 1];
        let (p1, f1) = TABLE[i];
        f0 + (px - p0) / (p1 - p0) * (f1 - f0)
    };
    let fps = f64::from(fps);
    let frame_factor = if fps <= 60.0 { fps } else { (fps / 60.0).sqrt() * 60.0 } / 30.0;
    let kbps = (res_factor * frame_factor * 1000.0 * 2.0).round() as u32;
    kbps.clamp(5_000, 150_000)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpOptions {
    pub dynamic_resolution: bool,
    pub clipboard: bool,
    pub audio: bool,
    /// Open the session fullscreen (Ctrl+Alt+Enter toggles it live).
    #[serde(default = "default_true")]
    pub fullscreen: bool,
    /// When the RDP session closes, hand the desktop back to the physical
    /// console over SSH. Without this Windows stays logged into the remote
    /// session and game streaming can't capture the screen afterwards.
    #[serde(default = "default_true")]
    pub reclaim_console: bool,
    /// RDP8 graphics pipeline mode. See [`GfxMode`].
    #[serde(default = "default_gfx")]
    pub gfx: GfxMode,
    /// Override for the console-reclaim command. `tscon` has to redirect a
    /// session other than the SSH one, and Windows OpenSSH hands out a
    /// filtered token — so on a locked-down machine the built-in command comes
    /// back access-denied and the usual fix is a scheduled task running as
    /// SYSTEM. `{user}` is replaced with the Windows username.
    #[serde(default)]
    pub reclaim_command: Option<String>,
}

/// How the RDP session encodes the screen.
///
/// The RDP8 graphics pipeline is the thing people assume needs a bespoke
/// protocol: Windows splits each frame into dirty rectangles, sends static
/// text and UI losslessly, and routes only the moving regions through H.264.
/// That is region-based encoding, already shipping, already implemented on
/// the client side by FreeRDP — no custom protocol required.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GfxMode {
    /// Legacy bitmap codecs. Cheapest to decode; video and scrolling smear.
    Off,
    /// H.264 4:2:0. Smooth video, but chroma subsampling blurs small text.
    Avc420,
    /// H.264 4:4:4 — full colour resolution, so text stays sharp while moving
    /// regions still get video-grade compression. Needs more client CPU when
    /// FreeRDP was built without hardware decode.
    Avc444,
}

fn default_gfx() -> GfxMode {
    GfxMode::Avc444
}

impl Default for RdpOptions {
    fn default() -> Self {
        RdpOptions {
            dynamic_resolution: true,
            clipboard: true,
            audio: true,
            fullscreen: true,
            reclaim_console: true,
            gfx: default_gfx(),
            reclaim_command: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfig {
    pub username: String,
    pub port: u16,
}

/// Wake transports. A magic packet is a link-layer broadcast, so it dies at the
/// first router — which is why waking from outside the house needs something
/// else. All configured transports are attempted; one success is enough.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WakeConfig {
    /// Wake-on-LAN magic packets to every stored MAC. Local network only.
    #[serde(default = "default_true")]
    pub wol: bool,
    /// An HTTP endpoint that wakes the PC on our behalf: UpSnap, a Home
    /// Assistant webhook, a router's WoL page. Reachable from anywhere.
    #[serde(default)]
    pub http: Option<HttpWake>,
    /// An always-on machine on the PC's own network (NAS, Pi, router) that we
    /// SSH into and ask to send the magic packet locally.
    #[serde(default)]
    pub relay: Option<RelayWake>,
}

impl Default for WakeConfig {
    fn default() -> Self {
        WakeConfig {
            wol: true,
            http: None,
            relay: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpWake {
    pub url: String,
    /// "GET" or "POST" (anything else is treated as GET).
    #[serde(default)]
    pub method: String,
    /// Request body for POST — typically a small JSON document.
    #[serde(default)]
    pub body: Option<String>,
    /// One optional header, written as "Name: value" (e.g. an API token).
    #[serde(default)]
    pub header: Option<String>,
    /// Accept self-signed certificates — common on homelab HTTPS endpoints.
    #[serde(default)]
    pub insecure: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayWake {
    /// Address of the always-on machine (not the PC being woken).
    pub address: String,
    pub username: String,
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    /// Custom command; `{mac}` and `{broadcast}` are substituted. When empty,
    /// a portable bash one-liner is used that needs nothing installed.
    #[serde(default)]
    pub command: Option<String>,
}

fn default_ssh_port() -> u16 {
    22
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Could not find the configuration folder: {e}"))?;
    Ok(dir.join(SETTINGS_FILE))
}

/// Upgrade older settings files in place. v1 → v2: the new Auto quality preset
/// becomes the default for hosts still on the old default (Balanced).
fn migrate(mut s: Settings) -> Settings {
    if s.version < 2 {
        for h in &mut s.hosts {
            if h.quality_preset == QualityPreset::Balanced {
                h.quality_preset = QualityPreset::Auto;
            }
        }
        s.version = 2;
    }
    s
}

pub fn load(app: &AppHandle) -> Result<Settings, String> {
    let path = settings_path(app)?;
    match std::fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents)
            .map(migrate)
            .map_err(|e| format!("settings.json is corrupt: {e}")),
        Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => {
            // The identifier changed with the rename (com.deskconnect.app →
            // io.github.mjlading.varde), which moved the config dir. Adopt a
            // DeskConnect-era settings.json once instead of greeting an
            // existing user with the first-run wizard.
            if let Some(old) = legacy_settings_path(&path) {
                if let Ok(contents) = std::fs::read_to_string(&old) {
                    if let Ok(s) = serde_json::from_str::<Settings>(&contents) {
                        let s = migrate(s);
                        if let Some(parent) = path.parent() {
                            let _ = std::fs::create_dir_all(parent);
                        }
                        let _ = std::fs::write(&path, serde_json::to_string_pretty(&s).unwrap_or(contents));
                        return Ok(s);
                    }
                }
            }
            Ok(Settings::default())
        }
        Err(e) => Err(format!("Could not read settings.json: {e}")),
    }
}

/// Where a pre-rename install kept its settings: the sibling config dir named
/// by the old app identifier.
fn legacy_settings_path(current: &std::path::Path) -> Option<PathBuf> {
    let dir = current.parent()?;
    let base = dir.parent()?;
    let old = base.join("com.deskconnect.app").join(SETTINGS_FILE);
    old.exists().then_some(old)
}

pub fn save(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create the configuration folder: {e}"))?;
    }
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Could not save the settings: {e}"))?;
    std::fs::write(&path, json).map_err(|e| format!("Could not write settings.json: {e}"))?;
    Ok(())
}

pub fn find_host(settings: &Settings, host_id: &str) -> Option<Host> {
    settings.hosts.iter().find(|h| h.id == host_id).cloned()
}
