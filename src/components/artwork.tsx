import { createContext, useContext } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { useCalm } from "../lib/calm";
import type { HostState } from "../types";

/* The card that hosts a scene shares its cursor with it, so the little
 * worlds can react to being visited. Values are normalized to the scene's
 * 150×110 canvas; outside a card the context stays inert. */
export interface SceneHoverState {
  hovered: boolean;
  mx: MotionValue<number> | null;
  my: MotionValue<number> | null;
}
export const SceneHover = createContext<SceneHoverState>({
  hovered: false,
  mx: null,
  my: null,
});

/** A springy pull toward the cursor for an element sitting at (gx, gy).
 *  k sets how eagerly it follows — vary it per element for parallax. */
function useMagnet(gx: number, gy: number, k: number) {
  const { mx, my } = useContext(SceneHover);
  const restX = useMotionValue(0.5);
  const restY = useMotionValue(0.5);
  const px = useTransform(mx ?? restX, (v) => (v * 150 - gx) * k);
  const py = useTransform(my ?? restY, (v) => (v * 110 - gy) * k);
  return {
    x: useSpring(px, { stiffness: 150, damping: 16 }),
    y: useSpring(py, { stiffness: 150, damping: 16 }),
  };
}

/* ============================================================================
   Hand-drawn animated scenes for the action cards, plus the host "totem".
   No stock icons — each card gets a tiny ambient world that never stops
   breathing, PS5-style: calm loops, nothing spins, nothing nags.

   Every loop respects calm mode (useCalm): while a session runs or the window
   is hidden, the scenes freeze in place so the client's cycles go to video
   decoding instead of ambience. They resume the moment the user is back.
   ========================================================================== */

const float = (calm: boolean, dur: number, delay = 0, dy = 4) =>
  calm
    ? {}
    : {
        animate: { y: [0, -dy, 0] },
        transition: { duration: dur, delay, repeat: Infinity, ease: "easeInOut" as const },
      };

const twinkle = (calm: boolean, dur: number, delay = 0, lo = 0.25, hi = 1) =>
  calm
    ? { style: { opacity: (lo + hi) / 2 } }
    : {
        animate: { opacity: [lo, hi, lo] },
        transition: { duration: dur, delay, repeat: Infinity, ease: "easeInOut" as const },
      };

/* ------------------------------ Play ---------------------------------------
   "Button constellation" — the four controller glyphs drift as glowing stars
   in a violet nebula, loosely wired together like a star chart. */
export function PlayScene() {
  const calm = useCalm();
  const { hovered } = useContext(SceneHover);
  // On hover the constellation wakes up: faster drift, brighter twinkle.
  const t = hovered ? 0.45 : 1;
  const magTri = useMagnet(38, 45, 0.16);
  const magCircle = useMagnet(78, 26, 0.11);
  const magCross = useMagnet(112, 44, 0.14);
  const magSquare = useMagnet(95, 79, 0.09);
  return (
    <svg viewBox="0 0 150 110" preserveAspectRatio="xMidYMid slice" style={{ width: "100%", height: "100%" }}>
      <defs>
        <radialGradient id="play-neb" cx="0.35" cy="0.4" r="0.9">
          <stop offset="0" stopColor="#ff9d7a" stopOpacity="0.20" />
          <stop offset="0.6" stopColor="#e79c50" stopOpacity="0.07" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="150" height="110" fill="url(#play-neb)" />

      {/* star-chart wiring */}
      <path
        d="M38 34 L78 26 L112 44 L96 80 L52 74 Z"
        fill="none"
        stroke="#d9b28c"
        strokeOpacity="0.14"
        strokeWidth="1"
        strokeDasharray="3 5"
      />

      {/* triangle */}
      <motion.g style={magTri}>
      <motion.g {...float(calm, 5.2 * t, 0)}>
        <path d="M38 40 l-7 11 h14 Z" fill="none" stroke="#a8d5a2" strokeWidth="2" strokeLinejoin="round" />
        <motion.path
          d="M38 40 l-7 11 h14 Z"
          fill="#a8d5a2"
          {...twinkle(calm, 5.2 * t, 0.4, 0.04, hovered ? 0.3 : 0.16)}
        />
      </motion.g>
      </motion.g>

      {/* circle */}
      <motion.g style={magCircle}>
      <motion.g {...float(calm, 6.1 * t, 1.2)}>
        <circle cx="78" cy="26" r="7.5" fill="none" stroke="#ff9d8a" strokeWidth="2" />
      </motion.g>
      </motion.g>

      {/* cross */}
      <motion.g style={magCross}>
      <motion.g {...float(calm, 5.7 * t, 0.6)}>
        <path d="M106 38 l12 12 M118 38 l-12 12" stroke="#e8c07a" strokeWidth="2" strokeLinecap="round" />
      </motion.g>
      </motion.g>

      {/* square */}
      <motion.g style={magSquare}>
      <motion.g {...float(calm, 6.6 * t, 1.8)}>
        <rect x="88" y="72" width="14" height="14" rx="2.5" fill="none" stroke="#eaa8c5" strokeWidth="2" />
      </motion.g>
      </motion.g>

      {/* dust */}
      {[
        [22, 78, 3.8, 0.2],
        [58, 52, 4.6, 1.4],
        [126, 24, 4.1, 0.9],
        [134, 66, 5.2, 2.2],
        [50, 18, 4.9, 2.8],
      ].map(([x, y, dur, delay], i) => (
        <motion.circle key={i} cx={x} cy={y} r="1.3" fill="#ffe2b8" {...twinkle(calm, dur * t, delay, 0.12, hovered ? 1 : 0.75)} />
      ))}
    </svg>
  );
}

