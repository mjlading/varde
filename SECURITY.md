# Security

## What Varde touches

Varde is a launcher: it wakes a PC (Wake-on-LAN / an HTTP endpoint / an SSH
relay), starts Moonlight or an RDP client against it, and optionally runs
maintenance over SSH (sleep, console reclaim, host diagnostics).

Security-relevant behavior, stated plainly:

- **RDP passwords never touch settings.json.** Storage is opt-in and goes to
  the OS credential store only: libsecret/GNOME Keyring on Linux
  (`secret-tool`, service `varde`), Credential Manager on Windows
  (`cmdkey /generic:TERMSRV/<host>`), which `mstsc` reads natively.
- **SSH is key-based only.** Varde shells out to the system OpenSSH client
  with `BatchMode=yes`; it never handles or stores SSH passwords.
  `StrictHostKeyChecking=accept-new` is used — first contact trusts the
  host key, later mismatches fail.
- **The host's TLS certificate is not verified** for the streaming host's
  local web UI and `/serverinfo` probes (self-signed by design in
  Sunshine/Apollo), and for the wake-HTTP transport only when the user
  enables "accept self-signed certificate".
- Settings live in the per-user app config dir; nothing phones home, there
  is no telemetry, no accounts, no relay servers.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting ("Report a security
vulnerability" under the Security tab) rather than a public issue. Expect an
answer within a week. Please include reproduction steps and the commit or
release you tested.
