# Capture harness

Regenerates the images in `docs/assets/` that the README shows. It renders
the **real** app in headless Chrome against a fake IPC layer, so captures
need no desktop session, no Windows PC, and can't leak anyone's hostname
or IP into a public image.

```sh
npm run dev                 # Vite only — the Tauri shell is not needed
tools/capture/shoot.sh      # writes docs/assets/*
```

`demo-shot.tsx` stands in for `window.__TAURI_INTERNALS__` and serves a
fictional PC ("Rig", 192.168.1.42). Query params pick the frame:
`?theme=dark|oled&state=offline|online|in_use`.

## Three traps, all learned the hard way

**StrictMode.** `main.tsx` mounts under `React.StrictMode`, whose
double-mount leaves the first `host_status` poll in flight — the second
mount sees `inFlight` still true and skips, so the retry lands one poll
interval later. `demo-mount.tsx` mounts without StrictMode for that
reason; don't "fix" it back.

**Calm mode.** A headless page reports itself hidden, so the app enters
calm mode: every ambient animation freezes. That's *desirable* here —
it's what makes a still deterministic. Forcing `document.hidden = false`
instead leaves framer-motion's entrance animations stuck at opacity 0
under virtual time, and you get a blank page.

**The state word.** Because calm freezes motion, the animated swap of the
status word never completes, so any state that differs from the app's
initial `offline` renders with an invisible label. Capture heroes in the
`offline` state; it's also the better picture, since a sleeping PC is
what the app is for.

## Adding a screenshot

Add the command your screen calls to `RESPONSES` in `demo-shot.tsx` (the
mock returns `null` for anything unlisted, which is usually harmless),
then add a line to `shoot.sh`.

Nothing here ships: `tsconfig.json` only includes `src`, and Vite only
bundles `index.html`.
