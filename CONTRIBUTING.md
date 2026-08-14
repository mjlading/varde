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

## Building installers

```sh
npm run tauri build   # → src-tauri/target/release/bundle/
```

Native installers only build on their own OS; CI's release workflow does
all platforms from a `v*` tag. AppImage tooling needs `libfuse.so.2` —
without it the RPM still builds but linuxdeploy fails, and
`APPIMAGE_EXTRACT_AND_RUN=1` is the escape hatch.

## The shape of the code

```
src/                     React + TypeScript frontend
  screens/               Wizard · Main · Settings
  components/            ActionCard, ConnectOverlay, artwork (scenes + cairn)
  lib/                   connect state machine, status polling, calm mode, i18n
  locales/               en (canonical) · nb
src-tauri/src/           Rust backend
  net.rs                 magic packets, TCP probing, status, ARP MAC lookup
  wake.rs                wake transports (WoL / HTTP / SSH relay) + diagnostics
  discovery.rs           mDNS (_nvstream._tcp)
  moonlight.rs           pairing (PIN via events) + stream launch/watch
  rdp.rs                 FreeRDP / mstsc, GFX pipeline, host optimizer
  ssh.rs                 sleep, console state/reclaim, PowerShell transport
  session.rs             which leg is up; ending it for the hot-switch
  cli.rs                 the terminal face
  settings.rs            settings.json store & migrations
  commands.rs, lib.rs    Tauri command surface + app builder
```

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

### One trap worth knowing

`cfg!(target_os = "windows")` is a **runtime** boolean, so every arm of an
`if cfg!(…)` chain is still name-resolved and type-checked on every
target. Calling a `#[cfg]`-gated item from such an arm compiles on the
platform where the item exists and fails everywhere else — invisible
locally, caught only by the Windows CI job. Prefer keeping helpers
un-gated, or use real `#[cfg]` attributes on both variants.

## Pull requests

- Keep PRs focused; explain the *why* in the description.
- If you touch wake/RDP/SSH behavior, say what hardware/OS you verified on —
  much of this domain can only be proven against a real Windows host.
- New user-facing strings: both locales, English first.
