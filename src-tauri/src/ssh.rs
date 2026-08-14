//! Optional SSH integration: put the PC to sleep, and probe whether SSH is
//! usable (used to hide the Sleep feature unless it's actually configured).
//! Uses the system OpenSSH client with key-based auth (BatchMode) — no
//! passwords are handled or stored.

use crate::net::{is_port_open, resolve_ip};
use crate::settings::SshConfig;
use crate::util::hide_console;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

const SUSPEND_CMD: &str = "rundll32.exe powrprof.dll,SetSuspendState 0,1,0";

/// Finds the user's remote-desktop session and reconnects it to the physical
/// console. Markers (`DC-OK`, `DC-ALREADY`, `DC-NOSESSION`, `DC-FAIL`) let the
/// caller turn the outcome into a sentence instead of leaking `tscon` output.
const RECLAIM_PS: &str = r#"
$ErrorActionPreference='SilentlyContinue'
$u=$args[0]
$rows = @(query user 2>$null | Select-Object -Skip 1)
if ($rows.Count -eq 0) { Write-Output 'DC-NOSESSION'; exit 0 }
$mine = @($rows | Where-Object { $_ -match ('^[>\s]*' + [regex]::Escape($u) + '\s') })
if ($mine.Count -eq 0) { Write-Output 'DC-NOSESSION'; exit 0 }
$target = $mine | Where-Object { $_ -notmatch '\sconsole\s' } | Select-Object -First 1
if (-not $target) { Write-Output 'DC-ALREADY'; exit 0 }
$id = [regex]::Match($target, '\s(\d+)\s+(Active|Disc)').Groups[1].Value
if (-not $id) { Write-Output 'DC-NOSESSION'; exit 0 }
$e = (tscon $id /dest:console 2>&1)
if ($LASTEXITCODE -ne 0) { Write-Output ('DC-FAIL ' + $e); exit 0 }
Write-Output 'DC-OK'
"#;

/// Standard base64. Hand-rolled to keep `-EncodedCommand` dependency-free.
fn base64(input: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Reports where the user's Windows session currently lives.
const STATE_PS: &str = r#"
$ErrorActionPreference='SilentlyContinue'
$u=$args[0]
$rows = @(query user 2>$null | Select-Object -Skip 1)
$mine = @($rows | Where-Object { $_ -match ('^[>\s]*' + [regex]::Escape($u) + '\s') })
if ($mine.Count -eq 0) { Write-Output 'DC-NONE'; exit 0 }
$console = $mine | Where-Object { $_ -match '\sconsole\s' } | Select-Object -First 1
if ($console) { Write-Output 'DC-CONSOLE'; exit 0 }
Write-Output 'DC-REMOTE'
"#;

/// Where the user's desktop currently is — which decides whether streaming
/// will actually see anything.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConsoleState {
    /// Nobody is logged in. Streaming shows the Windows login screen, which
    /// no amount of reconnecting will get past.
    None,
    /// Logged in and on the physical console — streaming will capture it.
    Console,
    /// Logged in, but the session is parked on a remote-desktop connection.
    /// Streaming captures black until it is moved back.
    Remote,
}

/// Ask the host where the user's session is. Cheap enough to run before every
/// stream launch, and the answer is what makes "log in first, then stream"
/// possible instead of guessing from a stream that dies on the login screen.
pub async fn console_state(
    address: &str,
    ssh: &SshConfig,
    windows_user: &str,
) -> Result<ConsoleState, String> {
    let stdout =
        run_powershell(address, ssh, STATE_PS, windows_user, Duration::from_secs(15)).await?;
    if stdout.contains("DC-CONSOLE") {
        Ok(ConsoleState::Console)
    } else if stdout.contains("DC-REMOTE") {
        Ok(ConsoleState::Remote)
    } else if stdout.contains("DC-NONE") {
        Ok(ConsoleState::None)
    } else {
        Err("Could not read who is logged in on the PC.".to_string())
    }
}

/// The exact bytes handed to `powershell -EncodedCommand`: UTF-16LE, base64.
fn encoded_command(script: &str) -> String {
    let utf16: Vec<u8> = script.encode_utf16().flat_map(|c| c.to_le_bytes()).collect();
    base64(&utf16)
}

