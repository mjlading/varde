import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Link2,
  Loader2,
  Plus,
  Trash2,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { useApp } from "../store";
import { api, hostPinUrl, onPairingPin } from "../lib/api";
import { t } from "../lib/i18n";
import { describeAutoQuality, displayHint } from "../lib/display";
import { pinPageSentence } from "../lib/flavour";
import { setSoundsEnabled, sounds } from "../lib/sounds";
import type {
  GfxMode,
  Host,
  QualityPreset,
  StreamQuality,
  VideoCodec,
  WakeCheck,
  WakeConfig,
  WakeReport,
} from "../types";
import { Button, Field, Segmented, ToggleRow } from "../components/ui";

const EASE = [0.22, 1, 0.36, 1] as const;

const RESOLUTIONS = [
  { label: "720p", w: 1280, h: 720 },
  { label: "1080p", w: 1920, h: 1080 },
  { label: "1440p", w: 2560, h: 1440 },
  { label: "4K", w: 3840, h: 2160 },
];
const FPS = [30, 60, 120, 144];
const CODECS: VideoCodec[] = ["auto", "H.264", "HEVC", "AV1"];

const UI_SCALES = [
  { value: "1", labelKey: "st.scaleNormal", scale: 1.0 },
  { value: "1.35", labelKey: "st.scaleLarge", scale: 1.35 },
  { value: "1.7", labelKey: "st.scaleTv", scale: 1.7 },
];

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 34 }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 16.5, fontWeight: 700, letterSpacing: "-0.01em" }}>
          <span aria-hidden="true" style={{ width: 5, height: 18, borderRadius: 3, background: "var(--accent)", opacity: 0.75 }} />
          {title}
        </h2>
        {sub && <div className="text-3" style={{ fontSize: 13, marginTop: 5, paddingLeft: 14 }}>{sub}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
    </section>
  );
}

function presetSummary(p: QualityPreset): string {
  if (p === "balanced") return t("st.summaryBalanced");
  if (p === "quality") return t("st.summaryQuality");
  return t("st.summaryCustom");
}

/** Live summary for the Auto preset: what this screen actually is. */
function AutoQualitySummary() {
  const [text, setText] = useState(t("st.measuringScreen"));
  useEffect(() => {
    let alive = true;
    displayHint().then((d) => {
      if (alive) setText(t("st.autoQualityFollows", { desc: describeAutoQuality(d) }));
    });
    return () => {
      alive = false;
    };
  }, []);
  return <>{text}</>;
}

