# Setting up the PC

This is the once-only side of the setup: three things on the gaming PC,
only the first of which is required.

## 1. A streaming host (required)

Install **[Sunshine](https://github.com/LizardByte/Sunshine/releases/latest)**
or **[Apollo](https://github.com/ClassicOldSong/Apollo/releases/latest)**
on the PC. Both are normal next-next-finish installers. Let it through
the Windows firewall when asked — that prompt *is* the setup step people
miss.

Varde detects which of the two you're running and adapts its wording; you
don't have to tell it.

## 2. Remote Desktop (optional — for the Work tile)

Turn on Remote Desktop in Windows Settings → System → Remote Desktop.
This needs **Windows Pro**; Home editions can't host RDP sessions. Skip
this and everything except the Work tile still works.

Once it's on, see [Remote Desktop](remote-desktop.md) for the two host
settings that decide whether you get AVC444 and 60 fps.

## 3. Key-based SSH (optional — and it unlocks the best parts)

> [!NOTE]
> This step is genuinely technical today; an in-app assistant is on the
> roadmap. Everything below is standard OpenSSH-on-Windows setup — no
> Varde-specific pieces.

With SSH configured, Varde can:

- **put the PC to sleep** when you're done,
- **hand the desktop back to the console** so streaming works after
  you've used Remote Desktop,
- **log the PC in** before a stream so you don't get the black
  login-screen picture,
- **run wake diagnostics** — the Windows power settings no client can
  see from the network,
- **check and apply the RDP host settings** for AVC444 and 60 fps.

The short version, run in an elevated PowerShell on the PC:

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Set-Service -Name sshd -StartupType Automatic
Start-Service sshd
```

Then copy your public key to the PC. For an **administrator** account,
Windows OpenSSH reads a different file than you'd expect — not
`~/.ssh/authorized_keys` but:

```
C:\ProgramData\ssh\administrators_authorized_keys
```

and that file must be owned by `Administrators` with no inherited
permissions, or `sshd` silently ignores it:

```powershell
icacls C:\ProgramData\ssh\administrators_authorized_keys /inheritance:r `
  /grant "Administrators:F" /grant "SYSTEM:F"
```

Verify from the client with `ssh user@pc-address` before entering the
details in Varde. If that command needs a password, Varde will too — and
the features above will not work unattended.

> [!IMPORTANT]
> Several of these features need administrator rights on the PC, not
> just a working login. If `tscon` comes back access-denied, see
> [the handover notes](remote-desktop.md#if-tscon-says-access-denied).

## Then: the first launch

Varde's wizard does the client side — find the PC on the network over
mDNS or type its address, check which local tools are installed, pair
with Moonlight (the PIN is shown in the app; you type it into the host's
web page), and save.

Pairing stays a two-step ritual because the second step is the host's
half of the handshake. Varde streamlines it to "click the link, type
four digits" but can't remove it.
