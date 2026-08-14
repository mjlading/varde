//! The terminal face of Varde.
//!
//! `varde <command>` runs headless and exits — no window, no tray. It reads
//! the same settings.json the app maintains and drives the same domain
//! modules, so a keybinding, a rofi entry, or a script can do everything the
//! launcher does: `varde wake && varde play`.
//!
//! Windows note: release builds use the windows subsystem, so stdout is
//! invisible unless run from a console that captures it. The CLI is
//! Linux-first by design.

use crate::settings::{Host, Settings};
use crate::{credentials, moonlight, net, rdp, ssh, wake};
use std::path::PathBuf;
use std::time::Duration;

const HELP: &str = "\
Varde — wake, stream and remote into your PC from the terminal.

USAGE
  varde <command> [host]

COMMANDS
  status    Reachability, stream/RDP ports and busy-state of the PC
  wake      Fire every configured wake transport (WoL, HTTP, SSH relay)
  play      Wake if needed, then stream the game app (Steam)
  desktop   Wake if needed, then stream the full desktop
  work      Wake if needed, then open Remote Desktop
  sleep     Put the PC to sleep over SSH
  hosts     List configured PCs
  help      This text

[host] is the PC's name from the app (first match wins); the active PC is
used when omitted. Configuration lives in the Varde app — run it once to
set up a PC before using the CLI.";

/// Entry point from main(). Parses, runs on a private runtime, exits.
pub fn run(args: Vec<String>) {
    let cmd = args[0].as_str();
    let host_arg = args.get(1).map(String::as_str);

    if matches!(cmd, "help" | "--help" | "-h") {
        println!("{HELP}");
        std::process::exit(0);
    }

    let rt = match tokio::runtime::Runtime::new() {
        Ok(rt) => rt,
        Err(e) => fail(&format!("could not start async runtime: {e}")),
    };
    let code = rt.block_on(dispatch(cmd, host_arg));
    // Leak the runtime instead of dropping it: background tasks (an RDP
    // watch window, a detached child's plumbing) must not be torn down by
    // runtime shutdown racing process exit.
    std::mem::forget(rt);
    std::process::exit(code);
}

fn fail(msg: &str) -> ! {
    eprintln!("varde: {msg}");
    std::process::exit(1);
}

async fn dispatch(cmd: &str, host_arg: Option<&str>) -> i32 {
    let settings = match load_settings() {
        Ok(s) => s,
        Err(e) => fail(&e),
    };

    if cmd == "hosts" {
        if settings.hosts.is_empty() {
            println!("No PCs configured yet — run the Varde app once to set one up.");
            return 0;
        }
        for h in &settings.hosts {
            let active = settings.active_host_id.as_deref() == Some(h.id.as_str());
            println!(
                "{}{}  {}  [{}]",
                h.name,
                if active { " *" } else { "" },
                h.address,
                h.macs.join(", ")
            );
        }
        return 0;
    }

    let host = match pick_host(&settings, host_arg) {
        Ok(h) => h,
        Err(e) => fail(&e),
    };

    match cmd {
        "status" => status(host).await,
        "wake" => wake_cmd(host).await,
        "sleep" => sleep_cmd(host).await,
        "play" | "desktop" => stream_cmd(&settings, host, cmd == "play").await,
        "work" => work_cmd(host).await,
        other => {
            eprintln!("varde: unknown command \"{other}\"\n\n{HELP}");
            2
        }
    }
}

/* ------------------------------ commands ---------------------------------- */

async fn status(host: &Host) -> i32 {
    let st = net::host_status(&host.address).await;
    println!("{}  {}", host.name, host.address);
    println!("  state    {}", st.state);
    println!("  network  {}", if st.reachable { "reachable" } else { "unreachable" });
    println!("  stream   {}", if st.stream_open { "open" } else { "closed" });
    println!("  rdp      {}", if st.rdp_open { "open" } else { "closed" });
    if st.in_use {
        println!("  note     someone is streaming from it right now");
    }
    if st.reachable {
        0
    } else {
        1
    }
}

async fn wake_cmd(host: &Host) -> i32 {
    match wake::wake_host(host, &host.address).await {
        Ok(report) => {
            for a in &report.attempts {
                println!("  {}  {}  {}", if a.ok { "ok " } else { "err" }, a.method, a.detail);
            }
            0
        }
        Err(e) => {
            eprintln!("varde: {e}");
            1
        }
    }
}