/// Run a PowerShell script on the host and hand back its stdout.
///
/// The script crosses SSH *and* cmd.exe before PowerShell sees it, and every
/// layer wants to reinterpret quotes, so it travels as `-EncodedCommand`
/// (UTF-16LE base64) rather than being quoted three times over. `arg` is
/// passed separately as `$args[0]`, so a surprising username can't rewrite
/// the script.
pub async fn run_powershell(
    address: &str,
    ssh: &SshConfig,
    script: &str,
    arg: &str,
    timeout: Duration,
) -> Result<String, String> {
    let mut cmd = ssh_base(address, ssh);
    cmd.arg(format!(
        "powershell -NoProfile -NonInteractive -EncodedCommand {} -- \"{}\"",
        encoded_command(script),
        arg.replace('"', "")
    ));
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let out = match tokio::time::timeout(timeout, cmd.output()).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(format!("Could not run SSH: {e}")),
        Err(_) => return Err("The PC did not answer in time.".to_string()),
    };
    let stderr = String::from_utf8_lossy(&out.stderr).to_ascii_lowercase();
    if stderr.contains("permission denied") || stderr.contains("publickey") {
        return Err("SSH could not log in to the PC.".to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// Run a command the user wrote themselves, verbatim. Success is the exit
/// status, since there are no markers to look for.
async fn run_raw(address: &str, ssh: &SshConfig, command: &str) -> Result<String, String> {
    let mut cmd = ssh_base(address, ssh);
    cmd.arg(command);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::null());

    match tokio::time::timeout(Duration::from_secs(20), cmd.output()).await {
        Ok(Ok(o)) if o.status.success() => Ok(String::from_utf8_lossy(&o.stdout).to_string()),
        Ok(Ok(_)) => Err("The command on the PC failed.".to_string()),
        Ok(Err(e)) => Err(format!("Could not run SSH: {e}")),
        Err(_) => Err("The PC did not answer in time.".to_string()),
    }
}

/// Hand the desktop back to the physical console after a remote-desktop detour.
///
/// RDP moves the logged-in session off the console. When the client
/// disconnects, that session is left in `Disc` state with nothing rendering on
/// the real GPU — so Sunshine/Apollo captures a black screen and streaming is
/// broken until someone walks over to the machine. `tscon <id> /dest:console`
/// reconnects the session to the console and streaming works again.
///
/// The script travels through SSH *and* cmd.exe before PowerShell sees it, and
/// each layer wants to reinterpret quotes, so it is sent as `-EncodedCommand`
/// (UTF-16LE base64) instead of being quoted three times over.
pub async fn reclaim_console(
    address: &str,
    ssh: &SshConfig,
    windows_user: &str,
    command: Option<&str>,
) -> Result<(), String> {
    let stdout = match command.map(str::trim).filter(|c| !c.is_empty()) {
        Some(custom) => {
            run_raw(address, ssh, &custom.replace("{user}", windows_user)).await?;
            return Ok(());
        }
        None => {
            run_powershell(address, ssh, RECLAIM_PS, windows_user, Duration::from_secs(20)).await?
        }
    };

    // DC-NOSESSION means nobody was logged in, so there was no session to
    // move — nothing went wrong, there was simply nothing to do.
    if stdout.contains("DC-OK") || stdout.contains("DC-ALREADY") || stdout.contains("DC-NOSESSION")
    {
        return Ok(());
    }
    if stdout.contains("DC-FAIL") {
        let low = stdout.to_ascii_lowercase();
        if low.contains("access is denied") || low.contains("nektet") {
            return Err("Windows refused to move the session back to the screen. tscon has to run with administrator rights — see the help text under Remote Desktop.".to_string());
        }
        return Err("Could not move the desktop session back to the screen.".to_string());
    }
    Err("Got no answer from the PC while bringing the desktop back.".to_string())
}

/// A key-based, non-interactive SSH invocation. Used for the host itself and
/// (by the wake module) for an always-on relay machine.
pub fn ssh_command(address: &str, username: &str, port: u16) -> Command {
    let mut cmd = Command::new("ssh");
    cmd.arg("-o").arg("BatchMode=yes")
        .arg("-o").arg("ConnectTimeout=6")
        .arg("-o").arg("StrictHostKeyChecking=accept-new")
        .arg("-p").arg(port.to_string())
        .arg(format!("{username}@{address}"));
    hide_console(&mut cmd);
    cmd
}

fn ssh_base(address: &str, ssh: &SshConfig) -> Command {
    ssh_command(address, &ssh.username, ssh.port)
}

/// Is SSH reachable and usable (port open + key auth succeeds)?
pub async fn check_ssh(address: &str, ssh: &SshConfig) -> bool {
    let ip = resolve_ip(address).unwrap_or_else(|| address.to_string());
    if !is_port_open(&ip, ssh.port, Duration::from_millis(1200)).await {
        return false;
    }
    let mut cmd = ssh_base(address, ssh);
    cmd.arg("echo varde-ok");
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::null());

    match tokio::time::timeout(Duration::from_secs(8), cmd.output()).await {
        Ok(Ok(out)) => String::from_utf8_lossy(&out.stdout).contains("varde-ok"),
        _ => false,
    }
}

