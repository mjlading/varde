pub mod cli;
mod commands;
mod credentials;
mod deps;
mod discovery;
mod moonlight;
mod net;
mod rdp;
mod session;
mod settings;
mod ssh;
mod util;
mod wake;

/// Default binding for the in-session switch. Deliberately awkward: it has to
/// survive being pressed inside a game without colliding with anything.
const SWITCH_SHORTCUT: &str = "CmdOrCtrl+Alt+Shift+D";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // Fires wherever focus is — the launcher is behind a
                    // fullscreen client during a session, so the frontend
                    // reacts to the event rather than to a keypress.
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        use tauri::Emitter;
                        let _ = app.emit("session:switch", ());
                    }
                })
                .build(),
        )
        .setup(|app| {
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            // Best-effort: another application may already own this chord, and
            // that is not a reason to fail startup.
            if let Err(e) = app.global_shortcut().register(SWITCH_SHORTCUT) {
                eprintln!("varde: could not register {SWITCH_SHORTCUT}: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::discover_hosts,
            commands::probe_host,
            commands::resolve_mac,
            commands::host_status,
            commands::wake,
            commands::relocate_host,
            commands::wait_for_port,
            commands::check_dependencies,
            commands::start_pairing,
            commands::launch_stream,
            commands::list_apps,
            commands::launch_rdp,
            commands::has_rdp_password,
            commands::store_rdp_password,
            commands::forget_rdp_password,
            commands::sleep_host,
            commands::check_ssh,
            commands::reclaim_console,
            commands::prepare_for_stream,
            commands::detect_flavour,
            commands::diagnose_wake,
            commands::rdp_host_check,
            commands::rdp_host_optimize,
            commands::current_session,
            commands::switch_session,
            commands::quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