async fn sleep_cmd(host: &Host) -> i32 {
    let Some(ssh_cfg) = host.ssh.as_ref() else {
        fail("SSH is not configured for this PC (needed for sleep)");
    };
    match ssh::sleep_host(&host.address, ssh_cfg).await {
        Ok(()) => {
            println!("{} is going to sleep.", host.name);
            0
        }
        Err(e) => {
            eprintln!("varde: {e}");
            1
        }
    }
}

async fn stream_cmd(settings: &Settings, host: &Host, play: bool) -> i32 {
    if !ensure_awake(host, false).await {
        return 1;
    }
    let app_name = if play { &host.steam_app_name } else { &host.desktop_app_name };
    // No display to measure from a terminal: Auto falls back to 1080p60.
    let quality = host.effective_quality(None);
    match moonlight::launch_stream_detached(
        settings.moonlight_path_override.as_deref(),
        &host.address,
        app_name,
        &quality,
    ) {
        Ok(()) => {
            println!("Streaming \"{app_name}\" from {}.", host.name);
            0
        }
        Err(e) => {
            eprintln!("varde: {e}");
            1
        }
    }
}

async fn work_cmd(host: &Host) -> i32 {
    if !ensure_awake(host, true).await {
        return 1;
    }
    let password = credentials::fetch_password(host).await;
    match rdp::launch_rdp(
        &host.address,
        host.rdp_username.as_deref(),
        password.as_deref(),
        &host.rdp,
        None,
    )
    .await
    {
        Ok(()) => {
            println!("Remote Desktop to {} is opening.", host.name);
            0
        }
        Err(e) => {
            eprintln!("varde: {e}");
            1
        }
    }
}

/// The CLI version of the app's wake-then-wait flow: probe, wake if needed,
/// poll until the right port answers (or 90s passes).
async fn ensure_awake(host: &Host, needs_rdp: bool) -> bool {
    let ready = |st: &net::HostStatus| if needs_rdp { st.rdp_open } else { st.stream_open };

    let st = net::host_status(&host.address).await;
    if ready(&st) {
        return true;
    }
    if st.reachable {
        eprintln!(
            "varde: {} is awake but the {} service is not answering",
            host.name,
            if needs_rdp { "Remote Desktop" } else { "streaming" }
        );
        return false;
    }

    println!("Waking {}…", host.name);
    if let Err(e) = wake::wake_host(host, &host.address).await {
        eprintln!("varde: {e}");
        return false;
    }

    let deadline = tokio::time::Instant::now() + Duration::from_secs(90);
    while tokio::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(2000)).await;
        let st = net::host_status(&host.address).await;
        if ready(&st) {
            println!("{} is up.", host.name);
            return true;
        }
    }
    eprintln!("varde: {} did not come up within 90s", host.name);
    false
}

/* ------------------------------ settings ---------------------------------- */

fn pick_host<'a>(settings: &'a Settings, name: Option<&str>) -> Result<&'a Host, String> {
    if settings.hosts.is_empty() {
        return Err("no PCs configured yet — run the Varde app once to set one up".into());
    }
    match name {
        Some(n) => {
            let lc = n.to_lowercase();
            settings
                .hosts
                .iter()
                .find(|h| h.name.to_lowercase() == lc)
                .or_else(|| settings.hosts.iter().find(|h| h.name.to_lowercase().contains(&lc)))
                .ok_or_else(|| format!("no PC named \"{n}\" (see `varde hosts`)"))
        }
        None => Ok(settings
            .active_host_id
            .as_ref()
            .and_then(|id| settings.hosts.iter().find(|h| &h.id == id))
            .unwrap_or(&settings.hosts[0])),
    }
}

/// The same file the app maintains, resolved without a Tauri runtime. Mirrors
/// tauri's app_config_dir for our identifier, legacy DeskConnect dir included.
fn load_settings() -> Result<Settings, String> {
    for ident in ["io.github.mjlading.varde", "com.deskconnect.app"] {
        let Some(path) = config_base().map(|b| b.join(ident).join("settings.json")) else {
            continue;
        };
        match std::fs::read_to_string(&path) {
            Ok(contents) => {
                return serde_json::from_str(&contents)
                    .map_err(|e| format!("{} is corrupt: {e}", path.display()));
            }
            Err(_) => continue,
        }
    }
    Err("no settings found — run the Varde app once to set up a PC".into())
}

fn config_base() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA").map(PathBuf::from)
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
    }
}
