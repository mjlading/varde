import { create } from "zustand";
import { api } from "./lib/api";
import { resolveLang, setLang } from "./lib/i18n";
import type { Host, Settings } from "./types";

export type View = "wizard" | "main" | "settings";

interface AppState {
  settings: Settings | null;
  view: View;
  loaded: boolean;

  load: () => Promise<void>;
  persist: (next: Settings) => Promise<void>;
  setView: (view: View) => void;

  activeHost: () => Host | null;
  upsertHost: (host: Host, makeActive?: boolean) => Promise<void>;
  patchHost: (id: string, patch: Partial<Host>) => Promise<void>;
  removeHost: (id: string) => Promise<void>;
  completeOnboarding: () => Promise<void>;
}

export const useApp = create<AppState>((set, get) => ({
  settings: null,
  view: "wizard",
  loaded: false,

  load: async () => {
    const settings = await api.getSettings();
    setLang(resolveLang(settings.language));
    const view: View =
      settings.onboarded && settings.hosts.length > 0 ? "main" : "wizard";
    set({ settings, view, loaded: true });
  },

  persist: async (next: Settings) => {
    set({ settings: next });
    await api.saveSettings(next);
  },

  setView: (view) => set({ view }),

  activeHost: () => {
    const s = get().settings;
    if (!s) return null;
    return (
      s.hosts.find((h) => h.id === s.activeHostId) ?? s.hosts[0] ?? null
    );
  },

  upsertHost: async (host, makeActive = true) => {
    const s = get().settings;
    if (!s) return;
    const exists = s.hosts.some((h) => h.id === host.id);
    const hosts = exists
      ? s.hosts.map((h) => (h.id === host.id ? host : h))
      : [...s.hosts, host];
    const next: Settings = {
      ...s,
      hosts,
      activeHostId: makeActive ? host.id : s.activeHostId ?? host.id,
    };
    await get().persist(next);
  },

  patchHost: async (id, patch) => {
    const s = get().settings;
    if (!s) return;
    const next: Settings = {
      ...s,
      hosts: s.hosts.map((h) => (h.id === id ? { ...h, ...patch } : h)),
    };
    await get().persist(next);
  },

  removeHost: async (id) => {
    const s = get().settings;
    if (!s) return;
    // Forget the keyring password FIRST — the backend resolves the host by id,
    // so this must happen while the host still exists in settings.
    await api.forgetRdpPassword(id).catch(() => {});
    const hosts = s.hosts.filter((h) => h.id !== id);
    const activeHostId =
      s.activeHostId === id ? hosts[0]?.id ?? null : s.activeHostId;
    await get().persist({ ...s, hosts, activeHostId });
  },

  completeOnboarding: async () => {
    const s = get().settings;
    if (!s) return;
    await get().persist({ ...s, onboarded: true });
    set({ view: "main" });
  },
}));
