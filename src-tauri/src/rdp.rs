//! Launch an RDP session. On Linux this shells out to FreeRDP; on Windows it
//! writes a temporary `.rdp` file and hands it to the built-in `mstsc`, which
//! shows its own native credential prompt.

use crate::deps::detect_freerdp;
use crate::settings::{GfxMode, RdpOptions, SshConfig};
use crate::ssh;
use crate::util::hide_console;
use serde::Serialize;
use std::process::Stdio;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

/// Everything the session watcher needs to hand the desktop back to the
/// physical console once the user closes their remote-desktop window.
#[derive(Clone)]
pub struct ReclaimCtx {
    pub app: AppHandle,
    pub address: String,
    pub ssh: SshConfig,
    pub windows_user: String,
    pub command: Option<String>,
}

/// Emitted when the remote-desktop window closes, so the UI can say whether
/// streaming will work again without anyone walking over to the machine.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpEnded {
    pub reclaimed: bool,
    pub error: Option<String>,
}

/// Launch RDP to `address` as `username`. `password` is optional and never
/// persisted — it is only forwarded to this one launch when supplied.
pub async fn launch_rdp(
    address: &str,
    username: Option<&str>,
    password: Option<&str>,
    options: &RdpOptions,
    reclaim: Option<ReclaimCtx>,
) -> Result<(), String> {
    if cfg!(target_os = "windows") {
        launch_mstsc(address, username, options, reclaim).await
    } else {
        launch_freerdp(address, username, password, options, reclaim).await
    }
}

/// Wait for the remote-desktop client to exit, then put the session back on
/// the console. Streaming captures the console, so skipping this leaves the
/// host showing a black screen to Moonlight until someone logs in locally.
fn watch_and_reclaim(mut child: tokio::process::Child, reclaim: Option<ReclaimCtx>) {
    crate::session::set(crate::session::SessionKind::Rdp, child.id());
    tokio::spawn(async move {
        let pid = child.id();
        let _ = child.wait().await;
        if let Some(pid) = pid {
            crate::session::clear_pid(pid);
        }
        let Some(ctx) = reclaim else { return };
        let outcome =
            ssh::reclaim_console(&ctx.address, &ctx.ssh, &ctx.windows_user, ctx.command.as_deref())
                .await;
        let payload = match outcome {
            Ok(()) => RdpEnded { reclaimed: true, error: None },
            Err(e) => RdpEnded { reclaimed: false, error: Some(e) },
        };
        let _ = ctx.app.emit("rdp:ended", payload);
    });
}

