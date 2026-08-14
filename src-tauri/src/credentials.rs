//! Optional, opt-in storage of the RDP password in the OS credential store —
//! never in settings.json.
//!
//! Linux:   GNOME Keyring / any org.freedesktop.secrets provider, via the
//!          libsecret CLI (`secret-tool`). Verified live on this machine.
//! Windows: Credential Manager via `cmdkey /generic:TERMSRV/<host>` — the
//!          native mechanism mstsc reads on its own, so there is nothing to
//!          fetch: storing it makes mstsc connect silently.

use crate::settings::Host;
use crate::util::hide_console;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

const SERVICE: &str = "varde";
/// The service name from before the rename. Read (and cleared) so passwords
/// saved by a DeskConnect-era install keep working; never written again.
const LEGACY_SERVICE: &str = "deskconnect";

/// secret-tool talks to the session bus; make sure the address is set even if
/// we were spawned from a bare shell.
#[cfg(not(target_os = "windows"))]
fn session_bus_env(cmd: &mut Command) {
    if std::env::var_os("DBUS_SESSION_BUS_ADDRESS").is_none() {
        let uid = std::env::var("UID")
            .ok()
            .or_else(|| {
                std::fs::read_to_string("/proc/self/loginuid")
                    .ok()
                    .map(|s| s.trim().to_string())
            })
            .unwrap_or_else(|| "1000".to_string());
        cmd.env(
            "DBUS_SESSION_BUS_ADDRESS",
            format!("unix:path=/run/user/{uid}/bus"),
        );
    }
}

#[cfg(not(target_os = "windows"))]
pub async fn store_password(host: &Host, password: &str) -> Result<(), String> {
    let mut cmd = Command::new("secret-tool");
    cmd.args([
        "store",
        "--label",
        &format!("Varde RDP ({})", host.name),
        "service",
        SERVICE,
        "rdp-host",
        &host.id,
    ]);
    session_bus_env(&mut cmd);
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    hide_console(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|_| "The system keyring is not available (secret-tool was not found).".to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(password.as_bytes())
            .await
            .map_err(|e| format!("Could not hand the password to the system keyring: {e}"))?;
        drop(stdin);
    }
    // Generous timeout: the keyring may pop an unlock dialog.
    let status = tokio::time::timeout(Duration::from_secs(60), child.wait())
        .await
        .map_err(|_| "The system keyring did not answer. Is it unlocked?".to_string())
        .and_then(|r| r.map_err(|e| format!("Keyring error: {e}")))?;
    if status.success() {
        Ok(())
    } else {
        Err("The system keyring would not store the password.".to_string())
    }
}

#[cfg(not(target_os = "windows"))]
async fn lookup(service: &str, host: &Host) -> Option<String> {
    let mut cmd = Command::new("secret-tool");
    cmd.args(["lookup", "service", service, "rdp-host", &host.id]);
    session_bus_env(&mut cmd);
    cmd.stdin(Stdio::null());
    cmd.stderr(Stdio::null());
    hide_console(&mut cmd);

    let out = tokio::time::timeout(Duration::from_secs(30), cmd.output())
        .await
        .ok()?
        .ok()?;
    if !out.status.success() || out.stdout.is_empty() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg(not(target_os = "windows"))]
pub async fn fetch_password(host: &Host) -> Option<String> {
    match lookup(SERVICE, host).await {
        Some(p) => Some(p),
        None => lookup(LEGACY_SERVICE, host).await,
    }
}

#[cfg(not(target_os = "windows"))]
pub async fn has_password(host: &Host) -> bool {
    fetch_password(host).await.is_some()
}

#[cfg(not(target_os = "windows"))]
pub async fn clear_password(host: &Host) -> Result<(), String> {
    // Forget must really forget: also clear the pre-rename entry, or the
    // legacy fallback in fetch_password would resurrect it.
    let mut legacy = Command::new("secret-tool");
    legacy.args(["clear", "service", LEGACY_SERVICE, "rdp-host", &host.id]);
    session_bus_env(&mut legacy);
    legacy.stdin(Stdio::null());
    legacy.stdout(Stdio::null());
    legacy.stderr(Stdio::null());
    hide_console(&mut legacy);
    let _ = tokio::time::timeout(Duration::from_secs(30), legacy.status()).await;

    let mut cmd = Command::new("secret-tool");
    cmd.args(["clear", "service", SERVICE, "rdp-host", &host.id]);
    session_bus_env(&mut cmd);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    hide_console(&mut cmd);
    let status = tokio::time::timeout(Duration::from_secs(30), cmd.status())
        .await
        .map_err(|_| "The system keyring did not answer.".to_string())
        .and_then(|r| r.map_err(|e| format!("Keyring error: {e}")))?;
    // `clear` also exits 0 when nothing matched, which suits "forget" fine.
    if status.success() {
        Ok(())
    } else {
        Err("Could not remove the saved password from the system keyring.".to_string())
    }
}

/* ------------------------------- Windows ---------------------------------- */

#[cfg(target_os = "windows")]
fn termsrv_target(host: &Host) -> String {
    format!("TERMSRV/{}", host.address)
}

// NOTE: `cmdkey /pass:` places the password on the process command line, which
// is readable by same-user processes while it runs and, on hosts with
// command-line auditing (Event 4688) or Sysmon, is durably logged. That's an
// accepted trade-off for a private single-user PC; a hardened version would
// store the credential via the DPAPI/CredWrite API from a helper instead.
#[cfg(target_os = "windows")]
pub async fn store_password(host: &Host, password: &str) -> Result<(), String> {
    let user = host
        .rdp_username
        .as_deref()
        .filter(|u| !u.trim().is_empty())
        .ok_or_else(|| "Enter a Windows username in Settings first.".to_string())?;
    let mut cmd = Command::new("cmdkey");
    cmd.arg(format!("/generic:{}", termsrv_target(host)))
        .arg(format!("/user:{user}"))
        .arg(format!("/pass:{password}"));
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    hide_console(&mut cmd);
    let status = tokio::time::timeout(Duration::from_secs(15), cmd.status())
        .await
        .map_err(|_| "Windows Credential Manager did not answer.".to_string())
        .and_then(|r| r.map_err(|e| format!("Could not run cmdkey: {e}")))?;
    if status.success() {
        Ok(())
    } else {
        Err("Windows would not store the password in Credential Manager.".to_string())
    }
}

/// mstsc reads TERMSRV credentials itself; we never need the value back.
#[cfg(target_os = "windows")]
pub async fn fetch_password(_host: &Host) -> Option<String> {
    None
}

#[cfg(target_os = "windows")]
pub async fn has_password(host: &Host) -> bool {
    let mut cmd = Command::new("cmdkey");
    cmd.arg(format!("/list:{}", termsrv_target(host)));
    cmd.stdin(Stdio::null());
    cmd.stderr(Stdio::null());
    hide_console(&mut cmd);
    match tokio::time::timeout(Duration::from_secs(10), cmd.output()).await {
        // cmdkey echoes the filter ("TERMSRV/<addr>") in its header even when
        // nothing matches; an actual entry is identified by a "Target:" line.
        Ok(Ok(out)) => String::from_utf8_lossy(&out.stdout).contains("Target:"),
        _ => false,
    }
}

#[cfg(target_os = "windows")]
pub async fn clear_password(host: &Host) -> Result<(), String> {
    let mut cmd = Command::new("cmdkey");
    cmd.arg(format!("/delete:{}", termsrv_target(host)));
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    hide_console(&mut cmd);
    let _ = tokio::time::timeout(Duration::from_secs(10), cmd.status()).await;
    Ok(())
}
