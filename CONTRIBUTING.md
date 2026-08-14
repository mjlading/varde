# Contributing to Varde

Thanks for wanting to help light the beacon.

## Dev setup

Prerequisites: Node 20+ (22 recommended), stable Rust, and Tauri's Linux
system deps on Linux:

```sh
# Debian/Ubuntu
sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev \
  patchelf libssl-dev libgtk-3-dev libxdo-dev
# Fedora
sudo dnf install webkit2gtk4.1-devel libappindicator-gtk3-devel librsvg2-devel
```

Runtime tools Varde orchestrates (install what you want to test against):
`moonlight-qt` (Flatpak or native), FreeRDP 3 (`xfreerdp`), OpenSSH client.

```sh
npm install
npm run tauri dev     # launches the app with hot reload
```

Checks that must pass (CI runs these on Linux and Windows):

```sh
npm run build                     # tsc + vite
cd src-tauri && cargo check && cargo test
```

## The shape of the code

- `src-tauri/src/` — Rust: one module per domain (net, wake, moonlight,
  rdp, ssh, session, settings, cli). `commands.rs` is thin Tauri glue; all
  user-facing errors are friendly strings, never raw stderr.
- `src/` — React: screens (Main, Settings, Wizard), a small zustand store,
  `lib/` for the connect state machine and helpers.
- UI copy goes through `t()` (`src/lib/i18n.ts`); English is canonical in
  `src/locales/en.*.ts`, Norwegian bokmål in `nb.*.ts`. Add both when you
  add copy.
- The design language is "cozy console": warm ink, one amber accent, matte
  surfaces, hand-drawn SVG scenes, and calm-mode discipline — nothing may
  animate or poll aggressively while a session runs or the window is hidden
  (see `src/lib/calm.ts`). New ambient animation must respect `useCalm()`.

## Pull requests

- Keep PRs focused; explain the *why* in the description.
- If you touch wake/RDP/SSH behavior, say what hardware/OS you verified on —
  much of this domain can only be proven against a real Windows host.
- New user-facing strings: both locales, English first.
