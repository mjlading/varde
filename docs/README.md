# Varde documentation

The [README](../README.md) is the tour. This is everything that matters
*after* you've installed it.

| Page | What's in it |
|---|---|
| [Installing Varde](install.md) | Per-package notes for `deb` / `rpm` / AppImage / `msi` / `nsis`, the runtime tools Varde drives, and where settings live |
| [Setting up the PC](host-setup.md) | The once-only host side: Sunshine or Apollo, Remote Desktop, and key-based SSH |
| [Waking](waking.md) | The three wake transports, why a magic packet isn't enough, and what "Why won't it wake?" checks |
| [Remote Desktop](remote-desktop.md) | The RDP8 graphics pipeline, the host optimizer, and the streaming ↔ desktop handover |
| [Streaming quality](streaming.md) | The presets, what `Auto` measures, and how flags reach Moonlight |
| [The terminal face](cli.md) | Every subcommand, its exit codes, and how to bind them to keys |
| [Moonlight CLI spike](spike-moonlight-cli.md) | The research behind driving `moonlight stream` by flags |

Building Varde, the code layout and the house rules live in
[CONTRIBUTING.md](../CONTRIBUTING.md). How secrets are stored is in
[SECURITY.md](../SECURITY.md).
