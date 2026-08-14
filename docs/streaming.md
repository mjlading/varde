# Streaming quality

Varde doesn't render your stream — Moonlight does. What Varde controls is
how Moonlight is *launched*: presets are applied as flags on the
`moonlight stream` command line, which is cross-platform and means **your
saved Moonlight settings are never touched**. Close Varde and Moonlight
still behaves exactly as you configured it.

The research behind driving Moonlight this way is in
[spike-moonlight-cli.md](spike-moonlight-cli.md).

| Preset | Settings |
|---|---|
| Auto (default) | Client display's native resolution (capped 4K) and measured refresh rate; bitrate from moonlight-qt's curve doubled for LAN, capped 150 Mbps. Pacing on, V-Sync off, codec negotiated. |
| Balanced | 1080p · 60 fps · 40 Mbps |
| Quality | 1080p · 60 fps · 80 Mbps · HEVC · V-Sync + pacing |
| Custom | your own resolution / fps / bitrate / codec / V-Sync / pacing / HDR |

## What Auto actually measures

Auto reads the display the Varde window is currently on — not the one it
started on. Drag the window from a 144 Hz monitor to a 60 Hz TV and the
next launch follows. That's why it's the default: a launcher that lives
on a living-room TV and a desk monitor shouldn't need a settings trip in
between.

The bitrate comes from moonlight-qt's own default curve for the chosen
resolution and frame rate, then doubled on the assumption you're on a
LAN, and capped at 150 Mbps.

> [!NOTE]
> From the terminal there's no window and therefore no display to
> measure, so `Auto` falls back to 1080p60. Pin a preset if you drive
> Varde from scripts. See [the CLI page](cli.md).

## Play versus Desktop

Both are Moonlight streams; they differ only in which app on the host is
launched.

- **Play** streams the app named in the host's *Steam app* setting —
  Steam Big Picture by default.
- **Desktop** streams the host's desktop app, pixel for pixel.

Rename either in Settings if your Sunshine or Apollo install uses
different app names.

## When a stream dies immediately

The classic failure is a stream that connects and drops within a second
or two, which usually means the host was sitting at the login screen.
Varde relaunches once automatically rather than making you press the
tile again. If it happens repeatedly, the fix is on the host side — see
[the handover section](remote-desktop.md#the-streaming--desktop-handover).