/* -------------------------- Desktop stream ---------------------------------
   "Aurora antenna" — a little CRT catching a ribbon of signal; a scanline
   drifts down the glass while the aurora rolls through it. */
export function StreamScene() {
  const calm = useCalm();
  const { hovered, mx } = useContext(SceneHover);
  const restX = useMotionValue(0.5);
  const lean = useSpring(
    useTransform(mx ?? restX, (v) => (v - 0.5) * 7),
    { stiffness: 120, damping: 14 }
  );
  const t = hovered ? 0.5 : 1;
  return (
    <svg viewBox="0 0 150 110" preserveAspectRatio="xMidYMid slice" style={{ width: "100%", height: "100%" }}>
      <defs>
        <radialGradient id="str-neb" cx="0.6" cy="0.4" r="0.9">
          <stop offset="0" stopColor="#8fd6a0" stopOpacity="0.14" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="str-aurora" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8fd6a0" stopOpacity="0" />
          <stop offset="0.35" stopColor="#8fd6a0" stopOpacity="0.85" />
          <stop offset="0.65" stopColor="#e8c07a" stopOpacity="0.85" />
          <stop offset="1" stopColor="#e8c07a" stopOpacity="0" />
        </linearGradient>
        <clipPath id="str-glass">
          <rect x="43" y="26" width="64" height="42" rx="5" />
        </clipPath>
      </defs>
      <rect width="150" height="110" fill="url(#str-neb)" />

      {/* stand stays planted; the screen leans toward the visitor */}
      <path d="M68 72 l-5 12 M82 72 l5 12 M56 86 h38" stroke="rgba(255,240,220,0.24)" strokeWidth="1.5" strokeLinecap="round" />
      <motion.g style={{ rotate: lean, transformBox: "fill-box", transformOrigin: "50% 100%" }}>
      {/* CRT body */}
      <rect x="39" y="22" width="72" height="50" rx="8" fill="rgba(255,240,220,0.03)" stroke="rgba(255,240,220,0.24)" strokeWidth="1.5" />

      {/* aurora rolling through the glass */}
      <g clipPath="url(#str-glass)">
        <motion.path
          d="M30 52 C 48 40, 62 62, 80 50 S 116 40, 130 52"
          fill="none"
          stroke="url(#str-aurora)"
          strokeWidth="9"
          strokeLinecap="round"
          animate={calm ? undefined : { x: [-16, 16, -16] }}
          transition={calm ? undefined : { duration: 7 * t, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* scanline */}
        <motion.line
          x1="43"
          x2="107"
          y1="0"
          y2="0"
          stroke="#ffe9c0"
          strokeOpacity="0.35"
          strokeWidth="1"
          animate={calm ? { y: 47 } : { y: [28, 66] }}
          transition={calm ? { duration: 0 } : { duration: 4.5 * t, repeat: Infinity, ease: "linear" }}
        />
      </g>
      </motion.g>

      {/* antenna signal dots */}
      {[0, 1, 2].map((i) => (
        <motion.circle
          key={i}
          cx={118 + i * 8}
          cy={18 - i * 4}
          r="1.6"
          fill="#8fd6a0"
          {...twinkle(calm, 2.4 * t, i * 0.55, 0.1, 0.9)}
        />
      ))}
    </svg>
  );
}

/* --------------------------------- Work ------------------------------------
   "Coffee, remotely" — a mug whose steam drifts up and condenses into a
   mouse cursor. The most honest depiction of remote work we could draw. */
export function WorkScene() {
  const calm = useCalm();
  const { hovered } = useContext(SceneHover);
  // The drawn cursor is a cursor — of course it chases the real one.
  const chase = useMagnet(103, 38, 0.3);
  const t = hovered ? 0.55 : 1;
  return (
    <svg viewBox="0 0 150 110" preserveAspectRatio="xMidYMid slice" style={{ width: "100%", height: "100%" }}>
      <defs>
        <radialGradient id="wrk-neb" cx="0.4" cy="0.7" r="0.9">
          <stop offset="0" stopColor="#f3b73b" stopOpacity="0.13" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="150" height="110" fill="url(#wrk-neb)" />

      {/* faint desk grid */}
      {[34, 58, 82, 106, 130].map((x) => (
        <line key={x} x1={x} y1="0" x2={x} y2="110" stroke="#ffffff" strokeOpacity="0.035" />
      ))}
      {[22, 50, 78].map((y) => (
        <line key={y} x1="0" y1={y} x2="150" y2={y} stroke="#ffffff" strokeOpacity="0.035" />
      ))}

      {/* mug */}
      <g>
        <rect x="52" y="58" width="34" height="30" rx="6" fill="rgba(255,240,220,0.055)" stroke="#f3b73b" strokeOpacity="0.8" strokeWidth="2" />
        <path d="M86 64 h6 a8 8 0 0 1 0 16 h-6" fill="none" stroke="#f3b73b" strokeOpacity="0.8" strokeWidth="2" />
        <line x1="58" y1="66" x2="80" y2="66" stroke="#f3b73b" strokeOpacity="0.25" strokeWidth="2" strokeLinecap="round" />
      </g>

      {/* steam */}
      <motion.path
        d="M62 52 c 3 -5, -3 -9, 0 -14"
        fill="none"
        stroke="#ffe9c0"
        strokeWidth="1.8"
        strokeLinecap="round"
        animate={calm ? { opacity: 0.35, y: 0 } : { opacity: [0, hovered ? 0.95 : 0.7, 0], y: [3, -3, -7] }}
        transition={calm ? { duration: 0 } : { duration: 3.6 * t, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.path
        d="M74 52 c 3 -5, -3 -9, 0 -14"
        fill="none"
        stroke="#ffe9c0"
        strokeWidth="1.8"
        strokeLinecap="round"
        animate={calm ? { opacity: 0.35, y: 0 } : { opacity: [0, hovered ? 0.95 : 0.7, 0], y: [3, -3, -7] }}
        transition={calm ? { duration: 0 } : { duration: 3.6 * t, delay: 1.2, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* the steam condenses into… a cursor */}
      <motion.g style={chase}>
        <motion.path
          d="M96 28 l0 14 l4 -3.4 l2.6 5.4 l3 -1.6 l-2.7 -5.2 l5 -0.6 Z"
          fill="#ffe9c0"
          stroke="#14110e"
          strokeWidth="0.75"
          animate={calm ? { opacity: 0.8, y: 0 } : { opacity: [hovered ? 0.8 : 0.25, 1, hovered ? 0.8 : 0.25], y: [2, -2, 2] }}
          transition={calm ? { duration: 0 } : { duration: 4.2 * t, repeat: Infinity, ease: "easeInOut" }}
        />
      </motion.g>
    </svg>
  );
}

/* ------------------------------ Host totem ---------------------------------
   The varde itself: a stacked stone cairn whose beacon fire tells the truth.
   Unlit and snoring while the PC sleeps, kindling while it wakes, burning
   steady when ready, throwing sparks when someone is on it. The status dot
   and the mascot are the same thing — the app is named after this mark. */
export function HostTotem({ state, size = 64 }: { state: HostState; size?: number }) {
  const calm = useCalm();
  const lit = state === "online" || state === "in_use" || state === "waking";

  return (
    <svg
      viewBox="0 0 64 84"
      width={size}
      height={(size * 84) / 64}
      aria-hidden="true"
      style={{ overflow: "visible" }}
    >
      {/* ground */}
      <line x1="11" y1="77.5" x2="53" y2="77.5" stroke="rgba(255,240,220,0.15)" strokeWidth="1.5" strokeLinecap="round" />

      {/* faceted slabs — cut stone, not snowballs; seams give them faces */}
      <g opacity={state === "offline" ? 0.75 : 1}>
        <path d="M12 76 L16 62 L50 63 L53 76 Z"
          fill="rgba(255,240,220,0.06)" stroke="rgba(255,240,220,0.26)" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M36 62.5 L43 76" stroke="rgba(255,240,220,0.14)" strokeWidth="1.2" />
        <path d="M18 61 L22 49 L44 48 L47 61 Z"
          fill="rgba(255,240,220,0.05)" stroke="rgba(255,240,220,0.24)" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M31 48.5 L28 61" stroke="rgba(255,240,220,0.13)" strokeWidth="1.2" />
        <path d="M32 29 C 26 32, 22.5 38, 22.5 43 C 22.5 46, 26 47.5, 32 47.5 C 38 47.5, 41.5 46, 41.5 43 C 41.5 38, 38 32, 32 29 Z"
          fill="rgba(255,240,220,0.06)" stroke="rgba(255,240,220,0.26)" strokeWidth="1.5" />
        {/* the stones are also hardware: vents and a port, quietly */}
        <line x1="22" y1="68" x2="33" y2="68" stroke="rgba(255,240,220,0.18)" strokeWidth="1.3" strokeLinecap="round" />
        <line x1="22" y1="71.5" x2="33" y2="71.5" stroke="rgba(255,240,220,0.18)" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="41" cy="55" r="1.2" fill="rgba(255,240,220,0.22)" />
      </g>

      {/* beacon glow — breathes when lit */}
      {lit && (
        <motion.circle
          cx="32"
          cy="19"
          r="13"
          fill={state === "waking" ? "var(--waking)" : "var(--accent)"}
          animate={calm ? { opacity: 0.14 } : { opacity: [0.08, 0.2, 0.08] }}
          transition={calm ? { duration: 0.3 } : { duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {/* the fire */}
      {lit && (
        <motion.g
          style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
          animate={
            calm
              ? { scale: state === "waking" ? 0.62 : 1, rotate: 0 }
              : state === "waking"
                ? { scale: [0.45, 0.68, 0.5, 0.72], rotate: [-3, 2, -2, 3] }
                : state === "in_use"
                  ? { scale: [1, 1.1, 0.94, 1.06, 1], rotate: [-2, 2.5, -1.5, 2, -2] }
                  : { scale: [1, 1.05, 0.97, 1], rotate: [-1.5, 1.5, -1, 1.5] }
          }
          transition={
            calm
              ? { duration: 0.3 }
              : {
                  duration: state === "waking" ? 1.1 : state === "in_use" ? 1.5 : 2.6,
                  repeat: Infinity,
                  ease: "easeInOut",
                }
          }
        >
          <path
            d="M32 7 C 26.5 13.5, 24.6 17.5, 26.2 21.3 C 27.3 23.9, 29.6 25.4, 32 25.4 C 34.4 25.4, 36.7 23.9, 37.8 21.3 C 39.4 17.5, 37.5 13.5, 32 7 Z"
            fill="var(--waking)"
            opacity="0.92"
          />
          <path
            d="M32 13.5 C 29.4 16.8, 28.6 18.8, 29.5 20.9 C 30.1 22.3, 31 23, 32 23 C 33 23, 33.9 22.3, 34.5 20.9 C 35.4 18.8, 34.6 16.8, 32 13.5 Z"
            fill="#ffe9c0"
            opacity="0.95"
          />
        </motion.g>
      )}

      {/* signal arcs: the lit beacon transmitting */}
      {(state === "online" || state === "in_use") &&
        !calm &&
        [0, 1].map((i) => (
          <motion.path
            key={i}
            d="M23.5 10 A 12.5 12.5 0 0 1 40.5 10"
            fill="none"
            stroke={state === "in_use" ? "var(--inuse)" : "var(--accent)"}
            strokeWidth="1.4"
            strokeLinecap="round"
            animate={{ y: [4, -7], opacity: [0, 0.55, 0], scale: [0.7, 1.15] }}
            style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
            transition={{ duration: 2.6, delay: i * 1.3, repeat: Infinity, ease: "easeOut" }}
          />
        ))}

      {/* kindling ring while waking */}
      {state === "waking" && !calm && (
        <motion.circle
          cx="32"
          cy="20"
          r="5"
          fill="none"
          stroke="var(--waking)"
          strokeWidth="1.2"
          animate={{ r: [5, 15], opacity: [0.6, 0] }}
          transition={{ duration: 2.1, repeat: Infinity, ease: "easeOut" }}
        />
      )}

      {/* sparks when someone is on it */}
      {state === "in_use" &&
        !calm &&
        [0, 1, 2].map((i) => (
          <motion.circle
            key={i}
            cx={29 + i * 3.2}
            r="1.1"
            fill="var(--inuse)"
            animate={{ cy: [22, 6 - i * 2], opacity: [0, 0.9, 0] }}
            transition={{ duration: 1.9, delay: i * 0.6, repeat: Infinity, ease: "easeOut" }}
          />
        ))}

      {/* cold ember + snoring while it sleeps */}
      {state === "offline" && (
        <circle cx="32" cy="26.5" r="1.6" fill="var(--offline)" opacity="0.7" />
      )}
      {state === "offline" &&
        !calm &&
        [0, 1, 2].map((i) => (
          <motion.text
            key={i}
            x={42 + i * 4}
            y={24 - i * 2}
            fontSize={8 - i * 1.6}
            fontFamily="inherit"
            fontStyle="italic"
            fill="rgba(255,236,210,0.55)"
            animate={{ opacity: [0, 0.8, 0], y: [26 - i * 2, 14 - i * 3] }}
            transition={{ duration: 3.4, delay: i * 1.1, repeat: Infinity, ease: "easeOut" }}
          >
            z
          </motion.text>
        ))}
    </svg>
  );
}
