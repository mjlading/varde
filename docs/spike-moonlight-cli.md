# Spike: Moonlight CLI behaviour (Windows + Linux)

This was the least-documented corner of the plan, so it was verified **first**,
against the real `com.moonlight_stream.Moonlight` flatpak (v6.1.0) installed on
this machine — the same moonlight-qt codebase ships on Windows and Linux.

## Finding 1 — the CLI is full-featured and identical across platforms

`moonlight <action>` supports `stream`, `pair`, `list`, `quit`. Verified locally:

```
moonlight stream <host> "<app>"   # + rich per-stream flags (see below)
moonlight pair <host> [--pin NNNN]
moonlight list <host> [--csv]
moonlight quit <host>
```

Older web docs claiming "moonlight-qt can only stream/quit, not pair" are stale;
6.x added `pair`/`list`. This is the modern reality we target.

## Finding 2 — quality is passed as launch flags, NOT by patching config

`moonlight stream` accepts every quality setting inline:

```
--720 | --1080 | --1440 | --4K | --resolution <WxH>
--fps <n>            --bitrate <kbps>        --packet-size <n>
--vsync | --no-vsync     --frame-pacing | --no-frame-pacing
--video-codec AV1|H.264|HEVC|auto           --display-mode borderless|fullscreen|windowed
--hdr | --no-hdr    --yuv444 | --no-yuv444   --audio-config stereo|5.1-surround|7.1-surround
--game-optimization | --no-game-optimization   (and many more)
```

**Design decision (supersedes the spec's "patch Moonlight's config before launch"):**
Varde applies quality presets as CLI flags on the `stream` command instead of
mutating Moonlight's stored configuration. Reasons:

1. **It's impossible as originally specified on Windows.** moonlight-qt stores its
   settings in the **Windows Registry**
   (`HKCU\Software\Moonlight Game Streaming Project\Moonlight`), *not* a file under
   `%APPDATA%`. There is no config file to patch there.
2. **It's non-destructive** — flags satisfy the spec's "preserve the rest" goal
   perfectly by touching nothing the user saved.
3. **It's uniform** — identical code path on Windows and Linux.

Net effect for the user is exactly what was asked (per-host Balanced/Quality/Custom
presets that take effect at launch), implemented more robustly.

## Finding 3 — PIN capture, and the Windows console gotcha

`moonlight pair <host>` (no `--pin`) generates a random 4-digit PIN, prints it, and
waits while the user types that PIN into Apollo/Sunshine's web UI at
`https://<host>:47990/pin`. This two-step ritual is Apollo's half of the handshake
and cannot be removed — Varde streamlines it to "click the link, type 4 digits".

**Superseded — Varde chooses the PIN instead of reading it back.**

`moonlight pair <host> --pin NNNN` makes Moonlight use a code we supply
(`--pin <pin>  Specify 4 digit pairing PIN to use.`, verified against 6.1.0).
Varde generates the 4 digits, shows them, and passes them in. Nothing is parsed.

The original design scraped the PIN out of the child's output with `\b(\d{4})\b`
across merged stdout+stderr, keeping the first match. That shipped and was wrong
in the field: a tester saw **1002** in Varde while Moonlight's own dialog said
**6242**. Two failure modes combined —

- moonlight-qt logs freely to stderr (SDL banners, Qt warnings, timestamps), so
  the first four-digit token is very often not the PIN; and
- the match latched (`if pin.is_none()`), so a wrong early hit could never be
  corrected when the real PIN arrived.

It also could not have worked reliably anyway: **`moonlight pair` is not
headless**. moonlight-qt raises its own pairing dialog showing the code, and that
window cannot be suppressed — so any number Varde displays must *be* that number,
which only `--pin` guarantees.

Still true, and still why we pipe output at all (for `pair:log` diagnostics): in
CLI mode moonlight-qt calls `AttachConsole(ATTACH_PARENT_PROCESS)` and reopens
**stderr** (`CONOUT$`), so its output can land on stderr rather than stdout. Varde
spawns with `CREATE_NO_WINDOW` on Windows — our Tauri parent is a GUI-subsystem
process with no console, so `AttachConsole` fails there and the child keeps the
inherited pipe handles: captured cleanly, no console flash.

## Finding 3½ — app names are exact, so resolve them at launch

`moonlight stream <host> "<app>"` fails with *"Failed to find application …"*
unless the name matches the host's app list exactly. Verified live against this
Apollo host: its list is `Desktop`, `Steam Big Picture`, `Virtual Display` —
there is no plain `"Steam"`.

Varde therefore resolves the configured name against `moonlight list
<host>` right before streaming: exact match → fuzzy match (e.g. "Steam" →
"Steam Big Picture", self-healing the saved name) → an in-app picker showing the
host's real list. A stale app name can no longer produce a raw Moonlight error.

## Finding 4 — binary location & launch wrapper

| Platform | Launch prefix |
|----------|---------------|
| Linux (flatpak, detected) | `flatpak run com.moonlight_stream.Moonlight <action> …` |
| Linux (native pkg)        | `moonlight <action> …` |
| Windows                   | `Moonlight.exe <action> …` |

Windows install (winget id `MoonlightGameStreamingProject.Moonlight`, v6.1.0.0)
drops `Moonlight.exe` under `C:\Program Files\Moonlight Game Streaming\`.
Varde auto-detects: PATH → known install dirs → user override in Settings.
