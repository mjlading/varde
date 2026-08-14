// English — the canonical dictionary. Assembled from per-area files so the
// extraction could happen in parallel; keys are prefixed per area
// (st./wz./mn.) and must be unique across files.
import { en_settings } from "./en.settings";
import { en_wizard } from "./en.wizard";
import { en_main } from "./en.main";

export const en: Record<string, string> = {
  ...en_settings,
  ...en_wizard,
  ...en_main,
};
