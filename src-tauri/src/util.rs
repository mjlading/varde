//! Small cross-cutting helpers.

use tokio::process::Command;

/// Prevent a console window from flashing when we spawn a child process from
/// our GUI (Windows only; a no-op elsewhere).
#[cfg(target_os = "windows")]
pub fn hide_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
pub fn hide_console(_cmd: &mut Command) {}
