import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Monitor,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { useApp } from "../store";
import { api, hostPinUrl } from "../lib/api";
import { webPageName } from "../lib/flavour";
import { newPairingPin } from "../lib/pin";
import { newHost, type DependencyStatus, type DiscoveredHost, type Host } from "../types";
import { Button, Field } from "../components/ui";
import { Logo } from "../components/Logo";
import { sounds } from "../lib/sounds";
import { t } from "../lib/i18n";

const EASE = [0.22, 1, 0.36, 1] as const;

const STEPS = ["Welcome", "Find PC", "Dependencies", "Pair", "Remote Desktop", "Save"] as const;

export function Wizard() {
  const upsertHost = useApp((s) => s.upsertHost);
  const completeOnboarding = useApp((s) => s.completeOnboarding);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Host>(() => newHost());

  const patch = (p: Partial<Host>) => setDraft((d) => ({ ...d, ...p }));
  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  async function finish() {
    await upsertHost(draft, true);
    await completeOnboarding();
  }

  return (
    <div className="app-shell">
      <div className="scroll-area">
        <div className="page">
          {step > 0 && <Progress step={step} />}
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              {step === 0 && <Welcome onNext={next} />}
              {step === 1 && (
                <Discover draft={draft} patch={patch} onNext={next} onBack={back} />
              )}
              {step === 2 && <Dependencies onNext={next} onBack={back} />}
              {step === 3 && (
                <Pairing draft={draft} patch={patch} onNext={next} onBack={back} />
              )}
              {step === 4 && (
                <RdpStep draft={draft} patch={patch} onNext={next} onBack={back} />
              )}
              {step === 5 && (
                <SaveStep draft={draft} patch={patch} onBack={back} onFinish={finish} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <div style={{ display: "flex", gap: 7, marginBottom: 40 }}>
      {STEPS.slice(1).map((_, i) => {
        const idx = i + 1;
        const done = idx < step;
        const active = idx === step;
        return (
          <div
            key={i}
            style={{
              height: 3,
              flex: 1,
              borderRadius: 999,
              background: done || active ? "var(--accent)" : "var(--hairline)",
              opacity: done ? 0.5 : 1,
              transition: "background 240ms var(--ease), opacity 240ms var(--ease)",
            }}
          />
        );
      })}
    </div>
  );
}

function StepHead({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 30 }}>
      <div className="eyebrow" style={{ marginBottom: 12 }}>
        {eyebrow}
      </div>
      <h1 style={{ fontSize: 30 }}>{title}</h1>
      {sub && (
        <p className="text-2" style={{ marginTop: 10, fontSize: 15.5, lineHeight: 1.55, maxWidth: 560 }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function NavRow({
  onBack,
  children,
}: {
  onBack?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 34 }}>
      {onBack ? (
        <Button variant="quiet" onClick={onBack}>
          <ArrowLeft size={16} strokeWidth={2} />
          {t("wz.back")}
        </Button>
      ) : (
        <span />
      )}
      <div style={{ display: "flex", gap: 10 }}>{children}</div>
    </div>
  );
}

/* --------------------------------- Welcome -------------------------------- */

function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <div style={{ textAlign: "center", paddingTop: 40 }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: EASE }}
        style={{ display: "inline-flex", marginBottom: 30 }}
      >
        <Logo size={84} />
      </motion.div>
      <h1 style={{ fontSize: 40, letterSpacing: "-0.03em" }}>Varde</h1>
      <p
        className="text-2"
        style={{ margin: "14px auto 0", fontSize: 17, lineHeight: 1.6, maxWidth: 460 }}
      >
        {t("wz.welcomeSub")}
      </p>
      <div style={{ marginTop: 36 }}>
        <Button variant="primary" onClick={onNext}>
          {t("wz.getStarted")}
          <ArrowRight size={17} strokeWidth={2} />
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------- Discover ------------------------------- */

function Discover({
  draft,
  patch,
  onNext,
  onBack,
}: {
  draft: Host;
  patch: (p: Partial<Host>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [scanning, setScanning] = useState(true);
  const [found, setFound] = useState<DiscoveredHost[]>([]);
  const [manual, setManual] = useState(false);
  const [manualIp, setManualIp] = useState(draft.address);
  const [probing, setProbing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function scan() {
    setScanning(true);
    setError(null);
    try {
      const hosts = await api.discoverHosts(4500);
      setFound(hosts);
      if (hosts.length === 0) setManual(true);
    } catch (e) {
      setError(String(e));
      setManual(true);
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function choose(address: string, name?: string) {
    setProbing(address);
    setError(null);
    try {
      const probe = await api.probeHost(address);
      const macs = probe.mac ? [probe.mac] : [];
      patch({
        address: probe.ip || address,
        name: name || draft.name || t("wz.defaultPcName"),
        macs,
        paired: probe.status.paired ?? false,
      });
      onNext();
    } catch (e) {
      setError(String(e));
    } finally {
      setProbing(null);
    }
  }

  return (
    <div>
      <StepHead
        eyebrow={t("wz.step1")}
        title={t("wz.discoverTitle")}
        sub={t("wz.discoverSub")}
      />

      {scanning && (
        <div className="row-item" style={{ justifyContent: "center", gap: 12 }}>
          <Loader2 className="spin" size={18} />
          <span className="text-2">{t("wz.scanning")}</span>
        </div>
      )}

      {!scanning && found.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {found.map((h) => (
            <button
              key={h.address}
              className="action-card"
              style={{ padding: "18px 20px" }}
              disabled={probing !== null}
              onClick={() => choose(h.address, h.name)}
            >
              <span className="action-icon" style={{ width: 46, height: 46 }}>
                <Monitor size={22} strokeWidth={1.75} />
              </span>
              <span className="action-body">
                <span className="action-title" style={{ fontSize: 16 }}>
                  {h.name}
                </span>
                <span className="action-sub">{h.address}</span>
              </span>
              {probing === h.address ? (
                <Loader2 className="spin" size={18} />
              ) : (
                <ArrowRight className="action-chevron" size={20} strokeWidth={1.75} />
              )}
            </button>
          ))}
        </div>
      )}

      {!scanning && (
        <div style={{ marginTop: 14 }}>
          {!manual ? (
            <button className="btn btn-quiet" onClick={() => setManual(true)}>
              {t("wz.enterIpManually")}
            </button>
          ) : (
            <div className="card" style={{ padding: 20 }}>
              <Field
                label={t("wz.ipOrHostname")}
                value={manualIp}
                onChange={setManualIp}
                placeholder="192.168.1.50"
                autoFocus
              />
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <Button
                  variant="primary"
                  disabled={!manualIp.trim() || probing !== null}
                  onClick={() => choose(manualIp.trim())}
                >
                  {probing ? (
                    <>
                      <Loader2 className="spin" size={16} /> {t("wz.checking")}
                    </>
                  ) : (
                    <>
                      {t("wz.continue")} <ArrowRight size={16} strokeWidth={2} />
                    </>
                  )}
                </Button>
                <button className="btn btn-quiet" onClick={scan}>
                  <RefreshCw size={15} strokeWidth={2} />
                  {t("wz.rescan")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <p style={{ color: "#ffb4b4", fontSize: 13.5, marginTop: 14 }}>{error}</p>
      )}

      <NavRow onBack={onBack}>
        {!scanning && found.length > 0 && (
          <button className="btn btn-quiet" onClick={scan}>
            <RefreshCw size={15} strokeWidth={2} />
            {t("wz.rescan")}
          </button>
        )}
      </NavRow>
    </div>
  );
}

/* ------------------------------ Dependencies ------------------------------ */

function DepRow({ name, dep }: { name: string; dep: DependencyStatus["moonlight"] }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!dep.installCommand) return;
    await navigator.clipboard.writeText(dep.installCommand);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="row-item" style={{ alignItems: "flex-start", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, width: "100%" }}>
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: 34,
            height: 34,
            borderRadius: 999,
            flex: "none",
            background: dep.available ? "rgba(55,212,149,0.14)" : "rgba(255,107,107,0.12)",
            color: dep.available ? "var(--online)" : "var(--danger)",
          }}
        >
          {dep.available ? <Check size={18} strokeWidth={2.2} /> : <X size={18} strokeWidth={2.2} />}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 550, fontSize: 15 }}>{name}</div>
          <div className="text-3" style={{ fontSize: 12.5, marginTop: 2 }}>
            {dep.detail}
          </div>
        </div>
      </div>
      {!dep.available && dep.installCommand && (
        <div style={{ width: "100%" }}>
          <div
            className="muted-panel"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              fontSize: 13,
            }}
          >
            <code style={{ flex: 1, color: "var(--text-2)", userSelect: "text", overflowX: "auto" }}>
              {dep.installCommand}
            </code>
            <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={copy} aria-label={t("wz.copy")}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </div>
          {dep.installUrl && (
            <button
              className="btn btn-quiet"
              style={{ marginTop: 8, paddingLeft: 4 }}
              onClick={() => api.openUrl(dep.installUrl!)}
            >
              <ExternalLink size={14} strokeWidth={2} />
              {t("wz.openDownloadPage")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Dependencies({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [deps, setDeps] = useState<DependencyStatus | null>(null);
  const [loading, setLoading] = useState(true);

  async function check() {
    setLoading(true);
    try {
      setDeps(await api.checkDependencies());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    check();
  }, []);

  return (
    <div>
      <StepHead
        eyebrow={t("wz.step2")}
        title={t("wz.depsTitle")}
        sub={t("wz.depsSub")}
      />
      {loading || !deps ? (
        <div className="row-item" style={{ justifyContent: "center", gap: 12 }}>
          <Loader2 className="spin" size={18} />
          <span className="text-2">{t("wz.checking")}</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <DepRow name={t("wz.depMoonlight")} dep={deps.moonlight} />
          <DepRow name={deps.platform === "windows" ? t("wz.depMstsc") : t("wz.depFreerdp")} dep={deps.rdp} />
          <DepRow name={t("wz.depSsh")} dep={deps.ssh} />
        </div>
      )}
      <NavRow onBack={onBack}>
        <button className="btn btn-quiet" onClick={check}>
          <RefreshCw size={15} strokeWidth={2} />
          {t("wz.recheck")}
        </button>
        <Button variant="primary" onClick={onNext}>
          {t("wz.continue")} <ArrowRight size={16} strokeWidth={2} />
        </Button>
      </NavRow>
    </div>
  );
}

/* --------------------------------- Pairing -------------------------------- */

function Pairing({
  draft,
  patch,
  onNext,
  onBack,
}: {
  draft: Host;
  patch: (p: Partial<Host>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [phase, setPhase] = useState<"idle" | "pairing" | "done" | "error">(
    draft.paired ? "done" : "idle"
  );
  const [pin, setPin] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");

  async function startPairing() {
    // We choose the code and pass it to Moonlight, so its own pairing dialog
    // shows the same number this screen does.
    const code = newPairingPin();
    setPin(code);
    setPhase("pairing");
    setMessage(t("wz.enterPinOnHost", { page: webPageName(draft) }));
    try {
      const result = await api.startPairing(draft.address, code);
      if (result.paired) {
        patch({ paired: true });
        setPhase("done");
        sounds.success();
      } else {
        setPhase("error");
        setMessage(result.message);
      }
    } catch (e) {
      setPhase("error");
      setMessage(String(e));
    }
  }

  return (
    <div>
      <StepHead
        eyebrow={t("wz.step3")}
        title={t("wz.pairTitle")}
        sub={t("wz.pairSub")}
      />

      {phase === "done" ? (
        <div className="card" style={{ padding: 28, textAlign: "center" }}>
          <div
            style={{
              display: "grid",
              placeItems: "center",
              width: 56,
              height: 56,
              margin: "0 auto 16px",
              borderRadius: 999,
              background: "rgba(55,212,149,0.14)",
              color: "var(--online)",
            }}
          >
            <Check size={28} strokeWidth={2.2} />
          </div>
          <h2 style={{ fontSize: 20 }}>{t("wz.paired")}</h2>
          <p className="text-2" style={{ marginTop: 6 }}>
            {t("wz.pairedSub")}
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 28 }}>
          {phase === "idle" && (
            <div style={{ textAlign: "center" }}>
              <p className="text-2" style={{ fontSize: 15 }}>
                {t("wz.readyToPair")} <strong style={{ color: "var(--text)" }}>{draft.address}</strong>.
              </p>
              <div style={{ marginTop: 18 }}>
                <Button variant="primary" onClick={startPairing}>
                  {t("wz.startPairing")}
                </Button>
              </div>
            </div>
          )}

          {(phase === "pairing" || phase === "error") && (
            <div style={{ textAlign: "center" }}>
              {pin && (
                <div>
                  <div className="text-3" style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase" }}>
                    {t("wz.yourPin")}
                  </div>
                  <div className="pin-display">{pin}</div>
                </div>
              )}

              {phase === "pairing" && (
                <div style={{ display: "flex", justifyContent: "center", padding: 8 }}>
                  <Loader2 className="spin" size={18} />
                </div>
              )}

              <p
                className="text-2"
                style={{ marginTop: 16, fontSize: 14.5, color: phase === "error" ? "#ffb4b4" : undefined }}
              >
                {message}
              </p>

              <button
                className="btn btn-ghost"
                style={{ marginTop: 14 }}
                onClick={() => api.openUrl(hostPinUrl(draft.address))}
              >
                <ExternalLink size={15} strokeWidth={2} />
                {t("wz.openPinPage")}
              </button>

              {phase === "error" && (
                <div style={{ marginTop: 16 }}>
                  <Button variant="primary" onClick={startPairing}>
                    {t("wz.tryAgain")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <NavRow onBack={onBack}>
        {phase !== "done" && (
          <button className="btn btn-quiet" onClick={onNext}>
            {t("wz.skip")}
          </button>
        )}
        {phase === "done" && (
          <Button variant="primary" onClick={onNext}>
            {t("wz.continue")} <ArrowRight size={16} strokeWidth={2} />
          </Button>
        )}
      </NavRow>
    </div>
  );
}

/* ---------------------------------- RDP ----------------------------------- */

function RdpStep({
  draft,
  patch,
  onNext,
  onBack,
}: {
  draft: Host;
  patch: (p: Partial<Host>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <StepHead
        eyebrow={t("wz.step4")}
        title={t("wz.rdpTitle")}
        sub={t("wz.rdpSub")}
      />
      <div className="card" style={{ padding: 24 }}>
        <Field
          label={t("wz.rdpUsername")}
          value={draft.rdpUsername ?? ""}
          onChange={(v) => patch({ rdpUsername: v })}
          placeholder={t("wz.rdpUsernamePlaceholder")}
          hint={t("wz.rdpUsernameHint")}
          autoFocus
        />
      </div>
      <NavRow onBack={onBack}>
        <Button variant="primary" onClick={onNext}>
          {t("wz.continue")} <ArrowRight size={16} strokeWidth={2} />
        </Button>
      </NavRow>
    </div>
  );
}

/* --------------------------------- Save ----------------------------------- */

function SaveStep({
  draft,
  patch,
  onBack,
  onFinish,
}: {
  draft: Host;
  patch: (p: Partial<Host>) => void;
  onBack: () => void;
  onFinish: () => void;
}) {
  const [newMac, setNewMac] = useState("");
  const canFinish = useMemo(() => draft.name.trim() && draft.address.trim(), [draft]);

  function addMac() {
    const m = newMac.trim();
    if (!m) return;
    if (draft.macs.some((x) => x.toLowerCase() === m.toLowerCase())) {
      setNewMac("");
      return;
    }
    patch({ macs: [...draft.macs, m] });
    setNewMac("");
  }
  function removeMac(mac: string) {
    patch({ macs: draft.macs.filter((m) => m !== mac) });
  }

  return (
    <div>
      <StepHead
        eyebrow={t("wz.step5")}
        title={t("wz.saveTitle")}
        sub={t("wz.saveSub")}
      />
      <div className="card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
        <Field label={t("wz.nameLabel")} value={draft.name} onChange={(v) => patch({ name: v })} placeholder={t("wz.namePlaceholder")} />

        <div>
          <label className="field-label">{t("wz.macAddresses")}</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {draft.macs.length === 0 && (
              <span className="text-3" style={{ fontSize: 13 }}>
                {t("wz.noMacsYet")}
              </span>
            )}
            {draft.macs.map((mac) => (
              <span
                key={mac}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 8px 7px 14px",
                  borderRadius: 999,
                  background: "var(--surface-2)",
                  border: "1px solid var(--hairline)",
                  fontSize: 13,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {mac.toUpperCase()}
                <button
                  className="icon-btn"
                  style={{ width: 24, height: 24 }}
                  onClick={() => removeMac(mac)}
                  aria-label={t("wz.remove")}
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <input
              className="input"
              value={newMac}
              placeholder="AA:BB:CC:DD:EE:FF"
              spellCheck={false}
              onChange={(e) => setNewMac(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && addMac()}
              style={{ fontVariantNumeric: "tabular-nums" }}
            />
            <button className="btn btn-ghost" onClick={addMac}>
              <Plus size={16} strokeWidth={2} />
              {t("wz.add")}
            </button>
          </div>
          <div className="hint">
            {t("wz.macHintBefore")} <span style={{ color: "var(--text-2)" }}>ipconfig /all</span>{" "}
            {t("wz.macHintAfter")}
          </div>
        </div>
      </div>

      <NavRow onBack={onBack}>
        <Button variant="primary" disabled={!canFinish} onClick={onFinish}>
          <Check size={16} strokeWidth={2.2} />
          {t("wz.finishSetup")}
        </Button>
      </NavRow>
    </div>
  );
}
