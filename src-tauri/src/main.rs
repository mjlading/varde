// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `varde <command>` is the terminal face: headless, prints, exits.
    // No arguments opens the launcher window as usual.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if !args.is_empty() {
        varde_lib::cli::run(args);
        return;
    }
    varde_lib::run()
}