export function Settings() {
  const setView = useApp((s) => s.setView);
  const settings = useApp((s) => s.settings);
  const activeHost = useApp((s) => s.activeHost());
  const patchHost = useApp((s) => s.patchHost);
  const persist = useApp((s) => s.persist);
  const removeHost = useApp((s) => s.removeHost);

  const [h, setH] = useState<Host | null>(activeHost);
  const [repairing, setRepairing] = useState(false);
  const skipSave = useRef(true);
  const timer = useRef<number | null>(null);

  // Re-seed when the active host changes.
  useEffect(() => {
    skipSave.current = true;
    setH(activeHost);
  }, [activeHost?.id]);

  // Debounced autosave of the edited host.
  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    if (!h) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      patchHost(h.id, h);
    }, 350);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [h]);

  if (!settings || !h) {
    return (
      <div className="app-shell">
        <div className="scroll-area">
          <div className="page">
            <Button variant="quiet" onClick={() => setView("main")}>
              <ArrowLeft size={16} /> {t("st.back")}
            </Button>
            <p className="text-2" style={{ marginTop: 20 }}>{t("st.noHost")}</p>
          </div>
        </div>
      </div>
    );
  }

  const upd = (p: Partial<Host>) => setH((cur) => (cur ? { ...cur, ...p } : cur));
  const updQ = (p: Partial<StreamQuality>) =>
    setH((cur) => (cur ? { ...cur, qualityCustom: { ...cur.qualityCustom, ...p } } : cur));

  const q = h.qualityCustom;

  const currentScale =
    UI_SCALES.reduce((best, o) =>
      Math.abs(o.scale - (settings.uiScale ?? 1)) <
      Math.abs(best.scale - (settings.uiScale ?? 1))
        ? o
        : best
    ).value;

  return (
    <div className="app-shell">
      <div className="scroll-area">
        <motion.div
          className="page page-wide"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: EASE }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <Button variant="quiet" onClick={() => setView("main")}>
              <ArrowLeft size={16} strokeWidth={2} /> {t("st.done")}
            </Button>
          </div>
          <h1 style={{ fontSize: 30, marginTop: 8 }}>{t("st.title")}</h1>

          {/* Skjerm og lyd */}
          <Section title={t("st.displayTitle")} sub={t("st.displaySub")}>
            <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 18 }}>
              <Control label={t("st.uiScale")}>
                <Segmented
                  options={UI_SCALES.map((s) => ({ value: s.value, label: t(s.labelKey) }))}
                  value={currentScale}
                  onChange={(v) => {
                    const opt = UI_SCALES.find((s) => s.value === v)!;
                    persist({ ...settings, uiScale: opt.scale });
                  }}
                />
              </Control>
              <Control label="Språk / Language">
                <Segmented
                  options={[
                    { value: "auto", label: "Auto" },
                    { value: "en", label: "English" },
                    { value: "nb", label: "Norsk" },
                  ]}
                  value={settings.language ?? "auto"}
                  onChange={async (v) => {
                    await persist({ ...settings, language: v === "auto" ? null : v });
                    window.location.reload();
                  }}
                />
              </Control>
              <Control label={t("st.appearance")}>
                <Segmented
                  options={[
                    { value: "dark", label: t("st.themeCozy") },
                    { value: "oled", label: t("st.themeOled") },
                  ]}
                  value={settings.theme === "oled" ? "oled" : "dark"}
                  onChange={(v) => persist({ ...settings, theme: v })}
                />
              </Control>
              <div className="hint">
                {settings.theme === "oled"
                  ? t("st.themeHintOled")
                  : t("st.themeHintCozy")}
              </div>
              <ToggleRow
                label={t("st.soundsLabel")}
                sub={t("st.soundsSub")}
                on={settings.sounds ?? true}
                onChange={(v) => {
                  // Sync the module flag now — App's effect runs after this
                  // handler, so the confirmation chime would otherwise be muted.
                  setSoundsEnabled(v);
                  persist({ ...settings, sounds: v });
                  if (v) sounds.success();
                }}
              />
            </div>
          </Section>

          {/* Tilkobling */}
          <Section title={t("st.connTitle")}>
            <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 18 }}>
              <Field label={t("st.nameLabel")} value={h.name} onChange={(v) => upd({ name: v })} />
              <Field label={t("st.addressLabel")} value={h.address} onChange={(v) => upd({ address: v })} mono />
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <Field label={t("st.gameApp")} value={h.steamAppName} onChange={(v) => upd({ steamAppName: v })} hint={t("st.gameAppHint")} />
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <Field label={t("st.desktopApp")} value={h.desktopAppName} onChange={(v) => upd({ desktopAppName: v })} hint={t("st.desktopAppHint")} />
                </div>
              </div>
            </div>
          </Section>

          {/* Strømmekvalitet */}
          <Section title={t("st.qualityTitle")} sub={t("st.qualitySub")}>
            <div className="card" style={{ padding: 22 }}>
              <Segmented<QualityPreset>
                options={[
                  { value: "auto", label: t("st.auto") },
                  { value: "balanced", label: t("st.presetBalanced") },
                  { value: "quality", label: t("st.presetQuality") },
                  { value: "custom", label: t("st.presetCustom") },
                ]}
                value={h.qualityPreset}
                onChange={(v) => upd({ qualityPreset: v })}
              />
              <p className="text-2" style={{ marginTop: 14, fontSize: 14 }}>
                {h.qualityPreset === "auto" ? <AutoQualitySummary /> : presetSummary(h.qualityPreset)}
              </p>

              <AnimatePresence initial={false}>
                {h.qualityPreset === "custom" && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.24, ease: EASE }}
                    style={{ overflow: "hidden" }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 20, paddingTop: 20, borderTop: "1px solid var(--hairline)" }}>
                      <Control label={t("st.resolution")}>
                        <Segmented
                          options={RESOLUTIONS.map((r) => ({ value: r.label, label: r.label }))}
                          value={RESOLUTIONS.find((r) => r.w === q.width && r.h === q.height)?.label ?? "1080p"}
                          onChange={(label) => {
                            const r = RESOLUTIONS.find((x) => x.label === label)!;
                            updQ({ width: r.w, height: r.h });
                          }}
                        />
                      </Control>
                      <Control label={t("st.frameRate")}>
                        <Segmented
                          options={FPS.map((f) => ({ value: String(f), label: `${f}` }))}
                          value={String(q.fps)}
                          onChange={(v) => updQ({ fps: Number(v) })}
                        />
                      </Control>
                      <Control label={t("st.codec")}>
                        <Segmented
                          options={CODECS.map((c) => ({ value: c, label: c === "auto" ? t("st.auto") : c }))}
                          value={q.codec}
                          onChange={(v) => updQ({ codec: v as VideoCodec })}
                        />
                      </Control>
                      <div style={{ maxWidth: 200 }}>
                        <Field
                          label={t("st.bitrateMbps")}
                          type="number"
                          value={String(Math.round(q.bitrateKbps / 1000))}
                          onChange={(v) => updQ({ bitrateKbps: Math.max(1, Number(v) || 0) * 1000 })}
                        />
                      </div>
                      <ToggleRow label={t("st.vsync")} on={q.vsync} onChange={(v) => updQ({ vsync: v })} />
                      <ToggleRow label={t("st.framePacing")} sub={t("st.framePacingSub")} on={q.framePacing} onChange={(v) => updQ({ framePacing: v })} />
                      <ToggleRow label={t("st.hdr")} on={q.hdr} onChange={(v) => updQ({ hdr: v })} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </Section>

          {/* Fjernskrivebord */}
          <Section title={t("st.rdpTitle")}>
            <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
              <Field label={t("st.rdpUser")} value={h.rdpUsername ?? ""} onChange={(v) => upd({ rdpUsername: v })} placeholder={t("st.rdpUserPlaceholder")} />
              <ToggleRow label={t("st.fullscreen")} sub={t("st.fullscreenSub")} on={h.rdp.fullscreen ?? true} onChange={(v) => upd({ rdp: { ...h.rdp, fullscreen: v } })} />
              <ToggleRow label={t("st.dynRes")} sub={t("st.dynResSub")} on={h.rdp.dynamicResolution} onChange={(v) => upd({ rdp: { ...h.rdp, dynamicResolution: v } })} />
              <ToggleRow label={t("st.clipboard")} on={h.rdp.clipboard} onChange={(v) => upd({ rdp: { ...h.rdp, clipboard: v } })} />
              <ToggleRow label={t("st.audio")} on={h.rdp.audio} onChange={(v) => upd({ rdp: { ...h.rdp, audio: v } })} />
              <Control label={t("st.gfxLabel")}>
                <Segmented<GfxMode>
                  options={[
                    { value: "avc444", label: t("st.gfxSharp") },
                    { value: "avc420", label: t("st.gfxLight") },
                    { value: "off", label: t("st.gfxBasic") },
                  ]}
                  value={h.rdp.gfx ?? "avc444"}
                  onChange={(v) => upd({ rdp: { ...h.rdp, gfx: v } })}
                />
              </Control>
              <div className="hint">
                {h.rdp.gfx === "off"
                  ? t("st.gfxHintBasic")
                  : h.rdp.gfx === "avc420"
                    ? t("st.gfxHintLight")
                    : t("st.gfxHintSharp")}
              </div>
              <ToggleRow
                label={t("st.reclaimToggle")}
                sub={
                  h.ssh == null
                    ? t("st.reclaimNeedsSsh")
                    : t("st.reclaimSub")
                }
                on={h.rdp.reclaimConsole ?? true}
                onChange={(v) => upd({ rdp: { ...h.rdp, reclaimConsole: v } })}
              />
              {h.ssh != null && (h.rdp.reclaimConsole ?? true) && (
                <Field
                  mono
                  label={t("st.reclaimCmd")}
                  value={h.rdp.reclaimCommand ?? ""}
                  onChange={(v) => upd({ rdp: { ...h.rdp, reclaimCommand: v || null } })}
                  placeholder={t("st.reclaimCmdPlaceholder")}
                  hint={t("st.reclaimCmdHint")}
                />
              )}
              {h.ssh != null && <ReclaimNowRow hostId={h.id} />}
              {h.ssh != null && <HostQualityPanel hostId={h.id} />}
              <SavedPasswordRow hostId={h.id} />
            </div>
          </Section>

          {/* Bytte underveis */}
          <Section
            title={t("st.switchTitle")}
            sub={t("st.switchSub")}
          >
            <div className="card" style={{ padding: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 14.5, fontWeight: 500 }}>{t("st.hotkeyLabel")}</span>
                <span
                  style={{
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 13,
                    padding: "4px 10px",
                    borderRadius: 7,
                    border: "1px solid var(--hairline-strong)",
                    background: "var(--panel-2, rgba(255,255,255,0.04))",
                  }}
                >
                  Ctrl + Alt + Shift + D
                </span>
              </div>
              <div className="hint" style={{ marginTop: 12 }}>
                {t("st.switchHintHow")}
              </div>
              <div className="hint" style={{ marginTop: 8 }}>
                {t("st.switchHintLimits")}
              </div>
            </div>
          </Section>

          {/* Vekking */}
          <WakeSection host={h} onChange={upd} />

          {/* Dvale via SSH (valgfritt) */}
          <SshSection host={h} onChange={upd} />

          {/* Paring + fjerning */}
          <Section title={t("st.thisPcTitle")}>
            <div className="row-item">
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 550, fontSize: 15 }}>{t("st.pairingLabel")}</div>
                <div className="text-3" style={{ fontSize: 12.5, marginTop: 3 }}>
                  {h.paired ? t("st.pairedWithMoonlight") : t("st.notPairedYet")}
                </div>
              </div>
              <Button variant="ghost" onClick={() => setRepairing(true)}>
                <Link2 size={16} strokeWidth={2} />
                {t("st.pairAgain")}
              </Button>
            </div>
            <div className="row-item">
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 550, fontSize: 15 }}>{t("st.removePcLabel")}</div>
                <div className="text-3" style={{ fontSize: 12.5, marginTop: 3 }}>{t("st.removePcSub")}</div>
              </div>
              <Button variant="danger" onClick={async () => { await removeHost(h.id); setView("main"); }}>
                <Trash2 size={16} strokeWidth={2} />
                {t("st.remove")}
              </Button>
            </div>
          </Section>

          {/* Avansert */}
          <Section title={t("st.advancedTitle")}>
            <div className="card" style={{ padding: 22 }}>
              <Field
                mono
                label={t("st.moonlightPath")}
                value={settings.moonlightPathOverride ?? ""}
                onChange={(v) => persist({ ...settings, moonlightPathOverride: v || null })}
                placeholder={settings.moonlightPathOverride ?? t("st.moonlightPathPlaceholder")}
                hint={t("st.moonlightPathHint")}
              />
            </div>
          </Section>

          {settings.hosts.length > 1 && <HostList currentId={h.id} />}

          <div style={{ marginTop: 24 }}>
            <Button variant="quiet" onClick={() => setView("wizard")}>
              <Plus size={16} strokeWidth={2} />
              {t("st.addAnotherPc")}
            </Button>
          </div>
        </motion.div>
      </div>

      <AnimatePresence>
        {repairing && <RepairModal host={h} onClose={() => setRepairing(false)} onPaired={() => { upd({ paired: true }); }} />}
      </AnimatePresence>
    </div>
  );
}

