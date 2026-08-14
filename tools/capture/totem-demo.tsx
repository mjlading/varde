/* Throwaway page for capturing docs/assets/totem-states.png.
 * Not part of the app; delete after capture. */
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import { HostTotem } from "../../src/components/artwork";
import type { HostState } from "../../src/types";

const STATES: { state: HostState; label: string }[] = [
  { state: "offline", label: "asleep" },
  { state: "waking", label: "waking" },
  { state: "online", label: "ready" },
  { state: "in_use", label: "in use" },
];

createRoot(document.getElementById("root")!).render(
  <div
    id="strip"
    style={{
      display: "flex",
      width: "fit-content",
      background: "var(--bg)",
      padding: "26px 26px 20px",
    }}
  >
    {STATES.map(({ state, label }) => (
      <div
        key={state}
        style={{
          width: 210,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
        }}
      >
        <HostTotem state={state} size={112} />
        <span
          className="mono"
          style={{
            fontSize: 13,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--text-2)",
          }}
        >
          {label}
        </span>
      </div>
    ))}
  </div>,
);
