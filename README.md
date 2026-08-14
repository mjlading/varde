<div align="center">

# Varde

**One calm launcher for waking, streaming, and remoting into your PC.**

A *varde* is a Norwegian signal cairn — stone beacons lit in chains, one
hill waking the next. This one wakes your gaming PC.

Wake-on-LAN, HTTP and SSH-relay wake · Moonlight/Sunshine/Apollo game
streaming · Remote Desktop — behind a single console-style home screen,
with a terminal interface for everything. Built with Tauri 2 (Rust) + React.

</div>

---

## What it is

Varde is not another Moonlight client — it's the **lifecycle companion**
around the tools you already use. Moonlight renders your stream and FreeRDP
renders your desktop; Varde does everything around them that normally means
a terminal, a wiki page, or walking over to the machine:

- **Play** — stream your game app (Steam Big Picture) via Moonlight.
- **Desktop** — stream the full desktop, pixel for pixel.
- **Work** — Remote Desktop, with Windows' RDP8 graphics pipeline
  (`/gfx:AVC444`) requested by default.

Any action against a sleeping PC **wakes it first**, narrates real
milestones ("answering the network → Windows starting"), shows a progress
bar calibrated to how long the last wake actually took — and tells you what
actually happened when it fails.

### Wake from anywhere

A magic packet is a link-layer broadcast: it dies at the first router.
Waking is therefore a set of transports, all tried, one success enough:

- **Wake-on-LAN** — magic packets to every saved MAC, re-sent every few
  seconds, aimed at both limited and subnet-directed broadcast.
- **HTTP** — any URL that wakes the PC for you (UpSnap, a Home Assistant
  webhook, a router page). Works from anywhere the URL is reachable.
- **SSH relay** — log in to something always-on beside the PC (a NAS, a Pi)
  and have *it* send the packet. Works over a VPN or tailnet.

When a wake fails, **"Why won't it wake?"** asks the PC itself over SSH
about the Windows settings invisible from the client — Fast Startup
powering the NIC down, whether anything may wake the machine at all,
whether the live adapter has "Wake on Magic Packet" enabled, whether that
adapter's MAC is even in your saved list — and each finding comes with the
fix.

### The streaming ↔ desktop handover

Streaming captures the physical console; RDP moves the desktop off it. Two
host states therefore break streaming with an identical black picture, and
neither is fixed by reconnecting: nobody logged in, or a desktop parked on
an RDP session. With SSH configured, Varde repairs both before Moonlight
starts — `tscon` the session back, or log the PC in via a short-lived RDP
session and hand the desktop to the console. Closing a normal RDP session
reclaims the console the same way.

**Ctrl+Alt+Shift+D swaps the two legs in place** — streaming becomes a
desktop; a desktop closes, hands the screen back, and resumes streaming.
(Caveat: fullscreen clients grab the keyboard, so the chord doesn't always
get through mid-session.)

### A host optimizer that fixes Windows for you

Asking for AVC444 from the client is not enough: Windows ignores it until a
host policy allows it, and delivers 30 fps until a registry value raises
the cap to its documented maximum of 60. Settings → Remote Desktop checks
both over SSH and applies them with one button.

### Self-healing by design

DHCP gave your PC a new IP? Varde re-finds it via mDNS and verifies the MAC
before adopting the address — during wakes and from the background poll.
A stream that dies right after launch (the classic login-screen drop) is
relaunched once automatically. A stream that ends brings the launcher back
with the natural follow-up: reconnect, or put the PC to sleep.

### The terminal face

The same binary, headless:

```
varde status     # reachability, ports, busy-state (exit codes for scripts)
varde wake       # fire every configured wake transport
varde play       # wake if needed, wait, stream the game app
varde desktop    # …or the full desktop
varde work       # …or Remote Desktop
varde sleep      # put the PC to sleep over SSH
varde hosts      # list configured PCs
```

`varde wake && varde play` on a keybinding does everything the Play tile
does. (Linux-first: Windows release builds swallow console output.)

### Calm by principle

While a session runs — or the window is hidden — the launcher goes quiet:
every ambient animation freezes, the status poll stretches, and your CPU
cycles go to video decoding instead of ambience. Everything resumes when
you're actually back.

Two looks: **cozy** (warm ink, hand-drawn scenes, a snoring stone-cairn
mascot whose beacon fire *is* the status display) and **OLED** (true black,
type and hairlines only). English by default; Norwegian bokmål included.

## Install

Grab an installer from [Releases](../../releases): `deb`, `rpm`, `AppImage`
on Linux; `msi` / `nsis` on Windows.

> **Windows:** the installers aren't code-signed (yet), so SmartScreen may
> show "Windows protected your PC" — click **More info → Run anyway**.
> **AppImage:** make it executable first (right-click → Properties →
> allow executing, or `chmod +x`). The `deb`/`rpm` packages install by
> double-click on most desktops.

