//! Thin Tauri command wrappers around the domain modules. All user-facing
//! errors are friendly strings — no raw stderr ever reaches the UI.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::discovery::{self, DiscoveredHost};
use crate::moonlight;
use crate::net::{self, HostStatus};
use crate::rdp;
use crate::settings::{self, Settings};
use crate::ssh;

const NO_SUCH_HOST: &str = "This PC is no longer set up.";

fn load_settings(app: &AppHandle) -> Result<Settings, String> {
    settings::load(app)
}

fn host_or_err(app: &AppHandle, host_id: &str) -> Result<settings::Host, String> {
    let s = load_settings(app)?;
    settings::find_host(&s, host_id).ok_or_else(|| NO_SUCH_HOST.to_string())
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<Settings, String> {
    settings::load(&app)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    settings::save(&app, &settings)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub ip: String,
    pub mac: Option<String>,
    pub status: HostStatus,
}

#[tauri::command]
pub async fn discover_hosts(timeout_ms: Option<u64>) -> Result<Vec<DiscoveredHost>, String> {
    let dur = Duration::from_millis(timeout_ms.unwrap_or(4000));
    tokio::task::spawn_blocking(move || discovery::discover(dur))
        .await
        .map_err(|e| format!("The network scan failed: {e}"))?
}

#[tauri::command]
pub async fn probe_host(address: String) -> Result<ProbeResult, String> {
    let ip = net::resolve_ip(&address).unwrap_or_else(|| address.clone());
    let mac = net::resolve_mac(&address).await;
    let status = net::host_status(&address).await;
    Ok(ProbeResult { ip, mac, status })
}

#[tauri::command]
pub async fn resolve_mac(address: String) -> Result<Option<String>, String> {
    Ok(net::resolve_mac(&address).await)
}

#[tauri::command]
pub async fn host_status(address: String) -> Result<HostStatus, String> {
    Ok(net::host_status(&address).await)
}

/// Wake a configured PC through every transport it has (magic packets, an HTTP
/// endpoint, an SSH relay). `address` overrides the saved one during a wake
/// that already relocated the host.
#[tauri::command]
pub async fn wake(
    app: AppHandle,
    host_id: String,
    address: Option<String>,
) -> Result<crate::wake::WakeReport, String> {
    let host = host_or_err(&app, &host_id)?;
    let addr = address.unwrap_or_else(|| host.address.clone());
    crate::wake::wake_host(&host, &addr).await
}

/// Self-healing for DHCP drift: when the saved address stops answering, browse
/// the LAN for GameStream hosts and identify ours by MAC. Returns the new
/// address if the host was found somewhere else, `None` otherwise. The caller
/// (frontend) persists the change so UI state stays in sync.
#[tauri::command]
pub async fn relocate_host(app: AppHandle, host_id: String) -> Result<Option<String>, String> {
    let host = host_or_err(&app, &host_id)?;
    if host.macs.is_empty() {
        return Ok(None);
    }
    let candidates =
        tokio::task::spawn_blocking(move || discovery::discover(Duration::from_millis(4000)))
            .await
            .map_err(|e| format!("The network scan failed: {e}"))??;
    // The saved address may be a hostname while discovery yields IP literals —
    // resolve it so we never "relocate" a host to its own current IP.
    let saved_ip = {
        let saved = host.address.clone();
        tokio::task::spawn_blocking(move || net::resolve_ip(&saved))
            .await
            .ok()
            .flatten()
    };
    for cand in candidates {
        if cand.address == host.address || saved_ip.as_deref() == Some(cand.address.as_str()) {
            // Discoverable at the saved address — nothing to heal.
            continue;
        }
        // MAC-verify before adopting, so we never grab a different
        // Sunshine/Apollo host that happens to be on the network.
        if let Some(mac) = net::resolve_mac(&cand.address).await {
            if host.macs.iter().any(|m| net::macs_equal(m, &mac)) {
                return Ok(Some(cand.address));
            }
        }
    }
    Ok(None)
}

#[tauri::command]
pub async fn wait_for_port(address: String, port: u16, timeout_ms: u64) -> Result<bool, String> {
    Ok(net::wait_for_port(&address, port, Duration::from_millis(timeout_ms)).await)
}

#[tauri::command]
pub fn check_dependencies(app: AppHandle) -> Result<crate::deps::DependencyStatus, String> {
    let s = load_settings(&app)?;
    Ok(crate::deps::check_dependencies(
        s.moonlight_path_override.as_deref(),
    ))
}

#[tauri::command]
pub async fn start_pairing(
    app: AppHandle,
    address: String,
    pin: String,
) -> Result<moonlight::PairResult, String> {
    let s = load_settings(&app)?;
    moonlight::start_pairing(
        app.clone(),
        s.moonlight_path_override.as_deref(),
        &address,
        &pin,
    )
    .await
}

/// Client-display facts measured by the frontend (native pixels + refresh
/// rate), used by the Auto quality preset so the stream matches the screen
/// it's actually shown on.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayHint {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

/// Fallback when no frontend hint arrives: the monitor the window sits on,
/// at 60 fps (refresh rate isn't exposed by the windowing API).
fn monitor_display_hint(app: &AppHandle) -> Option<(u32, u32, u32)> {
    let window = app.get_webview_window("main")?;
    let monitor = window.current_monitor().ok().flatten()?;
    let size = monitor.size();
    Some((size.width, size.height, 60))
}

#[tauri::command]
pub async fn launch_stream(
    app: AppHandle,
    host_id: String,
    app_name: String,
    display_hint: Option<DisplayHint>,
) -> Result<(), String> {
    let s = load_settings(&app)?;
    let host = settings::find_host(&s, &host_id).ok_or_else(|| NO_SUCH_HOST.to_string())?;
    let auto = display_hint
        .map(|d| (d.width, d.height, d.fps))
        .or_else(|| monitor_display_hint(&app));
    let quality = host.effective_quality(auto);
    moonlight::launch_stream(
        app.clone(),
        s.moonlight_path_override.as_deref(),
        &host.address,
        &app_name,
        &quality,
    )
    .await
}

#[tauri::command]
pub async fn launch_rdp(
    app: AppHandle,
    host_id: String,
    password: Option<String>,
) -> Result<(), String> {
    let host = host_or_err(&app, &host_id)?;
    // No password supplied → fall back to the one saved in the OS keyring, if
    // any. (On Windows this is a no-op: mstsc reads TERMSRV creds itself.)
    let effective = match password {
        Some(p) => Some(p),
        None => crate::credentials::fetch_password(&host).await,
    };
    rdp::launch_rdp(
        &host.address,
        host.rdp_username.as_deref(),
        effective.as_deref(),
        &host.rdp,
        reclaim_ctx(&app, &host),
    )
    .await
}

/// Arm the console-reclaim watcher, but only when it could actually work:
/// handing the session back runs over SSH, so without an SSH config the
/// setting has nothing to act through.
fn reclaim_ctx(app: &AppHandle, host: &settings::Host) -> Option<rdp::ReclaimCtx> {
    let ssh = host.ssh.as_ref()?;
    if !host.rdp.reclaim_console {
        return None;
    }
    Some(rdp::ReclaimCtx {
        app: app.clone(),
        address: host.address.clone(),
        ssh: ssh.clone(),
        windows_user: host
            .rdp_username
            .clone()
            .unwrap_or_else(|| ssh.username.clone()),
        command: host.rdp.reclaim_command.clone(),
    })
}

/// What a hot-switch is bringing up, so the UI can narrate it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchReport {
    /// "stream" | "rdp"
    pub to: String,
    pub detail: String,
}

