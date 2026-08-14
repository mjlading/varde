//! Detect the external tools Varde orchestrates (Moonlight, an RDP client,
//! and optionally an SSH client) and describe how to install anything missing.

use serde::Serialize;
use std::path::{Path, PathBuf};

pub const MOONLIGHT_FLATPAK_ID: &str = "com.moonlight_stream.Moonlight";
pub const MOONLIGHT_WINGET_ID: &str = "MoonlightGameStreamingProject.Moonlight";

/// How to invoke the Moonlight client on this machine.
#[derive(Debug, Clone)]
pub enum MoonlightLauncher {
    /// `flatpak run com.moonlight_stream.Moonlight …`
    Flatpak,
    /// A native binary on PATH or an explicit path (Linux).
    Native(String),
    /// Full path to `Moonlight.exe` (Windows).
    Windows(String),
}

impl MoonlightLauncher {
    pub fn program(&self) -> String {
        match self {
            MoonlightLauncher::Flatpak => "flatpak".to_string(),
            MoonlightLauncher::Native(p) => p.clone(),
            MoonlightLauncher::Windows(p) => p.clone(),
        }
    }

    pub fn base_args(&self) -> Vec<String> {
        match self {
            MoonlightLauncher::Flatpak => {
                vec!["run".into(), MOONLIGHT_FLATPAK_ID.into()]
            }
            _ => vec![],
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepInfo {
    pub available: bool,
    /// "flatpak" | "native" | "windows" | "builtin" | "missing"
    pub kind: String,
    pub detail: String,
    pub install_hint: String,
    pub install_command: Option<String>,
    pub install_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyStatus {
    pub platform: String,
    pub moonlight: DepInfo,
    pub rdp: DepInfo,
    pub ssh: DepInfo,
}

pub fn platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

/// Look up an executable on the PATH (respecting PATHEXT on Windows).
pub fn find_in_path(name: &str) -> Option<String> {
    let path = std::env::var_os("PATH")?;
    let exts: Vec<String> = if cfg!(target_os = "windows") {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".EXE;.CMD;.BAT".into())
            .split(';')
            .map(|s| s.to_string())
            .collect()
    } else {
        vec![String::new()]
    };
    for dir in std::env::split_paths(&path) {
        for ext in &exts {
            let candidate = dir.join(format!("{name}{ext}"));
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn flatpak_app_installed(app_id: &str) -> bool {
    let mut roots: Vec<PathBuf> = vec![PathBuf::from("/var/lib/flatpak/app")];
    if let Ok(home) = std::env::var("HOME") {
        roots.push(Path::new(&home).join(".local/share/flatpak/app"));
    }
    roots.iter().any(|r| r.join(app_id).is_dir())
}

#[cfg(target_os = "windows")]
fn flatpak_app_installed(_app_id: &str) -> bool {
    false
}

/// Resolve how to launch Moonlight, honoring a user override first.
pub fn detect_moonlight(override_path: Option<&str>) -> Option<MoonlightLauncher> {
    if let Some(p) = override_path {
        if !p.trim().is_empty() && Path::new(p).is_file() {
            return Some(if cfg!(target_os = "windows") {
                MoonlightLauncher::Windows(p.to_string())
            } else {
                MoonlightLauncher::Native(p.to_string())
            });
        }
    }

    if cfg!(target_os = "windows") {
        for candidate in windows_moonlight_candidates() {
            if candidate.is_file() {
                return Some(MoonlightLauncher::Windows(
                    candidate.to_string_lossy().into_owned(),
                ));
            }
        }
        if let Some(p) = find_in_path("Moonlight") {
            return Some(MoonlightLauncher::Windows(p));
        }
        None
    } else {
        if flatpak_app_installed(MOONLIGHT_FLATPAK_ID) {
            return Some(MoonlightLauncher::Flatpak);
        }
        if let Some(p) = find_in_path("moonlight") {
            return Some(MoonlightLauncher::Native(p));
        }
        None
    }
}

#[cfg(target_os = "windows")]
fn windows_moonlight_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for var in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
        if let Ok(base) = std::env::var(var) {
            out.push(Path::new(&base).join("Moonlight Game Streaming/Moonlight.exe"));
        }
    }
    if let Ok(base) = std::env::var("LOCALAPPDATA") {
        out.push(Path::new(&base).join("Programs/Moonlight Game Streaming/Moonlight.exe"));
    }
    out
}

#[cfg(not(target_os = "windows"))]
fn windows_moonlight_candidates() -> Vec<PathBuf> {
    Vec::new()
}

fn moonlight_dep(override_path: Option<&str>) -> DepInfo {
    match detect_moonlight(override_path) {
        Some(MoonlightLauncher::Flatpak) => DepInfo {
            available: true,
            kind: "flatpak".into(),
            detail: format!("Flatpak · {MOONLIGHT_FLATPAK_ID}"),
            install_hint: "Installed via Flatpak".into(),
            install_command: None,
            install_url: None,
        },
        Some(MoonlightLauncher::Native(p)) => DepInfo {
            available: true,
            kind: "native".into(),
            detail: p,
            install_hint: "Found in PATH".into(),
            install_command: None,
            install_url: None,
        },
        Some(MoonlightLauncher::Windows(p)) => DepInfo {
            available: true,
            kind: "windows".into(),
            detail: p,
            install_hint: "Moonlight.exe found".into(),
            install_command: None,
            install_url: None,
        },
        None => {
            if cfg!(target_os = "windows") {
                DepInfo {
                    available: false,
                    kind: "missing".into(),
                    detail: "Could not find Moonlight.exe".into(),
                    install_hint: "Install Moonlight, then run the check again.".into(),
                    install_command: Some(format!(
                        "winget install -e --id {MOONLIGHT_WINGET_ID}"
                    )),
                    install_url: Some(
                        "https://github.com/moonlight-stream/moonlight-qt/releases".into(),
                    ),
                }
            } else {
                DepInfo {
                    available: false,
                    kind: "missing".into(),
                    detail: "Moonlight is not installed".into(),
                    install_hint: "Install Moonlight via Flatpak, then check again.".into(),
                    install_command: Some(format!(
                        "flatpak install -y flathub {MOONLIGHT_FLATPAK_ID}"
                    )),
                    install_url: Some(
                        "https://flathub.org/apps/com.moonlight_stream.Moonlight".into(),
                    ),
                }
            }
        }
    }
}

/// The RDP client binary name on Linux, if present (xfreerdp3 preferred).
/// The user's package manager, detected rather than assumed — install hints
/// were Fedora-only before this, which is wrong for most of the world.
#[cfg(not(target_os = "windows"))]
fn linux_install_command(dnf: &str, apt: &str, pacman: &str, zypper: &str) -> Option<String> {
    for (bin, cmd) in [
        ("dnf", dnf),
        ("apt", apt),
        ("pacman", pacman),
        ("zypper", zypper),
    ] {
        if find_in_path(bin).is_some() {
            return Some(cmd.to_string());
        }
    }
    None
}

pub fn detect_freerdp() -> Option<String> {
    find_in_path("xfreerdp3").or_else(|| find_in_path("xfreerdp"))
}

fn rdp_dep() -> DepInfo {
    if cfg!(target_os = "windows") {
        DepInfo {
            available: true,
            kind: "builtin".into(),
            detail: "mstsc.exe (built into Windows)".into(),
            install_hint: "Remote Desktop is built in".into(),
            install_command: None,
            install_url: None,
        }
    } else if let Some(p) = detect_freerdp() {
        DepInfo {
            available: true,
            kind: "native".into(),
            detail: p,
            install_hint: "FreeRDP found in PATH".into(),
            install_command: None,
            install_url: None,
        }
    } else {
        DepInfo {
            available: false,
            kind: "missing".into(),
            detail: "Could not find FreeRDP (xfreerdp)".into(),
            install_hint: "Install FreeRDP to use Work (RDP).".into(),
            install_command: linux_install_command(
                "sudo dnf install -y freerdp",
                "sudo apt install -y freerdp3-x11",
                "sudo pacman -S --noconfirm freerdp",
                "sudo zypper install -y freerdp",
            ),
            install_url: Some("https://www.freerdp.com/".into()),
        }
    }
}

fn ssh_dep() -> DepInfo {
    if let Some(p) = find_in_path("ssh") {
        DepInfo {
            available: true,
            kind: "native".into(),
            detail: p,
            install_hint: "OpenSSH client found".into(),
            install_command: None,
            install_url: None,
        }
    } else if cfg!(target_os = "windows") {
        DepInfo {
            available: false,
            kind: "missing".into(),
            detail: "Could not find the OpenSSH client".into(),
            install_hint: "Turn on the \"OpenSSH Client\" Windows feature.".into(),
            install_command: Some(
                "Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0".into(),
            ),
            install_url: None,
        }
    } else {
        DepInfo {
            available: false,
            kind: "missing".into(),
            detail: "Could not find the OpenSSH client".into(),
            install_hint: "Install the OpenSSH client to be able to put the PC to sleep.".into(),
            install_command: linux_install_command(
                "sudo dnf install -y openssh-clients",
                "sudo apt install -y openssh-client",
                "sudo pacman -S --noconfirm openssh",
                "sudo zypper install -y openssh-clients",
            ),
            install_url: None,
        }
    }
}

pub fn check_dependencies(moonlight_override: Option<&str>) -> DependencyStatus {
    DependencyStatus {
        platform: platform().to_string(),
        moonlight: moonlight_dep(moonlight_override),
        rdp: rdp_dep(),
        ssh: ssh_dep(),
    }
}
