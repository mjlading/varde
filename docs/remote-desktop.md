# Remote Desktop

The Work tile opens a Remote Desktop session: `mstsc` on Windows,
FreeRDP 3 (`xfreerdp3`, falling back to `xfreerdp`) on Linux. It's the
utility leg — files, updates, a settings dialog, anything you'd rather
not do through a game stream.

## The graphics pipeline

Varde requests Windows' RDP8 graphics pipeline by default, and this is
where most guides stop being honest, so:

**Asking for `/gfx:AVC444` from the client is not enough.** The client
can request the mode all it likes; Windows ignores the request until a
*host* policy allows it. Until then you get the older codec path no
matter what your client sends.

**And even then Windows delivers 30 fps.** The frame interval is a host
registry value; its documented maximum is 60.

Two settings, both on the PC, both invisible from the client:

| Setting | Where | Value |
|---|---|---|
| `AVC444ModePreferred` | `HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services` | `1` (DWORD) |
| `DWMFRAMEINTERVAL` | `HKLM\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations` | `15` (DWORD) |

**Settings → Remote Desktop checks both over SSH and applies them with
one button.** The frame-interval change needs a restart of the PC to
take effect. If the check comes back access-denied, the SSH user isn't
an administrator on the host — the fixes are plain registry writes you
can also make by hand.

You can also drop the pipeline to `AVC420`, or turn it off entirely,
from the same screen — worth trying if your host GPU doesn't get on with
444.

## What RDP still can't do

Documented so you don't go looking for a setting that doesn't exist:

- **No relative mouse mode.** Windows RDP has no mouse-capture mode, so
  first-person games are unplayable over it however good the picture
  gets. This is the single reason the streaming leg exists.
- **No HDR, no AV1.**
- **60 fps is a hard ceiling**, not a starting point.

If you want games, use Play or Desktop. If you want Windows, use Work.

## The streaming ↔ desktop handover

Two host states break streaming with an identical black picture, and
neither is fixed by reconnecting: nobody logged in, or a desktop parked
on an RDP session.

The cause is that streaming captures the *physical console* while RDP
*moves the desktop off it*. So the moment you use Remote Desktop, you've
taken the screen away from Moonlight — and a PC sitting at the login
screen never had a desktop on the console to begin with.

With SSH configured, Varde repairs both before Moonlight starts:

- **A parked session** is handed back to the console with `tscon`.
- **A logged-out PC** is logged in via a short-lived RDP session, whose
  desktop is then handed to the console the same way.

Closing a normal Remote Desktop session reclaims the console too, so the
next stream just works instead of showing black.

**Ctrl+Alt+Shift+D swaps the two legs in place** — streaming becomes a
desktop; a desktop closes, hands the screen back, and resumes streaming.
One caveat: fullscreen clients grab the keyboard, so the chord doesn't
always reach Varde mid-session.

### If `tscon` says access denied

Handing a session to the console requires more rights than a normal user
has on some setups. Settings lets you point the reclaim at a scheduled
task running as `SYSTEM` instead, which sidesteps it.
