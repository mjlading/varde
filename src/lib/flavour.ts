// Naming the host software. Varde works with Sunshine, Apollo and
// anything else speaking GameStream, so hardcoding one name is wrong for most
// people — but a vague sentence is worse than a specific one when we do know.
//
// Detection is best-effort (see net::server_flavour), so every helper here
// falls back to wording that is true regardless of what is actually running.

import { t } from "./i18n";
import type { Host } from "../types";

/** The host software's own name, when we managed to identify it. */
export function flavourName(host: Host | null | undefined): string | null {
  return host?.flavour ?? null;
}

/** "Apollo-nettsiden" / "vertens nettside" */
export function webPageName(host: Host | null | undefined): string {
  const f = flavourName(host);
  return f
    ? t("mn.webPageNameKnown", { flavour: f })
    : t("mn.webPageNameUnknown");
}

/** Button label for opening the host's web UI. */
export function webButtonLabel(host: Host | null | undefined): string {
  const f = flavourName(host);
  return f ? t("mn.webButtonKnown", { flavour: f }) : t("mn.webButtonUnknown");
}

/** Label for the utility row link to the host's web page. */
export function webLinkLabel(host: Host | null | undefined): string {
  const f = flavourName(host);
  return f ? t("mn.webLinkKnown", { flavour: f }) : t("mn.webLinkUnknown");
}

/** Used when the stream port didn't answer: name what ought to be running. */
export function serviceQuestion(host: Host | null | undefined): string {
  const f = flavourName(host);
  return f
    ? t("mn.serviceQuestionKnown", { flavour: f })
    : t("mn.serviceQuestionUnknown");
}

/** Where the pairing PIN has to be typed. */
export function pinPageSentence(host: Host | null | undefined): string {
  return t("mn.pinPageSentence", { page: webPageName(host) });
}
