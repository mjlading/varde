//! Orchestrates the Moonlight CLI: pairing (with a PIN the UI chose and passes
//! in) and launching streams with per-host quality applied as flags.
//! See docs/spike-moonlight-cli.md for why quality is passed as flags rather
//! than by patching Moonlight's stored config.

use crate::deps::{detect_moonlight, MoonlightLauncher};
use crate::settings::StreamQuality;
use crate::util::hide_console;
use serde::Serialize;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

use tauri::{AppHandle, Emitter};

/// Generation counter for stream launches. A background watcher only
/// auto-reconnects if no newer launch (or explicit quit) has superseded it.
static LAUNCH_GEN: AtomicU64 = AtomicU64::new(0);

/// Payload for the `stream:ended` event: fired when a launched stream's
/// process exits without being auto-reconnected (and when the reconnected
/// stream itself exits). Lets the UI refocus the launcher and offer a
/// follow-up (reconnect / sleep the PC).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamEnded {
    pub elapsed_secs: u64,
    pub errored: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairResult {
    pub paired: bool,
    pub message: String,
}

fn launcher(moonlight_override: Option<&str>) -> Result<MoonlightLauncher, String> {
    detect_moonlight(moonlight_override).ok_or_else(|| {
        "Moonlight is not installed. Install it, then try again.".to_string()
    })
}

fn base_command(l: &MoonlightLauncher) -> Command {
    let mut cmd = Command::new(l.program());
    cmd.args(l.base_args());
    cmd
}

/// Translate a quality preset into `moonlight stream` flags.
pub fn stream_args(address: &str, app_name: &str, q: &StreamQuality) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "stream".into(),
        address.into(),
        app_name.into(),
        "--resolution".into(),
        format!("{}x{}", q.width, q.height),
        "--fps".into(),
        q.fps.to_string(),
        "--bitrate".into(),
        q.bitrate_kbps.to_string(),
        if q.vsync { "--vsync" } else { "--no-vsync" }.into(),
        if q.frame_pacing {
            "--frame-pacing"
        } else {
            "--no-frame-pacing"
        }
        .into(),
        if q.hdr { "--hdr" } else { "--no-hdr" }.into(),
        "--display-mode".into(),
        "fullscreen".into(),
    ];
    if q.codec != "auto" {
        a.push("--video-codec".into());
        a.push(q.codec.clone());
    }
    a
}

/// Build the full `moonlight stream …` command (also used for auto-reconnect).
fn stream_command(l: &MoonlightLauncher, args: &[String]) -> Command {
    let mut cmd = base_command(l);
    cmd.args(args);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::piped());
    hide_console(&mut cmd);
    cmd
}

/// Launch a Moonlight stream. Waits briefly to surface immediate failures with a
/// friendly message; if the stream is still alive after that window, it's
/// considered launched and watched in the background: a stream that dies right
/// after launch is relaunched once. (The classic case: launching against a
/// locked Windows session — signing in re-arranges the host's displays, which
/// drops the first stream; the second connect then works.)
/// Undo a generation bump for a launch that never armed a watcher, so a
/// still-running previous stream (e.g. an auto-reconnect retry) keeps its
/// `stream:ended` reporting. CAS: a newer launch/quit is never clobbered.
fn rollback_generation(generation: u64) {
    let _ = LAUNCH_GEN.compare_exchange(
        generation,
        generation - 1,
        Ordering::SeqCst,
        Ordering::SeqCst,
    );
}

/// Invalidate any armed stream watcher, so a stream ending from here on is
/// neither auto-reconnected nor reported as `stream:ended`.
///
/// Needed whenever *we* are the reason the stream ends. The watcher can't tell
/// a deliberate kill from a crash, and within the reconnect window it would
/// helpfully relaunch the stream on top of whatever we opened instead.
pub fn supersede() {
    LAUNCH_GEN.fetch_add(1, Ordering::SeqCst);
}

/// Spawn a stream and walk away — the CLI's version of a launch. No watcher,
/// no auto-reconnect, no events: the caller has a terminal and can rerun.
pub fn launch_stream_detached(
    moonlight_override: Option<&str>,
    address: &str,
    app_name: &str,
    quality: &StreamQuality,
) -> Result<(), String> {
    let l = launcher(moonlight_override)?;
    let args = stream_args(address, app_name, quality);
    let mut child = stream_command(&l, &args)
        .spawn()
        .map_err(|e| format!("Could not start Moonlight: {e}"))?;
    drop(child.stderr.take());
    Ok(())
}