/// What the remote-desktop picture quality actually depends on, host-side.
///
/// Asking for `/gfx:AVC444` from the client is not enough: Windows ignores
/// the request unless the "Prioritize H.264/AVC 444" policy is set on the
/// host, and delivers 30 fps unless DWMFRAMEINTERVAL raises the cap to its
/// documented maximum of 60. Both are plain registry values, both invisible
/// from the client — and we have SSH.
const HOST_CHECK_PS: &str = r#"
$ErrorActionPreference='SilentlyContinue'
$avc = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services' -Name AVC444ModePreferred).AVC444ModePreferred
if ($avc -eq 1) { Write-Output 'DC-AVC444 on' } else { Write-Output 'DC-AVC444 off' }
$fi = (Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations' -Name DWMFRAMEINTERVAL).DWMFRAMEINTERVAL
if ($null -eq $fi) { Write-Output 'DC-FPS default' }
elseif ($fi -eq 15) { Write-Output 'DC-FPS 60' }
else { Write-Output ('DC-FPS other ' + $fi) }
"#;

const HOST_OPTIMIZE_PS: &str = r#"
$ErrorActionPreference='Stop'
try {
  New-Item -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services' -Force | Out-Null
  Set-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services' -Name AVC444ModePreferred -Value 1 -Type DWord
  Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations' -Name DWMFRAMEINTERVAL -Value 15 -Type DWord
  Write-Output 'DC-APPLIED'
} catch {
  Write-Output ('DC-DENIED ' + $_.Exception.Message)
}
"#;

fn avc_check(on: bool) -> crate::wake::WakeCheck {
    crate::wake::WakeCheck {
        ok: on,
        warn: false,
        label: if on {
            "The host allows sharp video (AVC 4:4:4)".into()
        } else {
            "The host ignores the request for sharp video".into()
        },
        detail: if on {
            "Windows is set up to use H.264 4:4:4 when the client asks for it — text stays sharp.".into()
        } else {
            "Varde asks for H.264 4:4:4, but Windows won't use it until the \"Prioritize H.264/AVC 444\" policy is turned on on the host.".into()
        },
        fix: (!on).then(|| "Press \"Set up the host\", or set AVC444ModePreferred=1 under HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Terminal Services yourself.".to_string()),
    }
}

fn fps_check(state: &str) -> crate::wake::WakeCheck {
    let at60 = state == "60";
    crate::wake::WakeCheck {
        ok: at60,
        warn: false,
        label: if at60 {
            "The host delivers 60 frames per second".into()
        } else {
            "The host only delivers 30 frames per second".into()
        },
        detail: if at60 {
            "The frame-rate cap has been raised to 60 — the Remote Desktop protocol doesn't go any higher.".into()
        } else {
            "Windows limits Remote Desktop to 30 frames per second by default. The cap can be raised to 60 — the protocol's maximum.".into()
        },
        fix: (!at60).then(|| "Press \"Set up the host\" (the PC needs a restart afterwards), or set DWMFRAMEINTERVAL=15 under HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations yourself.".to_string()),
    }
}

fn parse_host_checks(raw: &str) -> Vec<crate::wake::WakeCheck> {
    let mut checks = Vec::new();
    for line in raw.lines().map(str::trim) {
        if let Some(v) = line.strip_prefix("DC-AVC444 ") {
            checks.push(avc_check(v == "on"));
        } else if let Some(v) = line.strip_prefix("DC-FPS ") {
            checks.push(fps_check(v.split_whitespace().next().unwrap_or("default")));
        }
    }
    checks
}

/// Read the host-side registry state that decides remote-desktop quality.
pub async fn host_check(
    address: &str,
    ssh_cfg: &SshConfig,
) -> Result<Vec<crate::wake::WakeCheck>, String> {
    let raw = ssh::run_powershell(address, ssh_cfg, HOST_CHECK_PS, "", Duration::from_secs(20)).await?;
    let checks = parse_host_checks(&raw);
    if checks.is_empty() {
        return Err("Could not read the settings on the PC.".to_string());
    }
    Ok(checks)
}

/// Apply both quality settings, then read the state back so the UI shows what
/// actually happened rather than what we hoped.
pub async fn host_optimize(
    address: &str,
    ssh_cfg: &SshConfig,
) -> Result<Vec<crate::wake::WakeCheck>, String> {
    let raw =
        ssh::run_powershell(address, ssh_cfg, HOST_OPTIMIZE_PS, "", Duration::from_secs(25)).await?;
    if raw.contains("DC-DENIED") {
        return Err(
            "Windows refused to change the settings — the SSH user needs administrator rights on the PC."
                .to_string(),
        );
    }
    if !raw.contains("DC-APPLIED") {
        return Err("Could not change the settings on the PC.".to_string());
    }
    host_check(address, ssh_cfg).await
}

/// Log the user in without anyone touching the machine, then hand the desktop
/// straight back to the console so streaming can capture it.
///
/// A headless PC that has just woken sits at the Windows login screen.
/// Moonlight connects fine, but there is nothing behind the lock screen to
/// stream and no amount of reconnecting gets past it — somebody has to log in.
/// So we do it the only way possible from here: open a real remote-desktop
/// session with the saved credentials, which performs the login, wait for the
/// desktop to exist, then `tscon` it onto the console and close the window.
pub async fn login_and_reclaim(
    address: &str,
    username: &str,
    password: &str,
    ssh: &SshConfig,
    windows_user: &str,
) -> Result<(), String> {
    let bin = detect_freerdp().ok_or_else(|| {
        "FreeRDP is not installed, so the PC can't be logged in automatically.".to_string()
    })?;

    // This window exists only long enough to complete a login, so it gets none
    // of the session comforts — no sound, no clipboard, no fullscreen.
    let mut cmd = Command::new(&bin);
    cmd.args([
        format!("/v:{address}"),
        "/cert:ignore".to_string(),
        format!("/u:{username}"),
        format!("/p:{password}"),
        "/w:800".to_string(),
        "/h:600".to_string(),
        "-clipboard".to_string(),
        "/gfx:AVC420".to_string(),
    ]);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    hide_console(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start FreeRDP: {e}"))?;

    // Poll rather than sleep a fixed amount: a warm machine is ready in a few
    // seconds, one that just booted can take half a minute.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(45);
    let mut logged_in = false;
    while tokio::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_secs(3)).await;
        if matches!(child.try_wait(), Ok(Some(_))) {
            // The client exited on its own — almost always rejected credentials.
            break;
        }
        if matches!(
            ssh::console_state(address, ssh, windows_user).await,
            Ok(ssh::ConsoleState::Remote) | Ok(ssh::ConsoleState::Console)
        ) {
            logged_in = true;
            break;
        }
    }

    if !logged_in {
        let _ = child.kill().await;
        return Err(
            "Could not log in to the PC automatically. Check the username and password.".to_string(),
        );
    }

    // Moving the session disconnects the remote-desktop client as a side
    // effect, so the kill below is only a safety net.
    let result = ssh::reclaim_console(address, ssh, windows_user, None).await;
    tokio::time::sleep(Duration::from_millis(600)).await;
    let _ = child.kill().await;
    result
}

