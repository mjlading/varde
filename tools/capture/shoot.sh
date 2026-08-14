#!/usr/bin/env bash
# Regenerate docs/assets/* from the running dev server. See README.md here.
# Usage: npm run dev &   then   tools/capture/shoot.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/docs/assets"
TMP="$(mktemp -d)"
URL="http://localhost:1420"
CHROME="${CHROME:-google-chrome}"

trap 'rm -rf "$TMP"' EXIT

curl -sf -o /dev/null "$URL/" || {
  echo "dev server not running — start it with: npm run dev" >&2
  exit 1
}

shoot() { # shoot <out.png> <w> <h> <url-path>
  "$CHROME" --headless=new --disable-gpu --no-first-run \
    --user-data-dir="$TMP/profile" --hide-scrollbars \
    --force-device-scale-factor=2 --default-background-color=00000000 \
    --virtual-time-budget=10000 --window-size="$2,$3" \
    --screenshot="$1" "$URL/$4" 2>/dev/null
}

echo "hero (cozy + OLED)…"
shoot "$TMP/cozy.png" 1120 585 "tools/capture/demo.html?theme=dark&state=offline"
shoot "$TMP/oled.png" 1120 585 "tools/capture/demo.html?theme=oled&state=offline"
magick "$TMP/cozy.png" -resize 1760x -quality 82 -define webp:method=6 "$OUT/hero-cozy.webp"
magick "$TMP/oled.png" -resize 1760x -quality 82 -define webp:method=6 "$OUT/hero-oled.webp"

echo "totem states…"
shoot "$TMP/totem.png" 940 230 "tools/capture/totem.html"
magick "$TMP/totem.png" -trim +repage -gravity East -chop 60x0 \
  -resize 860x -colors 128 -strip "$OUT/totem-states.png"

ls -lh "$OUT"
