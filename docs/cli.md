# The terminal face

The same binary you installed is also a command-line tool. No daemon, no
separate package — run `varde` with an argument and the GUI never opens.

```
varde <command> [host]
```

`[host]` is the PC's name as it appears in the app (first match wins).
Omit it and the active PC is used. Configuration comes from the app's own
`settings.json`, so run the app once and complete the wizard before
reaching for the CLI.

| Command | What it does |
|---|---|
| `varde status` | Reachability, stream/RDP ports, and whether someone is already streaming |
| `varde wake` | Fire every configured wake transport and report each one |
| `varde play` | Wake if needed, wait, then stream the game app |
| `varde desktop` | Wake if needed, wait, then stream the full desktop |
| `varde work` | Wake if needed, wait, then open Remote Desktop |
| `varde sleep` | Put the PC to sleep over SSH |
| `varde hosts` | List configured PCs |
| `varde help` | The above, from the binary itself |

## Exit codes

Everything is scriptable because the exit code means something:

- `varde status` exits **0** when the PC is reachable and **1** when it
  isn't — so `varde status && echo up` is a valid test.
- `play`, `desktop`, `work` exit **1** if the PC never came up, and
  otherwise **0** once the client has been launched.
- `wake` exits **0** if any transport reported success.
- `sleep` exits **1** if SSH isn't configured for that host.

Human-readable detail goes to stdout; errors go to stderr prefixed
`varde:`.

## Binding it to keys

```sh
varde wake && varde play
```

is exactly what the Play tile does, and it makes a good keyboard
shortcut or Stream Deck button. `varde status` is cheap enough to poll
from a status bar.

## Two caveats

- **Auto quality can't measure a display from a terminal.** In the GUI,
  the `Auto` preset reads the resolution and refresh rate of the screen
  the window is on. There is no window in the CLI, so `Auto` falls back
  to 1080p60. Pin a preset in the app if you want something else from
  the terminal.
- **Windows release builds swallow console output.** The binary is
  built as a GUI application so the app doesn't flash a console window,
  which means it isn't attached to your terminal when you run it there.
  The commands still work and the exit codes are still correct — you
  just won't see the text. The CLI is Linux-first for now.
