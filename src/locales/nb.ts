// Norwegian bokmål — the app's original voice, kept as the second language.
import { nb_settings } from "./nb.settings";
import { nb_wizard } from "./nb.wizard";
import { nb_main } from "./nb.main";

export const nb: Record<string, string> = {
  ...nb_settings,
  ...nb_wizard,
  ...nb_main,
};
