# Waking

A magic packet is a link-layer broadcast: it dies at the first router.

That one fact shapes the whole design. Waking is therefore a *set* of
transports, all tried, one success enough — and when none of them works,
Varde asks the PC itself what's wrong rather than shrugging.

## The three transports

**Wake-on-LAN.** Magic packets to every MAC saved for the host, re-sent
every few seconds for the duration of the attempt, aimed at both the
limited broadcast address and the subnet-directed broadcast. Saving both
your Wi-Fi and Ethernet MACs matters: Windows only listens on the adapter
that's actually up, and which one that is can change between boots.

**HTTP.** Any URL that wakes the PC on your behalf — an
[UpSnap](https://github.com/seriousm4x/UpSnap) button, a Home Assistant
webhook, your router's own wake page. Because it's just a request, it
works from anywhere the URL is reachable, including outside the house.

**SSH relay.** Log in to something always-on that already sits on the
same network as the PC — a NAS, a Raspberry Pi, a router with SSH — and
have *it* send the magic packet. This is the transport that survives a
VPN or a tailnet, where broadcasts don't cross but SSH does.

Configure them in Settings → Wake. Varde fires every transport you've
configured; the first one that gets the PC answering wins, and the others
stop mattering.

## The progress bar is calibrated, not decorative

Varde records how long the last *successful* wake took — signal sent
until the streaming service answers — and uses that to pace the next
progress bar. A PC that takes 45 seconds to boot gets a 45-second bar.
The milestones underneath it are real state transitions, not a timer:
the host answering ping, then its ports opening, then the streaming
service replying.

## "Why won't it wake?"

When a wake fails, the interesting facts are all on the Windows side and
invisible from the client. With SSH configured, this button goes and
asks. It reports on:

- **Fast Startup**, which hibernates instead of shutting down and can
  leave the NIC powered off, so nothing is listening for the packet.
- **Whether anything is allowed to wake the machine at all** — the
  per-device "Allow this device to wake the computer" state.
- **Whether the live adapter has "Wake on Magic Packet" enabled**, which
  is separate from the above and off by default on plenty of drivers.
- **Whether that adapter's MAC is even in your saved list** — the quiet
  failure where everything is configured correctly and the packets are
  going to the other NIC.

Each finding comes with the exact click-path that fixes it — Device
Manager tab and checkbox, or the Control Panel page — because these all
live in Windows dialogs that no client can reach across the network.

## Things that are simply true

- **A PC on Wi-Fi can't wake from a full shutdown** — only from sleep.
  Wake-on-Wireless-LAN needs the adapter to stay associated with the
  access point, which a powered-down machine can't do. Ethernet can wake
  from shutdown if the firmware allows it; Wi-Fi can't. Varde tells you
  when that's the likely story rather than letting you retry forever.
- **Some firmware disables WoL after a power cut.** If waking stops
  working after an outage, check the BIOS before anything else.
- **DHCP moves things.** If the PC comes back on a new IP, Varde re-finds
  it over mDNS and verifies the MAC before adopting the address — during
  a wake and from the background poll — so a new lease doesn't turn into
  a broken host entry.