/// Ask the PC to sleep. The SSH connection typically drops as the machine
/// suspends, so we only treat clear auth/connection failures as errors.
pub async fn sleep_host(address: &str, ssh: &SshConfig) -> Result<(), String> {
    let mut cmd = ssh_base(address, ssh);
    cmd.arg(SUSPEND_CMD);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not run SSH: {e}. Is the OpenSSH client installed?"))?;
    let mut stderr = child.stderr.take();

    let status = tokio::time::timeout(Duration::from_secs(12), child.wait()).await;
    let mut err_text = String::new();
    if let Some(mut e) = stderr.take() {
        let _ = tokio::time::timeout(Duration::from_secs(3), e.read_to_string(&mut err_text)).await;
    }
    let low = err_text.to_ascii_lowercase();

    if low.contains("permission denied") || low.contains("publickey") {
        return Err(
            "SSH could not log in. Set up key-based login on the PC, then try again."
                .to_string(),
        );
    }
    if low.contains("could not resolve") || low.contains("connection refused")
        || low.contains("no route") || low.contains("timed out")
    {
        return Err(
            "Could not reach the PC over SSH. Check that it is awake and reachable."
                .to_string(),
        );
    }
    match status {
        Ok(Ok(_)) => Ok(()),
        // Timeout / dropped connection is expected as the machine suspends.
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::{base64, encoded_command, RECLAIM_PS};

    #[test]
    fn base64_matches_known_vectors() {
        // The three padding cases, plus empty.
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"M"), "TQ==");
        assert_eq!(base64(b"Ma"), "TWE=");
        assert_eq!(base64(b"Man"), "TWFu");
        assert_eq!(base64(b"Hello"), "SGVsbG8=");
        // High bytes must not be sign-extended.
        assert_eq!(base64(&[0xff, 0xff, 0xff]), "////");
    }

    #[test]
    fn encoded_command_is_utf16le_base64() {
        // What PowerShell -EncodedCommand expects: each ASCII char becomes two
        // bytes, low byte first. "AB" -> 41 00 42 00 -> "QQBCAA==".
        assert_eq!(encoded_command("AB"), "QQBCAA==");
    }

    #[test]
    fn reclaim_script_survives_the_round_trip() {
        let encoded = encoded_command(RECLAIM_PS);
        assert!(!encoded.contains('\n'), "must be a single SSH argument");
        // Decode it back the way PowerShell would and check it is the script.
        let table = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let vals: Vec<u8> = encoded
            .bytes()
            .filter(|b| *b != b'=')
            .map(|b| table.iter().position(|t| *t == b).unwrap() as u8)
            .collect();
        let mut bytes = Vec::new();
        for chunk in vals.chunks(4) {
            let mut n = 0u32;
            for (i, v) in chunk.iter().enumerate() {
                n |= u32::from(*v) << (18 - 6 * i);
            }
            for i in 0..chunk.len() - 1 {
                bytes.push((n >> (16 - 8 * i)) as u8);
            }
        }
        let units: Vec<u16> = bytes
            .chunks(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        assert_eq!(String::from_utf16(&units).unwrap(), RECLAIM_PS);
    }
}