Runtime tools Varde orchestrates (install what you'll use):

| Tool | Why | Linux | Windows |
|---|---|---|---|
| [Moonlight](https://moonlight-stream.org) | streaming | Flatpak or native | `winget install MoonlightGameStreamingProject.Moonlight` |
| FreeRDP 3 (`xfreerdp`) | Remote Desktop | distro package | not needed — `mstsc` is built in |
| OpenSSH client | sleep, handover, diagnostics | distro package | built-in Windows feature |

The host PC runs [Sunshine](https://github.com/LizardByte/Sunshine) or
[Apollo](https://github.com/ClassicOldSong/Apollo) — Varde detects which
and adapts its wording.

### Set up the PC (once)

The gaming PC needs the streaming host installed — a normal next-next-finish
installer:

1. On the PC, install **[Sunshine](https://github.com/LizardByte/Sunshine/releases/latest)**
   (or [Apollo](https://github.com/ClassicOldSong/Apollo/releases/latest)),
   and let it through the Windows firewall when asked.
2. Optional, for the Work tile: turn on **Remote Desktop** in Windows
   Settings (requires Windows Pro).
3. Optional, for sleep/handover/diagnostics: set up key-based SSH to the PC
   — this one is genuinely technical today; an in-app assistant is on the
   roadmap.

First launch of Varde opens a wizard: discover the PC on the LAN (mDNS) or
type its address, check dependencies, pair with Moonlight (PIN shown
in-app), save. SSH (step 3 above) unlocks the best parts: sleep, console
handover, login-before-stream, wake diagnostics and the host optimizer.

## Honest expectations

- **Pairing stays a two-step ritual.** Typing the PIN into the host's web
  page is the host's half of the handshake; Varde streamlines it to "click
  the link, type 4 digits" but can't remove it.
- **Varde launches Moonlight; it doesn't replace it.** Once video starts,
  that's Moonlight's renderer. The polished experience is everything around
  it.
- **RDP passwords never touch settings.json.** Opt-in storage goes to the
  OS keyring (libsecret on Linux; Credential Manager / `TERMSRV` on
  Windows, which `mstsc` reads natively). See [SECURITY.md](SECURITY.md).
- **A PC on Wi-Fi can't wake from full shutdown** — only from sleep. Varde
  tells you when that's the likely story.
- **The SSH-powered features target Windows hosts** and some need rights:
  if `tscon` returns access-denied on your setup, Settings lets you point
  the reclaim at a scheduled task running as SYSTEM.
- **Platforms:** Linux client is primary and battle-tested against a real
  headless Windows host. The Windows client builds in CI but has had less
  real-world use — reports welcome. macOS is currently unsupported.

## Quality presets

Presets are applied as `moonlight stream` flags — cross-platform, and your
saved Moonlight settings are never touched
(see [docs/spike-moonlight-cli.md](docs/spike-moonlight-cli.md)):

| Preset | Settings |
|---|---|
| Auto (default) | Client display's native resolution (capped 4K) and measured refresh rate; bitrate from moonlight-qt's curve doubled for LAN, capped 150 Mbps. Pacing on, V-Sync off, codec negotiated. |
| Balanced | 1080p · 60 fps · 40 Mbps |
| Quality | 1080p · 60 fps · 80 Mbps · HEVC · V-Sync + pacing |
| Custom | your own resolution / fps / bitrate / codec / V-Sync / pacing / HDR |

Auto re-measures per screen: drag the window from a 144 Hz monitor to a
60 Hz TV and the next launch follows.

## Develop

```sh
npm install
npm run tauri dev     # the app, hot-reloading
```

Linux needs Tauri's WebKitGTK stack first — see
[CONTRIBUTING.md](CONTRIBUTING.md) for both distro families, code layout,
and the two house rules (calm-mode discipline; new copy lands in both
locales). `npm run build` + `cargo check && cargo test` must pass; CI runs
them on Linux and Windows.

`npm run tauri build` produces installers under
`src-tauri/target/release/bundle/`. Native installers build on their target
OS; CI's release workflow does all platforms from a tag. (AppImage tooling
needs `libfuse.so.2` — without it the RPM still builds but linuxdeploy
fails; `APPIMAGE_EXTRACT_AND_RUN=1` is the escape hatch.)

## Architecture

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

Settings live in an app-managed `settings.json`
(Linux `~/.config/io.github.mjlading.varde/`, Windows
`%APPDATA%\io.github.mjlading.varde\`). No telemetry, no accounts, no
relay servers.

## License

[GPL-3.0-or-later](LICENSE) — the same family as the ecosystem this builds
on (Moonlight, Sunshine, Apollo). Varde launches those tools as separate
processes and links none of their code; the copyleft is a choice, not an
obligation.