/** Shows whether an RDP password sits in the OS keyring, with a forget button. */
function SavedPasswordRow({ hostId }: { hostId: string }) {
  const [saved, setSaved] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    setSaved(null);
    api
      .hasRdpPassword(hostId)
      .then((v) => alive && setSaved(v))
      .catch(() => alive && setSaved(false));
    return () => {
      alive = false;
    };
  }, [hostId]);

  return (
    <div className="row-item">
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 550, fontSize: 15 }}>{t("st.savedPassword")}</div>
        <div className="text-3" style={{ fontSize: 12.5, marginTop: 3 }}>
          {saved === null
            ? t("st.keyringChecking")
            : saved
              ? t("st.keyringHas")
              : t("st.keyringNone")}
        </div>
      </div>
      {saved && (
        <Button
          variant="danger"
          onClick={async () => {
            try {
              await api.forgetRdpPassword(hostId);
              setSaved(false);
            } catch {
              /* keyring hiccup — leave state as-is */
            }
          }}
        >
          {t("st.forget")}
        </Button>
      )}
    </div>
  );
}

/** The manual escape hatch: streaming shows a black screen when a remote
 *  desktop session is still holding the desktop. This puts it back. */
function ReclaimNowRow({ hostId }: { hostId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<null | { ok: boolean; text: string }>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      await api.reclaimConsole(hostId);
      setResult({ ok: true, text: t("st.reclaimDone") });
    } catch (e) {
      setResult({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="row-item">
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 550, fontSize: 15 }}>{t("st.blackScreenTitle")}</div>
          <div className="text-3" style={{ fontSize: 12.5, marginTop: 3 }}>
            {t("st.blackScreenSub")}
          </div>
        </div>
        <Button variant="ghost" onClick={run} disabled={busy}>
          {busy ? <><Loader2 className="spin" size={15} /> {t("st.reclaimBusy")}</> : t("st.reclaimNow")}
        </Button>
      </div>
      {result && (
        <div
          style={{
            fontSize: 13.5,
            marginTop: 8,
            color: result.ok ? "var(--online)" : "#ffb4b4",
          }}
        >
          {result.text}
        </div>
      )}
    </div>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <span style={{ fontSize: 14.5, fontWeight: 500 }}>{label}</span>
      {children}
    </div>
  );
}

