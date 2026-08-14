// Filled by the i18n extraction. Keys are stable IDs; values are the copy.
export const en_main: Record<string, string> = {
  // Header state words
  "mn.stateAsleep": "Asleep",
  "mn.stateWaking": "Waking",
  "mn.stateReady": "Ready",
  "mn.stateInUse": "In use",

  // Toasts and inline toast actions
  "mn.newAddress": "{name} has a new address: {address}",
  "mn.streamReconnecting": "The stream was interrupted — reconnecting…",
  "mn.reconnect": "Reconnect",
  "mn.streamDropped": "The stream dropped unexpectedly.",
  "mn.streamEnded": "The stream ended.",
  "mn.doneForTonight": "Done for tonight? {name} is still on.",
  "mn.putToSleep": "Put to sleep",
  "mn.goingToSleep": "{name} is going to sleep.",
  "mn.consoleNotReclaimed": "The desktop wasn't brought back to the screen.",
  "mn.consoleReclaimed": "The desktop is back on the screen.",
  "mn.tryAgain": "Try again",
  "mn.settings": "Settings",

  // The three doors
  "mn.play": "Play",
  "mn.playSub": "{app}, straight to this screen",
  "mn.desktop": "Desktop",
  "mn.desktopSub": "The whole desktop, pixel for pixel",
  "mn.work": "Work",
  "mn.workSub": "Sharp text over RDP — coffee not included",

  // RDP password sheet
  "mn.signInWindows": "Sign in to Windows",
  "mn.connectingAs": "Connecting as",
  "mn.enterWindowsPassword": "Enter your Windows password",
  "mn.password": "Password",
  "mn.rememberOnThisMachine": "Remember on this machine",
  "mn.rememberOnDetail": "Saved to the keyring — Work becomes one click.",
  "mn.rememberOffDetail": "Used once for this connection, then forgotten.",
  "mn.cancel": "Cancel",
  "mn.connect": "Connect",

  // Connect overlay: wake progress
  "mn.takingLonger": "Taking longer than usual…",
  "mn.usuallyTakes": "Usually takes about {sec} seconds",
  "mn.measuringWakeTime": "Measuring how long this usually takes",
  "mn.elapsedSeconds": "{sec} s",

  // Connect overlay: phases
  "mn.pickAppTitle": "Which one is it?",
  "mn.pickAppBody": "{name} doesn't have that app. Here's what it offers — your choice is remembered.",
  "mn.wakeTimedOutHint":
    "Is the PC plugged in to power? If it was fully shut down, press the power button once — a PC on WiFi can only be woken from sleep, not from a full shutdown.",
  "mn.close": "Close",
  "mn.differentPassword": "Different password",
  "mn.wakingTitle": "Waking {name}",
  "mn.almostThere": "Almost there",
  "mn.connected": "Connected",

  // Connect flow: narration and errors
  "mn.awakeRdpDown":
    "The PC is awake, but Remote Desktop isn't answering. Check that Remote Desktop is turned on in Windows settings.",
  "mn.awakeStreamDown": "The PC is awake, but the streaming service isn't answering.",
  "mn.noWakeMethod":
    "The PC is asleep, and no wake method is set up. Add a MAC address — or waking via HTTP or a relay — in Settings.",
  "mn.sendingWakeSignal": "Sending a wake signal to {name}…",
  "mn.remoteWakeWaiting": "{detail} — waiting for the PC to wake…",
  "mn.waitingForWake": "Waiting for the PC to wake…",
  "mn.pcOnNetwork": "The PC is on the network — Windows is starting…",
  "mn.foundNewAddress": "Found {name} at new address {address}…",
  "mn.wokeRdpDown":
    "The PC woke, but Remote Desktop didn't answer. Check that Remote Desktop is turned on in Windows settings.",
  "mn.wokeStreamDown": "The PC woke, but the streaming service didn't answer.",
  "mn.wakeFailed": "{action} got no answer — the PC didn't wake.",
  "mn.openingRdp": "Opening Remote Desktop…",
  "mn.startingMoonlight": "Starting Moonlight…",
  "mn.preparingPc": "Getting the PC ready…",
  "mn.prepDoneStarting": "{detail} — starting Moonlight…",
  "mn.startingMoonlightQuality": "Starting Moonlight — {quality}",
  "mn.rdpOpening": "Remote Desktop is opening.",
  "mn.enjoy": "Enjoy.",

  // Host software naming (flavour)
  "mn.webPageNameKnown": "the {flavour} web page",
  "mn.webPageNameUnknown": "the host's web page",
  "mn.webButtonKnown": "Open {flavour}",
  "mn.webButtonUnknown": "Open the host's web page",
  "mn.webLinkKnown": "{flavour} web page",
  "mn.webLinkUnknown": "Host's web page",
  "mn.serviceQuestionKnown": "Is {flavour} running on it?",
  "mn.serviceQuestionUnknown": "Is Sunshine or Apollo running on it?",
  "mn.pinPageSentence": "Enter this PIN on {page}.",
};