async fn launch_freerdp(
    address: &str,
    username: Option<&str>,
    password: Option<&str>,
    options: &RdpOptions,
    reclaim: Option<ReclaimCtx>,
) -> Result<(), String> {
    let bin = detect_freerdp().ok_or_else(|| {
        "FreeRDP is not installed. Install it to use Work (RDP).".to_string()
    })?;

    let mut args: Vec<String> = vec![
        format!("/v:{address}"),
        "/cert:ignore".into(),
    ];
    if let Some(u) = username.filter(|u| !u.trim().is_empty()) {
        args.push(format!("/u:{u}"));
    }
    if let Some(p) = password.filter(|p| !p.is_empty()) {
        args.push(format!("/p:{p}"));
    }
    if options.fullscreen {
        // Fullscreen, with FreeRDP's floating bar as the visible way out
        // (it also exposes minimize/close; Ctrl+Alt+Enter toggles windowed).
        args.push("+f".into());
        args.push("/floatbar:sticky:off,default:visible,show:fullscreen".into());
    }
    if options.dynamic_resolution {
        args.push("/dynamic-resolution".into());
    }
    // The RDP8 graphics pipeline. Windows classifies dirty rectangles and only
    // routes the moving ones through H.264, so a video playing in a window
    // stays smooth while the text around it stays lossless. Both ends
    // negotiate: if the host doesn't offer AVC444 FreeRDP falls back within
    // the channel, and if it doesn't offer GFX at all we land on the legacy
    // bitmap path anyway — so asking for it is safe.
    match options.gfx {
        GfxMode::Off => {}
        GfxMode::Avc420 => args.push("/gfx:AVC420".into()),
        GfxMode::Avc444 => args.push("/gfx:AVC444".into()),
    }
    args.push(if options.clipboard {
        "+clipboard".into()
    } else {
        "-clipboard".into()
    });
    if options.audio {
        args.push("/sound".into());
    }

    let mut cmd = Command::new(&bin);
    cmd.args(&args);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::piped());
    hide_console(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start FreeRDP: {e}"))?;
    let mut stderr = child.stderr.take();

    // Bind first so the borrow from `child.wait()` ends before the match body.
    let waited = tokio::time::timeout(Duration::from_millis(2500), child.wait()).await;
    match waited {
        Ok(Ok(status)) => {
            if status.success() {
                Ok(())
            } else {
                let mut buf = String::new();
                if let Some(mut e) = stderr.take() {
                    let _ = e.read_to_string(&mut buf).await;
                }
                Err(friendly_rdp_error(&buf))
            }
        }
        Ok(Err(e)) => Err(format!("FreeRDP did not start: {e}")),
        // Still alive past the watch window, so the connection took: hand off
        // to the watcher that reclaims the console when the user closes it.
        Err(_) => {
            watch_and_reclaim(child, reclaim);
            Ok(())
        }
    }
}

