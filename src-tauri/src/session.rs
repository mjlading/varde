//! What Varde currently has up on screen.
//!
//! Both legs are child processes we launch and then stop owning — the stream
//! watcher and the RDP watcher each take their `Child` into a background task
//! so they can react to it exiting. To switch between them we need to end the
//! running one from the outside, so the PID is recorded here alongside what
//! kind of session it belongs to.
//!
//! PID rather than a shared `Child` handle: only one task can await a child,
//! and that task is the watcher, whose bookkeeping (auto-reconnect for the
//! stream, console reclaim for RDP) has to keep working when a switch is what
//! ended the session.

use serde::Serialize;
use std::process::Stdio;
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionKind {
    Stream,
    Rdp,
}

#[derive(Debug, Clone, Copy)]
struct Active {
    kind: SessionKind,
    pid: u32,
}

static ACTIVE: Mutex<Option<Active>> = Mutex::new(None);

/// Record a session that is now up. A `None` pid means the process didn't
/// report one, which leaves it unswitchable rather than wrongly killable.
pub fn set(kind: SessionKind, pid: Option<u32>) {
    let Some(pid) = pid else { return };
    if let Ok(mut g) = ACTIVE.lock() {
        *g = Some(Active { kind, pid });
    }
}

/// Forget a session, but only if it is still the one we think is live — a
/// slow watcher must not clear the entry of the session that replaced it.
pub fn clear_pid(pid: u32) {
    if let Ok(mut g) = ACTIVE.lock() {
        if g.map(|a| a.pid) == Some(pid) {
            *g = None;
        }
    }
}

pub fn current() -> Option<SessionKind> {
    ACTIVE.lock().ok().and_then(|g| g.map(|a| a.kind))
}

/// End whatever is running and say what it was. The watcher for that child
/// still runs and does its own cleanup; this only delivers the signal.
pub fn kill_current() -> Option<SessionKind> {
    let active = ACTIVE.lock().ok().and_then(|mut g| g.take())?;
    kill(active.pid);
    Some(active.kind)
}

fn kill(pid: u32) {
    // Shelling out keeps this dependency-free, and both tools are always
    // present on their platform. Errors are ignored: a process that already
    // exited is exactly the state we were trying to reach.
    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = std::process::Command::new("taskkill");
        c.args(["/PID", &pid.to_string(), "/T", "/F"]);
        c
    } else {
        let mut c = std::process::Command::new("kill");
        c.arg(pid.to_string());
        c
    };
    let _ = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}