/// Which kind of session is up right now, if any.
#[tauri::command]
pub fn current_session() -> Option<crate::session::SessionKind> {
    crate::session::current()
}

/// Swap the running session for the other kind without a trip back to the
/// launcher.
///
/// The two legs cannot coexist: streaming captures the physical console, and
/// remote desktop moves the logged-in session off it. So a switch is always
/// end-one-then-start-the-other, and the interesting part is the handover in
/// between — going back to streaming without putting the desktop on the
/// console first just captures black.
#[tauri::command]
pub async fn switch_session(
    app: AppHandle,
    host_id: String,
    password: Option<String>,
) -> Result<SwitchReport, String> {
    let host = host_or_err(&app, &host_id)?;
    let Some(kind) = crate::session::current() else {
        return Err("No session is running to switch from.".to_string());
    };
    // Disarm the stream watcher *before* the kill. It cannot tell a deliberate
    // switch from a crash, and inside the reconnect window it would relaunch
    // the stream on top of the remote desktop we are about to open.
    if kind == crate::session::SessionKind::Stream {
        moonlight::supersede();
    }
    crate::session::kill_current();
    let s = load_settings(&app)?;

    match kind {
        crate::session::SessionKind::Stream => {
            // End the app on the host too, or it stays "in use" and refuses
            // the next stream when we come back.
            let _ = moonlight::quit_app(s.moonlight_path_override.as_deref(), &host.address).await;
            let pw = match password {
                Some(p) => Some(p),
                None => crate::credentials::fetch_password(&host).await,
            };
            rdp::launch_rdp(
                &host.address,
                host.rdp_username.as_deref(),
                pw.as_deref(),
                &host.rdp,
                reclaim_ctx(&app, &host),
            )
            .await?;
            Ok(SwitchReport {
                to: "rdp".into(),
                detail: "Opening Remote Desktop".into(),
            })
        }
        crate::session::SessionKind::Rdp => {
            // The client is on its way out; let it finish disconnecting before
            // asking Windows where the session is, or we read the state it is
            // about to leave rather than the one it lands in.
            tokio::time::sleep(Duration::from_millis(1200)).await;
            if let Some(ssh) = host.ssh.as_ref() {
                let user = host
                    .rdp_username
                    .clone()
                    .unwrap_or_else(|| ssh.username.clone());
                ssh::reclaim_console(
                    &host.address,
                    ssh,
                    &user,
                    host.rdp.reclaim_command.as_deref(),
                )
                .await?;
            }
            // Coming back from the desktop, the desktop stream is what you
            // were looking at — so that is what resumes.
            let quality = host.effective_quality(monitor_display_hint(&app));
            moonlight::launch_stream(
                app.clone(),
                s.moonlight_path_override.as_deref(),
                &host.address,
                &host.desktop_app_name,
                &quality,
            )
            .await?;
            Ok(SwitchReport {
                to: "stream".into(),
                detail: "Starting the stream".into(),
            })
        }
    }
}