function SshSection({ host, onChange }: { host: Host; onChange: (p: Partial<Host>) => void }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<null | boolean>(null);
  const enabled = host.ssh != null;

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.checkSsh(host.id));
    } catch {
      setResult(false);
    } finally {
      setTesting(false);
    }
  }

  return (
    <Section title={t("st.sshTitle")} sub={t("st.sshSub")}>
      <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
        <ToggleRow
          label={t("st.sshEnable")}
          on={enabled}
          onChange={(v) => onChange({ ssh: v ? { username: host.rdpUsername ?? "", port: 22 } : null })}
        />
        {enabled && host.ssh && (
          <>
            <div style={{ display: "flex", gap: 14 }}>
              <div style={{ flex: 1 }}>
                <Field label={t("st.sshUser")} value={host.ssh.username} onChange={(v) => onChange({ ssh: { ...host.ssh!, username: v } })} />
              </div>
              <div style={{ width: 120 }}>
                <Field label={t("st.port")} type="number" value={String(host.ssh.port)} onChange={(v) => onChange({ ssh: { ...host.ssh!, port: Number(v) || 22 } })} />
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Button variant="ghost" onClick={test} disabled={testing}>
                {testing ? <><Loader2 className="spin" size={15} /> {t("st.testing")}</> : t("st.testConnection")}
              </Button>
              {result === true && <span style={{ color: "var(--online)", fontSize: 13.5, display: "inline-flex", alignItems: "center", gap: 6 }}><Check size={16} /> {t("st.reachable")}</span>}
              {result === false && <span style={{ color: "#ffb4b4", fontSize: 13.5 }}>{t("st.sshFailed")}</span>}
            </div>
            <div className="hint">{t("st.sshHint")}</div>
          </>
        )}
      </div>
    </Section>
  );
}