fn friendly_rdp_error(stderr: &str) -> String {
    let s = stderr.to_ascii_lowercase();
    if s.contains("logon") || s.contains("password") || s.contains("credential")
        || s.contains("authentication") || s.contains("access denied")
    {
        "RDP login failed. Check the username and password for the PC.".to_string()
    } else if s.contains("connection") || s.contains("unable to connect")
        || s.contains("timeout") || s.contains("refused") || s.contains("resolve")
    {
        "Could not reach the PC over RDP. Check that it is awake and that Remote Desktop is turned on."
            .to_string()
    } else {
        "RDP could not connect. Check that the PC is awake and that Remote Desktop is turned on."
            .to_string()
    }
}

async fn launch_mstsc(
    address: &str,
    username: Option<&str>,
    options: &RdpOptions,
    reclaim: Option<ReclaimCtx>,
) -> Result<(), String> {
    let audiomode = if options.audio { 0 } else { 2 };
    let clipboard = if options.clipboard { 1 } else { 0 };
    let dynres = if options.dynamic_resolution { 1 } else { 0 };
    let screen_mode = if options.fullscreen { 2 } else { 1 };
    let user_line = username
        .filter(|u| !u.trim().is_empty())
        .map(|u| format!("username:s:{u}\n"))
        .unwrap_or_default();
    // mstsc picks the graphics pipeline codec itself — there is no AVC444
    // switch in an .rdp file. What we *can* set is how generous it is allowed
    // to be: network auto-detect plus connection type 7 ("auto detect") lets
    // it negotiate the full H.264 pipeline, while type 2 biases it toward the
    // conservative low-bandwidth path when the user has turned GFX off.
    let connection_type = if options.gfx == GfxMode::Off { 2 } else { 7 };
    let autodetect = if options.gfx == GfxMode::Off { 0 } else { 1 };

    // No "prompt for credentials:i:1": with credentials saved in Credential
    // Manager (TERMSRV/<host>) mstsc connects silently; without them, NLA
    // prompts on its own.
    let content = format!(
        "full address:s:{address}\n\
         {user_line}\
         audiomode:i:{audiomode}\n\
         redirectclipboard:i:{clipboard}\n\
         dynamic resolution:i:{dynres}\n\
         smart sizing:i:1\n\
         authentication level:i:2\n\
         screen mode id:i:{screen_mode}\n\
         networkautodetect:i:{autodetect}\n\
         bandwidthautodetect:i:{autodetect}\n\
         connection type:i:{connection_type}\n"
    );

    let file = std::env::temp_dir().join(format!("varde-{}.rdp", uuid::Uuid::new_v4()));
    std::fs::write(&file, content).map_err(|e| format!("Could not write the RDP file: {e}"))?;

    let mut cmd = Command::new("mstsc");
    cmd.arg(&file);
    hide_console(&mut cmd);
    let child = cmd
        .spawn()
        .map_err(|e| format!("Could not start Remote Desktop: {e}"))?;
    watch_and_reclaim(child, reclaim);

    // mstsc reads the file at startup; clean it up shortly after.
    let cleanup = file.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(25)).await;
        let _ = std::fs::remove_file(cleanup);
    });

    Ok(())
}