pub async fn launch_stream(
    app: AppHandle,
    moonlight_override: Option<&str>,
    address: &str,
    app_name: &str,
    quality: &StreamQuality,
) -> Result<(), String> {
    let l = launcher(moonlight_override)?;
    let args = stream_args(address, app_name, quality);
    let generation = LAUNCH_GEN.fetch_add(1, Ordering::SeqCst) + 1;

    let mut child = match stream_command(&l, &args).spawn() {
        Ok(c) => c,
        Err(e) => {
            rollback_generation(generation);
            return Err(format!("Could not start Moonlight: {e}"));
        }
    };
    let mut stderr = child.stderr.take();

    // Bind first so the `child.wait()` temporary's borrow ends before the match
    // body (letting us move `child` into a background task on the timeout arm).
    let waited = tokio::time::timeout(Duration::from_millis(2500), child.wait()).await;
    match waited {
        Ok(Ok(status)) => {
            // Exited inside the watch window — no watcher armed for this
            // generation, so restore the previous one's.
            rollback_generation(generation);
            if status.success() {
                Ok(())
            } else {
                let mut buf = String::new();
                if let Some(mut e) = stderr.take() {
                    let _ = e.read_to_string(&mut buf).await;
                }
                Err(friendly_stream_error(&buf))
            }
        }
        Ok(Err(e)) => {
            rollback_generation(generation);
            Err(format!("Moonlight did not start: {e}"))
        }
        Err(_) => {
            // Still running — the stream window is up. Watch it: if it dies
            // within the reconnect window (an error exit, or any exit in the
            // first minute — the login-screen drop), relaunch once, unless a
            // newer launch or an explicit quit has superseded this one. Any
            // other exit is reported to the UI as `stream:ended`.
            crate::session::set(crate::session::SessionKind::Stream, child.id());
            tokio::spawn(async move {
                let started = tokio::time::Instant::now();
                let pid = child.id();
                let status = child.wait().await;
                if let Some(pid) = pid {
                    crate::session::clear_pid(pid);
                }
                let elapsed = started.elapsed();
                let errored = matches!(&status, Ok(s) if !s.success());
                if LAUNCH_GEN.load(Ordering::SeqCst) != generation {
                    return;
                }
                let reconnectable = elapsed <= Duration::from_secs(180)
                    && (errored || elapsed < Duration::from_secs(60));
                if !reconnectable {
                    let _ = app.emit(
                        "stream:ended",
                        StreamEnded { elapsed_secs: elapsed.as_secs(), errored },
                    );
                    return;
                }
                let _ = app.emit("stream:reconnect", ());
                tokio::time::sleep(Duration::from_millis(1500)).await;
                if LAUNCH_GEN.load(Ordering::SeqCst) != generation {
                    return;
                }
                match stream_command(&l, &args).spawn() {
                    Ok(mut retry) => {
                        // Nothing ever reads the retry's stderr — drop the pipe
                        // now, or Moonlight blocks mid-session once it fills.
                        drop(retry.stderr.take());
                        let retry_started = tokio::time::Instant::now();
                        crate::session::set(crate::session::SessionKind::Stream, retry.id());
                        tokio::spawn(async move {
                            let retry_pid = retry.id();
                            let retry_status = retry.wait().await;
                            if let Some(p) = retry_pid {
                                crate::session::clear_pid(p);
                            }
                            let retry_elapsed = retry_started.elapsed();
                            let retry_errored =
                                matches!(&retry_status, Ok(s) if !s.success());
                            if LAUNCH_GEN.load(Ordering::SeqCst) != generation {
                                return;
                            }
                            let _ = app.emit(
                                "stream:ended",
                                StreamEnded {
                                    elapsed_secs: retry_elapsed.as_secs(),
                                    errored: retry_errored,
                                },
                            );
                        });
                    }
                    Err(_) => {
                        let _ = app.emit(
                            "stream:ended",
                            StreamEnded { elapsed_secs: 0, errored: true },
                        );
                    }
                }
            });
            Ok(())
        }
    }
}