/** Renders diagnose-style findings: pass / fail / advisory rows with a fix. */
function CheckRows({ checks }: { checks: WakeCheck[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {checks.map((c, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            gap: 10,
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid var(--hairline)",
            background: c.ok ? "transparent" : "rgba(255,107,107,0.06)",
          }}
        >
          <span
            style={{
              flexShrink: 0,
              marginTop: 1,
              color: c.ok ? (c.warn ? "var(--text-3)" : "var(--online)") : "#ffb4b4",
            }}
          >
            {c.ok ? <Check size={16} /> : <TriangleAlert size={16} />}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 550, fontSize: 14 }}>{c.label}</div>
            <div className="text-2" style={{ fontSize: 13, marginTop: 3, lineHeight: 1.5 }}>
              {c.detail}
            </div>
            {c.fix && (
              <div className="text-3" style={{ fontSize: 12.5, marginTop: 7, lineHeight: 1.5 }}>
                {c.fix}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The two host-side registry settings RDP picture quality hinges on: without
 *  them Windows ignores the AVC444 request and delivers 30 fps. */
function HostQualityPanel({ hostId }: { hostId: string }) {
  const [busy, setBusy] = useState<null | "check" | "fix">(null);
  const [checks, setChecks] = useState<WakeCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "check" | "fix") {
    setBusy(kind);
    setError(null);
    try {
      setChecks(
        kind === "check"
          ? await api.rdpHostCheck(hostId)
          : await api.rdpHostOptimize(hostId)
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  const problems = checks?.filter((c) => !c.ok).length ?? 0;

  return (
    <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 16 }}>
      <div style={{ fontWeight: 550, fontSize: 15 }}>{t("st.hostQualityTitle")}</div>
      <div className="text-3" style={{ fontSize: 12.5, marginTop: 3, lineHeight: 1.5 }}>
        {t("st.hostQualityBody")}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <Button variant="ghost" onClick={() => run("check")} disabled={busy != null}>
          {busy === "check" ? <><Loader2 className="spin" size={15} /> {t("st.checking")}</> : t("st.checkHost")}
        </Button>
        {problems > 0 && (
          <Button variant="primary" onClick={() => run("fix")} disabled={busy != null}>
            {busy === "fix" ? <><Loader2 className="spin" size={15} /> {t("st.settingUp")}</> : t("st.setUpHost")}
          </Button>
        )}
      </div>
      {error && <div style={{ color: "#ffb4b4", fontSize: 13.5, marginTop: 12 }}>{error}</div>}
      {checks && (
        <div style={{ marginTop: 12 }}>
          <CheckRows checks={checks} />
          {problems === 0 && (
            <div className="hint" style={{ marginTop: 10 }}>
              {t("st.hostAllSet")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Wake-on-LAN almost never fails on the network — it fails on three Windows
 *  settings nobody can see from here. This asks the PC directly, while it is
 *  still awake enough to answer. */
function WakeDiagnostics({ hostId }: { hostId: string }) {
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<WakeCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setChecks(null);
    setError(null);
    try {
      setChecks(await api.diagnoseWake(hostId));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const problems = checks?.filter((c) => !c.ok).length ?? 0;

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Button variant="ghost" onClick={run} disabled={busy}>
          {busy ? <><Loader2 className="spin" size={15} /> {t("st.checking")}</> : t("st.whyNotWaking")}
        </Button>
        <span className="text-3" style={{ fontSize: 12.5 }}>
          {t("st.diagNeedsAwake")}
        </span>
      </div>

      {error && <div style={{ color: "#ffb4b4", fontSize: 13.5, marginTop: 12 }}>{error}</div>}

      {checks && (
        <div style={{ marginTop: 14 }}>
          <div className="text-2" style={{ fontSize: 13.5, marginBottom: 10 }}>
            {problems === 0
              ? t("st.diagAllGood")
              : problems === 1
                ? t("st.diagFoundOne")
                : t("st.diagFoundMany", { count: problems })}
          </div>
          <CheckRows checks={checks} />
        </div>
      )}
    </div>
  );
}

const WAKE_METHOD_LABEL: Record<string, string> = {
  wol: "st.wakeMethodWol",
  http: "st.wakeMethodHttp",
  relay: "st.wakeMethodRelay",
};

/** How this PC gets woken. Magic packets die at the first router, so the HTTP
 *  and relay transports are what make waking work from outside the house. */
function WakeSection({ host, onChange }: { host: Host; onChange: (p: Partial<Host>) => void }) {
  const [testing, setTesting] = useState(false);
  const [report, setReport] = useState<WakeReport | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const wake = host.wake;
  const http = wake.http;
  const relay = wake.relay;

  const setWake = (p: Partial<WakeConfig>) => onChange({ wake: { ...wake, ...p } });

  async function test() {
    setTesting(true);
    setReport(null);
    setTestError(null);
    try {
      setReport(await api.wake(host.id, host.address));
    } catch (e) {
      setTestError(String(e));
    } finally {
      setTesting(false);
    }
  }

  return (
    <Section
      title={t("st.wakeTitle")}
      sub={t("st.wakeSub")}
    >
      <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
        <Field
          mono
          label={t("st.macLabel")}
          value={host.macs.join(", ")}
          onChange={(v) =>
            onChange({
              macs: v
                .split(",")
                .map((m) => m.trim())
                .filter(Boolean),
            })
          }
          placeholder={t("st.macPlaceholder")}
          hint={t("st.macHint")}
        />

        <ToggleRow
          label={t("st.wolToggle")}
          sub={
            host.macs.length === 0
              ? t("st.wolNeedsMac")
              : t("st.wolSub")
          }
          on={wake.wol}
          onChange={(v) => setWake({ wol: v })}
        />

        <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 16 }}>
          <ToggleRow
            label={t("st.httpToggle")}
            sub={t("st.httpToggleSub")}
            on={http != null}
            onChange={(v) =>
              setWake({
                http: v
                  ? { url: "", method: "GET", body: null, header: null, insecure: false }
                  : null,
              })
            }
          />
          {http && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>
              <Field
                mono
                label={t("st.httpUrl")}
                value={http.url}
                onChange={(v) => setWake({ http: { ...http, url: v } })}
                placeholder={t("st.httpUrlPlaceholder")}
              />
              <Control label={t("st.method")}>
                <Segmented
                  options={[
                    { value: "GET", label: "GET" },
                    { value: "POST", label: "POST" },
                  ]}
                  value={http.method.toUpperCase() === "POST" ? "POST" : "GET"}
                  onChange={(v) => setWake({ http: { ...http, method: v } })}
                />
              </Control>
              <Field
                mono
                label={t("st.headerLabel")}
                value={http.header ?? ""}
                onChange={(v) => setWake({ http: { ...http, header: v || null } })}
                placeholder={t("st.headerPlaceholder")}
                hint={t("st.headerHint")}
              />
              {http.method.toUpperCase() === "POST" && (
                <Field
                  mono
                  label={t("st.bodyLabel")}
                  value={http.body ?? ""}
                  onChange={(v) => setWake({ http: { ...http, body: v || null } })}
                  placeholder={t("st.bodyPlaceholder")}
                  hint={t("st.bodyHint")}
                />
              )}
              <ToggleRow
                label={t("st.insecureToggle")}
                sub={t("st.insecureSub")}
                on={http.insecure}
                onChange={(v) => setWake({ http: { ...http, insecure: v } })}
              />
            </div>
          )}
        </div>

        <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 16 }}>
          <ToggleRow
            label={t("st.relayToggle")}
            sub={t("st.relayToggleSub")}
            on={relay != null}
            onChange={(v) =>
              setWake({
                relay: v ? { address: "", username: "", port: 22, command: null } : null,
              })
            }
          />
          {relay && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <Field
                    mono
                    label={t("st.address")}
                    value={relay.address}
                    onChange={(v) => setWake({ relay: { ...relay, address: v } })}
                    placeholder={t("st.relayAddressPlaceholder")}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <Field
                    label={t("st.username")}
                    value={relay.username}
                    onChange={(v) => setWake({ relay: { ...relay, username: v } })}
                  />
                </div>
                <div style={{ width: 110 }}>
                  <Field
                    label={t("st.port")}
                    type="number"
                    value={String(relay.port)}
                    onChange={(v) => setWake({ relay: { ...relay, port: Number(v) || 22 } })}
                  />
                </div>
              </div>
              <Field
                mono
                label={t("st.relayCmd")}
                value={relay.command ?? ""}
                onChange={(v) => setWake({ relay: { ...relay, command: v || null } })}
                placeholder={t("st.relayCmdPlaceholder")}
                hint={t("st.relayCmdHint")}
              />
              <div className="hint">{t("st.relaySshHint")}</div>
            </div>
          )}
        </div>

        <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <Button variant="ghost" onClick={test} disabled={testing}>
              {testing ? <><Loader2 className="spin" size={15} /> {t("st.sending")}</> : <><Zap size={15} strokeWidth={2} /> {t("st.wakeTestButton")}</>}
            </Button>
            <span className="text-3" style={{ fontSize: 12.5 }}>
              {t("st.wakeTestNote")}
            </span>
          </div>
          {testError && (
            <div style={{ color: "#ffb4b4", fontSize: 13.5, marginTop: 12 }}>{testError}</div>
          )}
          {host.ssh != null && <WakeDiagnostics hostId={host.id} />}
          {report && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {report.attempts.map((a, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13.5 }}>
                  {a.ok ? (
                    <Check size={15} style={{ color: "var(--online)", flexShrink: 0 }} />
                  ) : (
                    <span style={{ color: "#ffb4b4", flexShrink: 0, width: 15, textAlign: "center" }}>·</span>
                  )}
                  <span style={{ fontWeight: 550, minWidth: 92 }}>
                    {WAKE_METHOD_LABEL[a.method] ? t(WAKE_METHOD_LABEL[a.method]) : a.method}
                  </span>
                  <span className="text-2">{a.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

function HostList({ currentId }: { currentId: string }) {
  const settings = useApp((s) => s.settings)!;
  const persist = useApp((s) => s.persist);
  const removeHost = useApp((s) => s.removeHost);
  return (
    <Section title={t("st.allPcsTitle")}>
      {settings.hosts.map((host) => (
        <div className="row-item" key={host.id}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 550, fontSize: 15 }}>{host.name}</div>
            <div className="text-3" style={{ fontSize: 12.5, marginTop: 2 }}>{host.address}</div>
          </div>
          {host.id === currentId ? (
            <span className="status-chip" style={{ fontSize: 12 }}>
              <span className="status-dot is-online" /> {t("st.active")}
            </span>
          ) : (
            <Button variant="quiet" onClick={() => persist({ ...settings, activeHostId: host.id })}>{t("st.makeActive")}</Button>
          )}
          {settings.hosts.length > 1 && (
            <button className="icon-btn" aria-label={t("st.remove")} onClick={() => removeHost(host.id)}>
              <Trash2 size={16} />
            </button>
          )}
        </div>
      ))}
    </Section>
  );
}

function RepairModal({ host, onClose, onPaired }: { host: Host; onClose: () => void; onPaired: () => void }) {
  const patchHost = useApp((s) => s.patchHost);
  const [pin, setPin] = useState<string | null>(null);
  const [message, setMessage] = useState(t("st.starting"));
  const [done, setDone] = useState(false);
  const unlisten = useRef<null | (() => void)>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      unlisten.current = await onPairingPin((p) => { if (!cancelled) { setPin(p); setMessage(pinPageSentence(host)); } });
      try {
        const res = await api.startPairing(host.address);
        if (cancelled) return;
        unlisten.current?.();
        if (res.paired) { await patchHost(host.id, { paired: true }); onPaired(); setDone(true); setMessage(t("st.pairedMsg")); sounds.success(); }
        else { setMessage(res.message); }
      } catch (e) {
        if (!cancelled) setMessage(String(e));
      }
    })();
    return () => { cancelled = true; unlisten.current?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <motion.div className="dialog" style={{ width: "100%", maxWidth: 420, padding: "34px 30px", textAlign: "center" }}
        initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.24, ease: EASE }}>
        <h2 style={{ fontSize: 20, marginBottom: 6 }}>{done ? t("st.pairedTitle") : t("st.pairAgain")}</h2>
        {pin && !done && (
          <div style={{ margin: "18px 0" }}>
            <div className="text-3" style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase" }}>{t("st.pin")}</div>
            <div className="pin-display">{pin}</div>
          </div>
        )}
        {!pin && !done && <div style={{ display: "flex", justifyContent: "center", padding: 18 }}><Loader2 className="spin" size={22} /></div>}
        <p className="text-2" style={{ fontSize: 14 }}>{message}</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
          {pin && !done && (
            <Button variant="ghost" onClick={() => api.openUrl(hostPinUrl(host.address))}>
              <ExternalLink size={15} strokeWidth={2} /> {t("st.pinPage")}
            </Button>
          )}
          <Button variant={done ? "primary" : "quiet"} onClick={onClose}>{done ? t("st.done") : t("st.close")}</Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
