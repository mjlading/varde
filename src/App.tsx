import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "./store";
import { Wizard } from "./screens/Wizard";
import { Main } from "./screens/Main";
import { Settings } from "./screens/Settings";
import { Logo } from "./components/Logo";
import { setSoundsEnabled } from "./lib/sounds";
import { initCalm, useCalm } from "./lib/calm";

export default function App() {
  const load = useApp((s) => s.load);
  const loaded = useApp((s) => s.loaded);
  const view = useApp((s) => s.view);
  const uiScale = useApp((s) => s.settings?.uiScale ?? 1);
  const soundsOn = useApp((s) => s.settings?.sounds ?? true);
  const theme = useApp((s) => s.settings?.theme ?? "dark");
  const calm = useCalm();

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => initCalm(), []);

  // One switch for every CSS consumer: aurora, border beams, and anything
  // else ambient pauses under body.calm.
  useEffect(() => {
    document.body.classList.toggle("calm", calm);
  }, [calm]);

  // Global UI zoom, so the launcher stays legible from a couch. `zoom` reflows
  // (unlike transform:scale), which is what we want here.
  useEffect(() => {
    (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom =
      String(uiScale);
  }, [uiScale]);

  useEffect(() => {
    setSoundsEnabled(soundsOn);
  }, [soundsOn]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme === "oled" ? "oled" : "cozy";
  }, [theme]);

  if (!loaded) {
    return (
      <div className="app-shell" style={{ alignItems: "center", justifyContent: "center" }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 0.5, scale: 1 }}
          transition={{ duration: 0.6, repeat: Infinity, repeatType: "reverse" }}
        >
          <Logo size={56} />
        </motion.div>
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={view}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        style={{ height: "100%" }}
      >
        {view === "wizard" && <Wizard />}
        {view === "main" && <Main />}
        {view === "settings" && <Settings />}
      </motion.div>
    </AnimatePresence>
  );
}
