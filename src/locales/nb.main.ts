// Filled by the i18n extraction. Keys are stable IDs; values are the copy.
export const nb_main: Record<string, string> = {
  // Header state words
  "mn.stateAsleep": "Sover",
  "mn.stateWaking": "Våkner",
  "mn.stateReady": "Klar",
  "mn.stateInUse": "I bruk",

  // Toasts and inline toast actions
  "mn.newAddress": "{name} har fått ny adresse: {address}",
  "mn.streamReconnecting": "Strømmen ble avbrutt — kobler til på nytt…",
  "mn.reconnect": "Koble til igjen",
  "mn.streamDropped": "Strømmen røk uventet.",
  "mn.streamEnded": "Strømmen ble avsluttet.",
  "mn.doneForTonight": "Ferdig for i kveld? {name} står fortsatt på.",
  "mn.putToSleep": "Legg i dvale",
  "mn.goingToSleep": "{name} legger seg til å sove.",
  "mn.consoleNotReclaimed": "Skrivebordet ble ikke hentet tilbake til skjermen.",
  "mn.consoleReclaimed": "Skrivebordet er tilbake på skjermen.",
  "mn.tryAgain": "Prøv igjen",
  "mn.settings": "Innstillinger",

  // The three doors
  "mn.play": "Spill",
  "mn.playSub": "{app}, rett hit på skjermen",
  "mn.desktop": "Skrivebord",
  "mn.desktopSub": "Hele skrivebordet, piksel for piksel",
  "mn.work": "Jobb",
  "mn.workSub": "Skarp tekst over RDP — kaffe kommer ikke med",

  // RDP password sheet
  "mn.signInWindows": "Logg på Windows",
  "mn.connectingAs": "Kobler til som",
  "mn.enterWindowsPassword": "Skriv inn Windows-passordet",
  "mn.password": "Passord",
  "mn.rememberOnThisMachine": "Husk på denne maskinen",
  "mn.rememberOnDetail": "Lagres i nøkkelringen — Jobb blir ett klikk.",
  "mn.rememberOffDetail": "Brukes én gang for denne tilkoblingen, så glemt.",
  "mn.cancel": "Avbryt",
  "mn.connect": "Koble til",

  // Connect overlay: wake progress
  "mn.takingLonger": "Tar lengre tid enn vanlig…",
  "mn.usuallyTakes": "Tar vanligvis ca. {sec} sekunder",
  "mn.measuringWakeTime": "Måler hvor lang tid dette pleier å ta",
  "mn.elapsedSeconds": "{sec} s",

  // Connect overlay: phases
  "mn.pickAppTitle": "Hvilken er det?",
  "mn.pickAppBody": "{name} har ikke den appen. Her er hva den tilbyr — valget huskes.",
  "mn.wakeTimedOutHint":
    "Er PC-en koblet til strøm? Hvis den var helt avslått, trykk på av/på-knappen én gang — en PC på WiFi kan bare vekkes fra dvale, ikke fra full avslåing.",
  "mn.close": "Lukk",
  "mn.differentPassword": "Annet passord",
  "mn.wakingTitle": "Vekker {name}",
  "mn.almostThere": "Nesten der",
  "mn.connected": "Tilkoblet",

  // Connect flow: narration and errors
  "mn.awakeRdpDown":
    "PC-en er våken, men Fjernskrivebord svarer ikke. Sjekk at Fjernskrivebord er slått på i Windows-innstillingene.",
  "mn.awakeStreamDown": "PC-en er våken, men strømmetjenesten svarer ikke.",
  "mn.noWakeMethod":
    "PC-en sover, og ingen vekkemetode er satt opp. Legg til en MAC-adresse — eller vekking via HTTP eller mellomtjener — i Innstillinger.",
  "mn.sendingWakeSignal": "Sender vekkesignal til {name}…",
  "mn.remoteWakeWaiting": "{detail} — venter på at PC-en våkner…",
  "mn.waitingForWake": "Venter på at PC-en våkner…",
  "mn.pcOnNetwork": "PC-en er på nettet — Windows starter…",
  "mn.foundNewAddress": "Fant {name} på ny adresse {address}…",
  "mn.wokeRdpDown":
    "PC-en våknet, men Fjernskrivebord svarte ikke. Sjekk at Fjernskrivebord er slått på i Windows-innstillingene.",
  "mn.wokeStreamDown": "PC-en våknet, men strømmetjenesten svarte ikke.",
  "mn.wakeFailed": "{action} fikk ikke svar — PC-en våknet ikke.",
  "mn.openingRdp": "Åpner Fjernskrivebord…",
  "mn.startingMoonlight": "Starter Moonlight…",
  "mn.preparingPc": "Gjør PC-en klar…",
  "mn.prepDoneStarting": "{detail} — starter Moonlight…",
  "mn.startingMoonlightQuality": "Starter Moonlight — {quality}",
  "mn.rdpOpening": "Fjernskrivebord åpner.",
  "mn.enjoy": "Kos deg.",

  // Host software naming (flavour)
  "mn.webPageNameKnown": "{flavour}-nettsiden",
  "mn.webPageNameUnknown": "vertens nettside",
  "mn.webButtonKnown": "Åpne {flavour}",
  "mn.webButtonUnknown": "Åpne vertens nettside",
  "mn.webLinkKnown": "{flavour}-nettside",
  "mn.webLinkUnknown": "Vertens nettside",
  "mn.serviceQuestionKnown": "Kjører {flavour} på den?",
  "mn.serviceQuestionUnknown": "Kjører Sunshine eller Apollo på den?",
  "mn.pinPageSentence": "Skriv inn denne PIN-koden på {page}. Moonlight-vinduet viser den samme koden.",
};
