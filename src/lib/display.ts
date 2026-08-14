// Client-display facts for the Auto quality preset: native resolution, a
// measured refresh rate, and a mirror of the backend's bitrate curve so the
// UI can show exactly what a launch will use.

export interface DisplayHint {
  width: number;
  height: number;
  fps: number;
}

/** Common panel refresh rates; measurements snap to the nearest one. */
const KNOWN_RATES = [60, 75, 90, 100, 120, 144, 165, 240];

/** Native resolution of the screen the window is on, in physical pixels. */
export function screenResolution(): { width: number; height: number } {
  const dpr = window.devicePixelRatio || 1;
  // screen.* is logical; multiplying by devicePixelRatio recovers native
  // pixels (e.g. a 4K TV at 200% scale reports 1920 × 2 = 3840).
  return {
    width: Math.round(window.screen.width * dpr),
    height: Math.round(window.screen.height * dpr),
  };
}

/** Refresh rate is a property of the monitor the window sits on, so the
 *  cache is keyed by screen identity — moving the app from a 144 Hz desk
 *  monitor to a 60 Hz TV re-measures instead of reusing a stale value. */
let cachedFps: { key: string; fps: number } | null = null;

function screenKey(): string {
  return `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio || 1}`;
}

/** Measure the display refresh rate via requestAnimationFrame deltas.
 *  Cached per screen. Never reports below 60 — a throttled webview must not
 *  drag the stream down with it. */
export function measureRefreshRate(): Promise<number> {
  const key = screenKey();
  if (cachedFps?.key === key) return Promise.resolve(cachedFps.fps);
  return new Promise((resolve) => {
    const deltas: number[] = [];
    let last = 0;
    let frames = 0;
    let settled = false;

    const finish = () => {
      let fps = 60;
      if (deltas.length >= 8) {
        deltas.sort((a, b) => a - b);
        const median = deltas[Math.floor(deltas.length / 2)];
        const raw = 1000 / median;
        // Snap to the nearest common rate when close (rAF timing jitters).
        const nearest = KNOWN_RATES.reduce((best, r) =>
          Math.abs(r - raw) < Math.abs(best - raw) ? r : best
        );
        fps = Math.abs(nearest - raw) / nearest < 0.08 ? nearest : Math.round(raw);
      }
      const clamped = Math.max(60, fps);
      cachedFps = { key, fps: clamped };
      if (!settled) {
        settled = true;
        resolve(clamped);
      }
    };

    const tick = (t: number) => {
      if (last > 0) {
        const d = t - last;
        if (d > 1 && d < 100) deltas.push(d);
      }
      last = t;
      frames++;
      if (frames < 40) requestAnimationFrame(tick);
      else finish();
    };
    requestAnimationFrame(tick);
    // Hidden windows never get rAF callbacks — don't hang the launch. The
    // fallback is NOT cached; a later completed measurement still corrects it.
    window.setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(60);
      }
    }, 1500);
  });
}

/** Everything the backend needs to build the Auto quality. */
export async function displayHint(): Promise<DisplayHint> {
  const { width, height } = screenResolution();
  const fps = await measureRefreshRate();
  return { width, height, fps };
}

/** Mirror of `auto_bitrate_kbps` in src-tauri/src/settings.rs — moonlight-qt's
 *  default bitrate curve doubled for LAN, capped at 150 Mbps. Keep in sync. */
export function autoBitrateKbps(width: number, height: number, fps: number): number {
  const table: Array<[number, number]> = [
    [640 * 360, 1.0],
    [854 * 480, 1.5],
    [1280 * 720, 5.0],
    [1920 * 1080, 10.0],
    [2560 * 1440, 20.0],
    [3840 * 2160, 40.0],
  ];
  const px = width * height;
  let res: number;
  if (px <= table[0][0]) res = table[0][1];
  else if (px >= table[5][0]) res = table[5][1];
  else {
    const i = table.findIndex(([p]) => px <= p);
    const [p0, f0] = table[i - 1];
    const [p1, f1] = table[i];
    res = f0 + ((px - p0) / (p1 - p0)) * (f1 - f0);
  }
  const frame = (fps <= 60 ? fps : Math.sqrt(fps / 60) * 60) / 30;
  return Math.min(150_000, Math.max(5_000, Math.round(res * frame * 1000 * 2)));
}

/** "3840 × 2160 · 120 fps · 150 Mbps" for a hint. Clamps like the backend. */
export function describeAutoQuality(d: DisplayHint): string {
  const w = Math.min(3840, Math.max(1280, d.width));
  const h = Math.min(2160, Math.max(720, d.height));
  const fps = Math.min(240, Math.max(30, d.fps));
  const mbps = Math.round(autoBitrateKbps(w, h, fps) / 1000);
  return `${w} × ${h} · ${fps} fps · ${mbps} Mbps`;
}