/// Fetch the list of apps the host exposes (`moonlight list <host>`).
/// Verified live: app names print one per line on stdout; log noise goes to
/// stderr. Requires the host to be paired and awake.
pub async fn list_apps(
    moonlight_override: Option<&str>,
    address: &str,
) -> Result<Vec<String>, String> {
    let l = launcher(moonlight_override)?;
    let mut cmd = base_command(&l);
    cmd.args(["list", address]);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::null());
    hide_console(&mut cmd);

    let out = tokio::time::timeout(Duration::from_secs(15), cmd.output())
        .await
        .map_err(|_| "The PC did not answer while fetching the app list.".to_string())
        .and_then(|r| r.map_err(|e| format!("Could not run Moonlight: {e}")))?;

    if !out.status.success() {
        return Err("Could not fetch the app list. Check that the PC is awake and paired.".to_string());
    }

    let apps: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect();
    Ok(apps)
}

fn friendly_stream_error(stderr: &str) -> String {
    let s = stderr.to_ascii_lowercase();
    if s.contains("failed to find application") || s.contains("no app") || s.contains("not found") {
        "That app is not in the PC's list. Pick one in Settings and try again.".to_string()
    } else if s.contains("not paired") || s.contains("pair") {
        "This PC is not paired with Moonlight yet. Pair again in Settings, then try again."
            .to_string()
    } else if s.contains("resolve") || s.contains("unreachable") || s.contains("timed out")
        || s.contains("no route") || s.contains("refused")
    {
        "Moonlight could not reach the PC. Check that it is awake and on the same network.".to_string()
    } else {
        "Moonlight could not start the stream. Check that the PC is awake and paired.".to_string()
    }
}

/// Start pairing with a host using a PIN *we* chose. Emits `pair:log` for each
/// output line. Resolves when pairing completes, fails, or times out (the
/// process stays alive while the user enters the PIN on the host's web page).
///
/// The caller supplies the PIN and shows it; `moonlight pair --pin NNNN` makes
/// Moonlight use that exact code, so its own (unsuppressable) pairing dialog
/// displays the same number our UI does. We used to let Moonlight invent the
/// PIN and scrape it back with `\b(\d{4})\b` over merged stdout+stderr, which
/// latched onto the first four-digit token in Qt's log preamble and never
/// corrected itself — a tester was shown 1002 while Moonlight said 6242.
pub async fn start_pairing(
    app: AppHandle,
    moonlight_override: Option<&str>,
    address: &str,
    pin: &str,
) -> Result<PairResult, String> {
    let l = launcher(moonlight_override)?;
    let mut cmd = base_command(&l);
    cmd.args(["pair", address, "--pin", pin]);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true); // ensure the process dies if we time out
    hide_console(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start Moonlight pairing: {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    if let Some(out) = stdout {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(out).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = tx.send(line);
            }
        });
    }
    if let Some(err) = stderr {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = tx.send(line);
            }
        });
    }
    drop(tx); // original sender dropped; channel closes once both readers finish

    let emit_app = app.clone();

    let work = async move {
        while let Some(line) = rx.recv().await {
            let _ = emit_app.emit("pair:log", &line);
        }
        child.wait().await
    };

    match tokio::time::timeout(Duration::from_secs(150), work).await {
        Ok(Ok(status)) => {
            let paired = status.success();
            let message = if paired {
                "Paired.".to_string()
            } else {
                // The host names itself in the UI, which knows the flavour;
                // from here the neutral wording is the only true one.
                "Pairing was not confirmed. Enter the PIN on the PC's streaming \
                 web page, then try again."
                    .to_string()
            };
            Ok(PairResult { paired, message })
        }
        Ok(Err(e)) => Err(format!("Error in the pairing process: {e}")),
        Err(_) => Err(
            "Pairing took too long. Open the PC's streaming web page and enter \
             the PIN, then try again."
                .to_string(),
        ),
    }
}

/// Ask Moonlight to quit the currently running app on the host (best effort).
pub async fn quit_app(moonlight_override: Option<&str>, address: &str) -> Result<(), String> {
    // An explicit quit supersedes any pending auto-reconnect watcher.
    LAUNCH_GEN.fetch_add(1, Ordering::SeqCst);
    let l = launcher(moonlight_override)?;
    let mut cmd = base_command(&l);
    cmd.args(["quit", address]);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    hide_console(&mut cmd);
    let _ = cmd.status().await;
    Ok(())
}
