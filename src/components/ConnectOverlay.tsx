import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Power, TriangleAlert } from "lucide-react";
import type { ConnectState } from "../lib/useConnect";
import type { Host } from "../types";
import { Button } from "./ui";
import { api, hostWebUrl } from "../lib/api";
import { webButtonLabel } from "../lib/flavour";
import { t } from "../lib/i18n";

const EASE = [0.22, 1, 0.36, 1] as const;

function BreathingPulse({ tone = "accent" }: { tone?: "accent" | "online" }) {
  const color = tone === "online" ? "55, 212, 149" : "91, 140, 255";
  return (
    <div style={{ position: "relative", width: 120, height: 120 }}>
      {[0, 1].map((i) => (
        <motion.span
          key={i}
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "999px",
            border: `1px solid rgba(${color}, 0.5)`,
          }}
          initial={{ scale: 0.7, opacity: 0.5 }}
          animate={{ scale: 1.35, opacity: 0 }}
          transition={{
            duration: 2.4,
            ease: "easeOut",
            repeat: Infinity,
            delay: i * 1.2,
          }}
        />
      ))}
      <motion.div
        style={{
          position: "absolute",
          inset: 26,
          borderRadius: "999px",
          background: `radial-gradient(circle at 50% 40%, rgba(${color},0.9), rgba(${color},0.35))`,
          boxShadow: `0 0 40px 0 rgba(${color}, 0.5)`,
        }}
        animate={{ scale: [1, 1.08, 1], opacity: [0.85, 1, 0.85] }}
        transition={{ duration: 2.1, ease: "easeInOut", repeat: Infinity }}
      />
    </div>
  );
}

/** Progress for the wake wait, calibrated against how long the last
 *  successful wake took (falls back to a typical 45s when unknown). */
function WakeProgress({
  startedAt,
  expectedMs,
}: {
  startedAt: number;
  expectedMs: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  const elapsed = Math.max(0, now - startedAt);
  // Floor guards against a miscalibrated (too-short) remembered duration.
  const expected = Math.max(expectedMs ?? 45_000, 10_000);
  // Never quite fills — reaching the end is signalled by the phase change.
  const pct = Math.min(96, (elapsed / expected) * 100);
  const slow = elapsed > expected * 1.5;

  return (
    <div style={{ marginTop: 22 }}>
      <div
        style={{
          height: 4,
          borderRadius: 999,
          background: "var(--hairline-strong)",
          overflow: "hidden",
        }}
      >
        <motion.div
          style={{
            height: "100%",
            borderRadius: 999,
            background:
              "linear-gradient(90deg, rgba(91,140,255,0.55), rgba(91,140,255,0.95))",
          }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, ease: "linear" }}
        />
      </div>
      <div
        className="text-3"
        style={{
          fontSize: 12.5,
          marginTop: 8,
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <span>
          {slow
            ? t("mn.takingLonger")
            : expectedMs
              ? t("mn.usuallyTakes", { sec: Math.round(expectedMs / 1000) })
              : t("mn.measuringWakeTime")}
        </span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {t("mn.elapsedSeconds", { sec: Math.round(elapsed / 1000) })}
        </span>
      </div>
    </div>
  );
}

export function ConnectOverlay({
  state,
  host,
  onClose,
  onRetry,
  onPickApp,
  onReenterPassword,
}: {
  state: ConnectState;
  host: Host;
  onClose: () => void;
  onRetry: () => void;
  onPickApp: (app: string) => void;
  onReenterPassword: () => void;
}) {
  const active = state.phase !== "idle";

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
        >
          <motion.div
            className="dialog"
            style={{ width: "100%", maxWidth: 440, padding: "40px 36px", textAlign: "center" }}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 6 }}
            transition={{ duration: 0.26, ease: EASE }}
          >
            {state.phase === "pick_app" ? (
              <>
                <h2 style={{ fontSize: 21 }}>{t("mn.pickAppTitle")}</h2>
                <p className="text-2" style={{ marginTop: 8, fontSize: 14 }}>
                  {t("mn.pickAppBody", { name: host.name })}
                </p>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    marginTop: 20,
                  }}
                >
                  {(state.apps ?? []).map((app) => (
                    <button
                      key={app}
                      className="btn btn-ghost"
                      style={{ justifyContent: "center", width: "100%" }}
                      onClick={() => onPickApp(app)}
                    >
                      {app}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 16 }}>
                  <Button variant="quiet" onClick={onClose}>
                    {t("mn.cancel")}
                  </Button>
                </div>
              </>
            ) : state.phase === "error" ? (
              <>
                <div
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: 68,
                    height: 68,
                    margin: "0 auto 22px",
                    borderRadius: 20,
                    background: "rgba(255,107,107,0.12)",
                    border: "1px solid rgba(255,107,107,0.28)",
                    color: "var(--danger)",
                  }}
                >
                  <TriangleAlert size={30} strokeWidth={1.75} />
                </div>
                <h2 style={{ fontSize: 21 }}>{state.error}</h2>
                {state.wakeTimedOut && (
                  <div
                    className="muted-panel"
                    style={{
                      marginTop: 18,
                      padding: "16px 18px",
                      textAlign: "left",
                      display: "flex",
                      gap: 12,
                    }}
                  >
                    <Power size={18} strokeWidth={1.75} style={{ color: "var(--text-3)", flex: "none", marginTop: 2 }} />
                    <div className="text-2" style={{ fontSize: 13.5, lineHeight: 1.55 }}>
                      {t("mn.wakeTimedOutHint")}
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 24, flexWrap: "wrap" }}>
                  <Button variant="quiet" onClick={onClose}>
                    {t("mn.close")}
                  </Button>
                  {state.action === "work" ? (
                    <Button variant="ghost" onClick={onReenterPassword}>
                      {t("mn.differentPassword")}
                    </Button>
                  ) : (
                    <Button variant="ghost" onClick={() => api.openUrl(hostWebUrl(host.address))}>
                      {webButtonLabel(host)}
                    </Button>
                  )}
                  <Button variant="primary" onClick={onRetry}>
                    {t("mn.tryAgain")}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: "grid", placeItems: "center", marginBottom: 26 }}>
                  <BreathingPulse tone={state.phase === "launched" ? "online" : "accent"} />
                </div>
                <h2 style={{ fontSize: 22 }}>
                  {state.phase === "waking" && t("mn.wakingTitle", { name: host.name })}
                  {state.phase === "launching" && t("mn.almostThere")}
                  {state.phase === "launched" && t("mn.connected")}
                </h2>
                <p className="text-2" style={{ marginTop: 8, fontSize: 14.5 }}>
                  {state.message}
                </p>
                {state.phase === "waking" && (
                  <>
                    {state.wakeStartedAt != null && (
                      <WakeProgress
                        startedAt={state.wakeStartedAt}
                        expectedMs={state.wakeExpectedMs ?? null}
                      />
                    )}
                    <div style={{ marginTop: 22 }}>
                      <Button variant="quiet" onClick={onClose}>
                        {t("mn.cancel")}
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
