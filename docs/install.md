# Installing Varde

Every installer is built by CI from a tag and attached to
[the release](https://github.com/mjlading/varde/releases/latest). Pick
the one that matches your system; none of them need a terminal.

## Linux

| Package | For | Notes |
|---|---|---|
| `.deb` | Debian, Ubuntu, Mint, Pop!_OS | Double-click, or `sudo apt install ./varde_*_amd64.deb` |
| `.rpm` | Fedora, RHEL, openSUSE | Double-click, or `sudo dnf install ./varde-*.x86_64.rpm` |
| `.AppImage` | anything else | No install: make it executable and run it |

The AppImage needs to be marked executable before it will start — right-click
→ Properties → "Allow executing file as program" on most desktops, or:

```sh
chmod +x Varde_*_amd64.AppImage
./Varde_*_amd64.AppImage
```

> [!NOTE]
> AppImages need FUSE 2 (`libfuse.so.2`) on the host. Most distributions
> still ship it, but some recent ones only have FUSE 3 — install your
> distribution's `fuse` / `libfuse2` package, or use the `deb`/`rpm`
> instead. As a last resort, `APPIMAGE_EXTRACT_AND_RUN=1 ./Varde…AppImage`
> unpacks and runs without FUSE at all.

The `deb` and `rpm` pull in the WebKitGTK runtime Varde renders with, so
there's nothing else to install.

## Windows

Take either the `.msi` or the `-setup.exe` (NSIS) — they install the same
app; the MSI is the better choice if you deploy with policy, the exe if
you just want to double-click.

> [!WARNING]
> The installers aren't code-signed yet, so SmartScreen may show
> "Windows protected your PC". Click **More info → Run anyway**. A
> signing certificate is a per-year cost the project hasn't taken on;
> until then this warning is expected and there's no way to make it not
> appear.

## macOS

Not supported. Several subsystems (the RDP client, the credential store,
ARP lookups, Moonlight detection) are Linux/Windows-specific today, and
there's no `dmg` target in the build. Contributions welcome.

## The tools Varde drives

Varde is a launcher: it orchestrates other programs rather than
reimplementing them. Install whichever legs you plan to use.

| Tool | Needed for | Linux | Windows |
|---|---|---|---|
| [Moonlight](https://moonlight-stream.org) | Play, Desktop | Flatpak or native package | `winget install MoonlightGameStreamingProject.Moonlight` |
| FreeRDP 3 (`xfreerdp`) | Work | distro package | not needed — `mstsc` is built in |
| OpenSSH client | sleep, handover, diagnostics, host optimizer | distro package | built-in Windows feature |

The first-run wizard checks all of these and tells you which are missing,
with the exact install command for *your* package manager — it detects
`dnf`, `apt`, `pacman` and `zypper` rather than assuming.

## Where your settings live

One JSON file, managed by the app; you never need to edit it by hand.

| OS | Path |
|---|---|
| Linux | `~/.config/io.github.mjlading.varde/settings.json` |
| Windows | `%APPDATA%\io.github.mjlading.varde\settings.json` |

Passwords are never in it. RDP passwords, if you opt in to saving them,
go to the OS credential store instead — see [SECURITY.md](../SECURITY.md).

No telemetry, no accounts, no relay servers.

## Upgrading from DeskConnect

If you used this app under its old name, the first launch migrates your
settings from the old configuration directory and keeps reading
credentials saved under the old keyring service name. Nothing to do.
