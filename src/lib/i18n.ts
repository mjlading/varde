// Varde's tiny i18n. No library: two dictionaries, one t().
//
// English is canonical — every key must exist in `en`; `nb` mirrors it and
// missing keys fall back to English rather than showing raw IDs. Language is
// resolved once at startup (settings.language, or the system locale when
// unset) and a change reloads the window, so t() can stay a plain function
// usable outside React.

import { en } from "../locales/en";
import { nb } from "../locales/nb";

export type Lang = "en" | "nb";
export type MsgKey = keyof typeof en;

const dicts: Record<Lang, Record<string, string>> = { en, nb };

let current: Lang = "en";

/** Map a stored preference (or none) to a concrete language. */
export function resolveLang(pref: string | null | undefined): Lang {
  if (pref === "en" || pref === "nb") return pref;
  const sys = (navigator.language ?? "").toLowerCase();
  return sys.startsWith("nb") || sys.startsWith("nn") || sys.startsWith("no")
    ? "nb"
    : "en";
}

export function setLang(lang: Lang) {
  current = lang;
  document.documentElement.lang = lang;
}

export function getLang(): Lang {
  return current;
}

/** Translate. `vars` fills {placeholders}: t("mn.newAddress", { name, address }). */
export function t(key: MsgKey, vars?: Record<string, string | number>): string {
  let s = dicts[current][key] ?? en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}