/// Find out why a magic packet isn't waking this PC. The usual causes are all
/// Windows settings that are invisible from the client side, so the PC has to
/// be awake and reachable over SSH for this to answer anything.
#[tauri::command]
pub async fn diagnose_wake(
    app: AppHandle,
    host_id: String,
) -> Result<Vec<crate::wake::WakeCheck>, String> {
    let host = host_or_err(&app, &host_id)?;
    let ssh = host.ssh.as_ref().ok_or_else(|| {
        "This check needs SSH access to the PC. Turn on SSH in Settings first.".to_string()
    })?;
    let user = host
        .rdp_username
        .clone()
        .unwrap_or_else(|| ssh.username.clone());
    crate::wake::diagnose(&host.address, ssh, &user, &host.macs).await
}

fn ssh_or_err(host: &settings::Host) -> Result<&settings::SshConfig, String> {
    host.ssh.as_ref().ok_or_else(|| {
        "This check needs SSH access to the PC. Turn on SSH in Settings first.".to_string()
    })
}

/// Read the host-side registry state that decides remote-desktop quality:
/// whether AVC444 is allowed, and whether the frame-rate cap is raised.
#[tauri::command]
pub async fn rdp_host_check(
    app: AppHandle,
    host_id: String,
) -> Result<Vec<crate::wake::WakeCheck>, String> {
    let host = host_or_err(&app, &host_id)?;
    let ssh_cfg = ssh_or_err(&host)?;
    rdp::host_check(&host.address, ssh_cfg).await
}

/// Apply both quality settings on the host, then re-read the state.
#[tauri::command]
pub async fn rdp_host_optimize(
    app: AppHandle,
    host_id: String,
) -> Result<Vec<crate::wake::WakeCheck>, String> {
    let host = host_or_err(&app, &host_id)?;
    let ssh_cfg = ssh_or_err(&host)?;
    rdp::host_optimize(&host.address, ssh_cfg).await
}

/// Identify the host software so the UI can call it by name. Best-effort:
/// `None` just means the copy stays neutral.
#[tauri::command]
pub async fn detect_flavour(app: AppHandle, host_id: String) -> Result<Option<String>, String> {
    let host = host_or_err(&app, &host_id)?;
    Ok(net::server_flavour(&host.address).await)
}

/// What `prepare_for_stream` had to do before the stream could see anything.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareReport {
    /// "ready" | "reclaimed" | "loggedIn" | "loginNeeded" | "unknown"
    pub action: String,
    pub detail: String,
}

impl PrepareReport {
    fn new(action: &str, detail: &str) -> Self {
        PrepareReport { action: action.into(), detail: detail.into() }
    }
}

