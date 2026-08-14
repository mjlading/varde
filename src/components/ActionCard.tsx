import { useState, type ReactNode } from "react";
import { motion, useMotionValue } from "framer-motion";
import { SceneHover } from "./artwork";

/** Front-page action card: a small animated scene instead of a stock icon,
 *  a per-card color wash, a keycap hinting its shortcut — and two light
 *  treatments: a beam of light slowly tracing the card's border (always on,
 *  brighter on hover) and a spotlight that follows the cursor. */
export function ActionCard({
  art,
  tint,
  beam,
  title,
  sub,
  keycap,
  onClick,
  disabled,
  index = 0,
}: {
  art: ReactNode;
  /** rgba() wash painted across the card, e.g. "rgba(139,123,255,0.10)" */
  tint: string;
  /** Color of the border beam; defaults to the accent. */
  beam?: string;
  title: string;
  sub: string;
  keycap: string;
  onClick?: () => void;
  disabled?: boolean;
  index?: number;
}) {
  const [hovered, setHovered] = useState(false);
  // Cursor position normalized to the scene canvas (150×110), springed by
  // the consumers. Reset to center on leave so the worlds settle back.
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  return (
    <motion.button
      type="button"
      className="action-card action-card--art"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        mx.set(0.5);
        my.set(0.5);
      }}
      onMouseMove={(e) => {
        // clientX/rect are visual-viewport px; the global TV zoom scales the
        // card's own px, so divide the delta back into local coordinates.
        const zoom = parseFloat(document.documentElement.style.zoom) || 1;
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--mx", `${(e.clientX - r.left) / zoom}px`);
        e.currentTarget.style.setProperty("--my", `${(e.clientY - r.top) / zoom}px`);
        // Scene-relative: x across the card width, y against the scene's
        // 150px-tall panel at the top of the tile.
        mx.set(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
        my.set(Math.min(1.6, Math.max(-0.1, (e.clientY - r.top) / zoom / 150)));
      }}
      style={
        {
          "--beam-color": beam ?? "rgba(91, 140, 255, 0.9)",
          // Stagger the three beams so they never sweep in sync.
          "--beam-delay": `${index * -2.6}s`,
        } as React.CSSProperties
      }
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.32,
        delay: 0.05 + index * 0.06,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      <span
        className="card-tint"
        style={{ background: `linear-gradient(115deg, ${tint} 0%, transparent 55%)` }}
      />
      <span className="card-spotlight" />
      <span className="card-beam" />
      <SceneHover.Provider value={{ hovered, mx, my }}>
        <span className="scene-panel">{art}</span>
      </SceneHover.Provider>
      <span className="action-body">
        <span className="action-title">{title}</span>
        <span className="action-sub">{sub}</span>
      </span>
      <kbd className="keycap">{keycap}</kbd>
    </motion.button>
  );
}
