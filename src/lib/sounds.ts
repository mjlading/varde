// Soft, synthesized UI sounds — no audio assets, just Web Audio. The palette
// is deliberately quiet and glassy: short sine/triangle tones with fast
// exponential decays, plus a whisper of filtered noise for air. Every sound
// is fire-and-forget and safe to call from any handler.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;

/** Wired to the `sounds` setting from App.tsx. */
export function setSoundsEnabled(v: boolean) {
  enabled = v;
}

function graph(): { ctx: AudioContext; out: GainNode } | null {
  if (!enabled) return null;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return { ctx, out: master! };
  } catch {
    return null;
  }
}

interface ToneOpts {
  /** Start frequency in Hz. */
  freq: number;
  /** Optional glide target frequency. */
  glide?: number;
  type?: OscillatorType;
  /** Seconds from now to start. */
  at?: number;
  /** Total length in seconds. */
  dur?: number;
  /** Peak gain. */
  gain?: number;
  /** Lowpass cutoff; omit for none. */
  lowpass?: number;
}

function tone({ freq, glide, type = "sine", at = 0, dur = 0.25, gain = 0.08, lowpass }: ToneOpts) {
  const g = graph();
  if (!g) return;
  const t0 = g.ctx.currentTime + at;
  const osc = g.ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glide) osc.frequency.exponentialRampToValueAtTime(glide, t0 + dur);

  const env = g.ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  let head: AudioNode = osc;
  if (lowpass) {
    const f = g.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = lowpass;
    f.Q.value = 0.7;
    osc.connect(f);
    head = f;
  }
  head.connect(env).connect(g.out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

let noiseBuffer: AudioBuffer | null = null;

function noise({
  at = 0,
  dur = 0.3,
  gain = 0.04,
  from = 400,
  to = 1600,
}: {
  at?: number;
  dur?: number;
  gain?: number;
  /** Bandpass sweep start/end in Hz — an airy "whoosh". */
  from?: number;
  to?: number;
}) {
  const g = graph();
  if (!g) return;
  const t0 = g.ctx.currentTime + at;
  if (!noiseBuffer) {
    noiseBuffer = g.ctx.createBuffer(1, g.ctx.sampleRate, g.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = g.ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;

  const band = g.ctx.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 1.1;
  band.frequency.setValueAtTime(from, t0);
  band.frequency.exponentialRampToValueAtTime(to, t0 + dur);

  const env = g.ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.35);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  src.connect(band).connect(env).connect(g.out);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

/* ------------------------------- The palette ------------------------------ */

export const sounds = {
  /** Soft glass tap — card and button presses. */
  click() {
    tone({ freq: 1750, glide: 1150, dur: 0.07, gain: 0.055, lowpass: 4200 });
  },

  /** Gentle upward swoosh + two-note rise — a stream is being launched. */
  launch() {
    noise({ dur: 0.4, gain: 0.028, from: 350, to: 2400 });
    tone({ freq: 587.33, type: "triangle", at: 0.02, dur: 0.24, gain: 0.05 }); // D5
    tone({ freq: 880, type: "triangle", at: 0.13, dur: 0.3, gain: 0.055 }); // A5
  },

  /** Warm resolved arpeggio — connected. */
  success() {
    tone({ freq: 659.25, type: "triangle", dur: 0.4, gain: 0.06 }); // E5
    tone({ freq: 987.77, type: "triangle", at: 0.09, dur: 0.45, gain: 0.05 }); // B5
    tone({ freq: 1318.5, type: "sine", at: 0.18, dur: 0.6, gain: 0.045 }); // E6
  },

  /** Muted low cluster — something went wrong, without being alarming. */
  error() {
    tone({ freq: 233.08, dur: 0.28, gain: 0.055, lowpass: 900 }); // Bb3
    tone({ freq: 220, at: 0.02, dur: 0.32, gain: 0.05, lowpass: 900 }); // A3
  },

  /** Deep slow swell — a wake signal went out. */
  wake() {
    tone({ freq: 87.31, glide: 130.81, dur: 0.8, gain: 0.09, lowpass: 500 }); // F2→C3
    noise({ at: 0.05, dur: 0.7, gain: 0.018, from: 250, to: 900 });
  },

  /** Two descending notes — the PC is going to sleep. */
  sleep() {
    tone({ freq: 493.88, type: "triangle", dur: 0.28, gain: 0.05 }); // B4
    tone({ freq: 329.63, type: "triangle", at: 0.16, dur: 0.42, gain: 0.05 }); // E4
  },
};