/// Make sure there is actually a desktop for the stream to capture.
///
/// Two states break streaming in ways that look identical from the client — a
/// black or frozen picture — and neither is fixed by reconnecting: nobody is
/// logged in (the PC is at the Windows login screen), or somebody's session is
/// parked on a remote-desktop connection instead of the console. This checks
/// for both over SSH and fixes what it can before Moonlight ever starts.
///
/// Best-effort by design: without SSH we can't tell, and a failure here should
/// never block a launch that might have worked anyway.
#[tauri::command]
pub async fn prepare_for_stream(
    app: AppHandle,
    host_id: String,
    password: Option<String>,
) -> Result<PrepareReport, String> {
    let host = host_or_err(&app, &host_id)?;
    let Some(ssh) = host.ssh.as_ref() else {
        return Ok(PrepareReport::new("unknown", ""));
    };
    let user = host
        .rdp_username
        .clone()
        .unwrap_or_else(|| ssh.username.clone());

    match ssh::console_state(&host.address, ssh, &user).await {
        Ok(ssh::ConsoleState::Console) => Ok(PrepareReport::new("ready", "")),
        Ok(ssh::ConsoleState::Remote) => {
            ssh::reclaim_console(&host.address, ssh, &user, host.rdp.reclaim_command.as_deref())
                .await?;
            Ok(PrepareReport::new(
                "reclaimed",
                "Brought the desktop back to the screen",
            ))
        }
        Ok(ssh::ConsoleState::None) => {
            // mstsc can't be driven non-interactively the way FreeRDP can, so
            // on Windows we can only tell the user what is wrong.
            if cfg!(target_os = "windows") {
                return Ok(PrepareReport::new(
                    "loginNeeded",
                    "Nobody is logged in on the PC",
                ));
            }
            let pw = match password {
                Some(p) => Some(p),
                None => crate::credentials::fetch_password(&host).await,
            };
            let Some(pw) = pw.filter(|p| !p.is_empty()) else {
                return Ok(PrepareReport::new(
                    "loginNeeded",
                    "Nobody is logged in on the PC",
                ));
            };
            rdp::login_and_reclaim(&host.address, &user, &pw, ssh, &user).await?;
            Ok(PrepareReport::new("loggedIn", "Logged in to the PC"))
        }
        Err(_) => Ok(PrepareReport::new("unknown", "")),
    }
}

/// Hand the desktop back to the physical console on demand — the manual
/// version of what the RDP watcher does automatically. This is the fix when
/// streaming shows a black screen after someone used remote desktop.
#[tauri::command]
pub async fn reclaim_console(app: AppHandle, host_id: String) -> Result<(), String> {
    let host = host_or_err(&app, &host_id)?;
    let ssh = host
        .ssh
        .as_ref()
        .ok_or_else(|| "SSH is not set up for this PC.".to_string())?;
    let user = host
        .rdp_username
        .clone()
        .unwrap_or_else(|| ssh.username.clone());
    ssh::reclaim_console(&host.address, ssh, &user, host.rdp.reclaim_command.as_deref()).await
}

#[tauri::command]
pub async fn has_rdp_password(app: AppHandle, host_id: String) -> Result<bool, String> {
    let host = host_or_err(&app, &host_id)?;
    Ok(crate::credentials::has_password(&host).await)
}

#[tauri::command]
pub async fn store_rdp_password(
    app: AppHandle,
    host_id: String,
    password: String,
) -> Result<(), String> {
    let host = host_or_err(&app, &host_id)?;
    crate::credentials::store_password(&host, &password).await
}

#[tauri::command]
pub async fn forget_rdp_password(app: AppHandle, host_id: String) -> Result<(), String> {
    let host = host_or_err(&app, &host_id)?;
    crate::credentials::clear_password(&host).await
}

#[tauri::command]
pub async fn sleep_host(app: AppHandle, host_id: String) -> Result<(), String> {
    let host = host_or_err(&app, &host_id)?;
    let ssh = host
        .ssh
        .ok_or_else(|| "SSH is not set up for this PC.".to_string())?;
    ssh::sleep_host(&host.address, &ssh).await
}

#[tauri::command]
pub async fn check_ssh(app: AppHandle, host_id: String) -> Result<bool, String> {
    let host = host_or_err(&app, &host_id)?;
    match host.ssh {
        Some(ssh) => Ok(ssh::check_ssh(&host.address, &ssh).await),
        None => Ok(false),
    }
}

#[tauri::command]
pub async fn list_apps(app: AppHandle, host_id: String) -> Result<Vec<String>, String> {
    let s = load_settings(&app)?;
    let host = settings::find_host(&s, &host_id).ok_or_else(|| NO_SUCH_HOST.to_string())?;
    moonlight::list_apps(s.moonlight_path_override.as_deref(), &host.address).await
}

#[tauri::command]
pub async fn quit_app(app: AppHandle, host_id: String) -> Result<(), String> {
    let s = load_settings(&app)?;
    let host = settings::find_host(&s, &host_id).ok_or_else(|| NO_SUCH_HOST.to_string())?;
    moonlight::quit_app(s.moonlight_path_override.as_deref(), &host.address).await
}
