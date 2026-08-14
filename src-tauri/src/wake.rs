//! Waking the PC, by whatever route actually reaches it.
//!
//! A Wake-on-LAN magic packet is a link-layer broadcast: it dies at the first
//! router, so it only ever works from the same network. That's the single
//! biggest gap in every streaming client — waking the machine when you're not
//! home. So wake is modelled as a set of transports, all of which are tried;
//! one success is enough:
//!
//! * `wol`   — magic packets to every stored MAC (local network)
//! * `http`  — an endpoint that wakes the PC for us: UpSnap, a Home Assistant
//!             webhook, a router page (works from anywhere it's reachable)
//! * `relay` — SSH into an always-on box on the PC's network and have *it*
//!             send the magic packet locally (works over a VPN/tailnet)

use crate::net;
use crate::settings::{Host, HttpWake, RelayWake};
use crate::ssh;
use serde::Serialize;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;

/// Sends the magic packet from the relay itself. Tries the usual tools and
/// falls back to bash's /dev/udp, so a bare NAS with nothing installed works
/// too. `{mac}` is the colon form, `{macraw}` bare hex, `{broadcast}` the
/// target address.
///
/// The steps are chained with `||` rather than gated on `command -v`: etherwake
/// needs CAP_NET_RAW, so on a box where it is installed but unprivileged an
/// existence check would pick it, fail, and never reach the fallback that
/// would have worked. Falling through on *failure* is what we actually want.
const DEFAULT_RELAY_CMD: &str = concat!(
    "wakeonlan -i {broadcast} {mac} 2>/dev/null || ",
    "etherwake {mac} 2>/dev/null || ",
    "bash -c 'p=$(printf \"\\\\xff%.0s\" $(seq 6)); ",
    "m=$(echo {macraw} | sed \"s/../\\\\\\\\x&/g\"); ",
    "for i in $(seq 16); do p=\"$p$m\"; done; ",
    "printf \"$p\" > /dev/udp/{broadcast}/9'"
);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WakeAttempt {
    /// "wol" | "http" | "relay"
    pub method: String,
    pub ok: bool,
    /// Short human-readable outcome, already in English.
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WakeReport {
    pub any_ok: bool,
    pub attempts: Vec<WakeAttempt>,
}

/// Try every configured transport. Errors only when nothing is configured or
/// every transport failed — a single success is a successful wake.
pub async fn wake_host(host: &Host, address: &str) -> Result<WakeReport, String> {
    let cfg = &host.wake;
    let wol_possible = cfg.wol && !host.macs.is_empty();

    if !wol_possible && cfg.http.is_none() && cfg.relay.is_none() {
        return Err(if host.macs.is_empty() && cfg.wol {
            "No MAC address is saved, so the PC can't be woken. Add a MAC — or set up waking via HTTP or a relay — in Settings."
                .to_string()
        } else {
            "No wake method is set up for this PC.".to_string()
        });
    }

    let mut attempts = Vec::new();

    if wol_possible {
        attempts.push(match net::send_wol(&host.macs, Some(address)) {
            Ok(()) => WakeAttempt {
                method: "wol".into(),
                ok: true,
                detail: format!("Wake signal sent to {} MAC address(es)", host.macs.len()),
            },
            Err(e) => WakeAttempt {
                method: "wol".into(),
                ok: false,
                detail: e,
            },
        });
    }

    // The remote transports are independent and each can be slow, so overlap
    // them rather than paying both timeouts back to back.
    let http_fut = async {
        match &cfg.http {
            Some(h) => Some(wake_http(h).await),
            None => None,
        }
    };
    let relay_fut = async {
        match &cfg.relay {
            Some(r) => Some(wake_relay(r, &host.macs, address).await),
            None => None,
        }
    };
    let (http_res, relay_res) = tokio::join!(http_fut, relay_fut);
    attempts.extend(http_res);
    attempts.extend(relay_res);

    let any_ok = attempts.iter().any(|a| a.ok);
    if !any_ok {
        let why = attempts
            .iter()
            .map(|a| a.detail.as_str())
            .collect::<Vec<_>>()
            .join(" · ");
        return Err(format!("None of the wake methods got through: {why}"));
    }
    Ok(WakeReport { any_ok, attempts })
}

async fn wake_http(cfg: &HttpWake) -> WakeAttempt {
    let fail = |detail: String| WakeAttempt {
        method: "http".into(),
        ok: false,
        detail,
    };

    let url = cfg.url.trim();
    if url.is_empty() {
        return fail("No HTTP address has been entered".into());
    }

    let client = match reqwest::Client::builder()
        .danger_accept_invalid_certs(cfg.insecure)
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return fail(format!("Could not set up the HTTP client: {e}")),
    };

    let mut req = if cfg.method.eq_ignore_ascii_case("POST") {
        client.post(url)
    } else {
        client.get(url)
    };
    if let Some(h) = cfg.header.as_deref().map(str::trim).filter(|h| !h.is_empty()) {
        match h.split_once(':') {
            Some((name, value)) => req = req.header(name.trim(), value.trim()),
            None => return fail("The header must be written as \"Name: value\"".into()),
        }
    }
    if let Some(b) = cfg.body.as_deref().filter(|b| !b.trim().is_empty()) {
        // A JSON body is by far the common case (Home Assistant, UpSnap).
        let is_json = matches!(b.trim().chars().next(), Some('{') | Some('['));
        if is_json {
            req = req.header("Content-Type", "application/json");
        }
        req = req.body(b.to_string());
    }

    match req.send().await {
        Ok(resp) => {
            let code = resp.status();
            if code.is_success() {
                WakeAttempt {
                    method: "http".into(),
                    ok: true,
                    detail: format!("The HTTP endpoint answered {}", code.as_u16()),
                }
            } else {
                fail(format!("The HTTP endpoint answered {}", code.as_u16()))
            }
        }
        Err(e) if e.is_timeout() => fail("The HTTP endpoint did not answer in time".into()),
        Err(e) if e.is_connect() => fail("Could not reach the HTTP endpoint".into()),
        Err(_) => fail("The HTTP request failed".into()),
    }
}

async fn wake_relay(cfg: &RelayWake, macs: &[String], address: &str) -> WakeAttempt {
    let fail = |detail: String| WakeAttempt {
        method: "relay".into(),
        ok: false,
        detail,
    };

    if cfg.address.trim().is_empty() || cfg.username.trim().is_empty() {
        return fail("The relay is missing an address or a username".into());
    }
    let Some(mac) = macs.first() else {
        return fail("No MAC address to send through the relay".into());
    };
    let Ok(parsed) = net::parse_mac(mac) else {
        return fail(format!("\"{mac}\" is not a valid MAC address"));
    };
    let colon = parsed
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(":");
    let raw = parsed.iter().map(|b| format!("{b:02X}")).collect::<String>();
    let broadcast = net::directed_broadcast(address)
        .map(|b| b.to_string())
        .unwrap_or_else(|| "255.255.255.255".to_string());

    let template = cfg
        .command
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .unwrap_or(DEFAULT_RELAY_CMD);
    let command = template
        .replace("{mac}", &colon)
        .replace("{macraw}", &raw)
        .replace("{broadcast}", &broadcast);

    let mut cmd = ssh::ssh_command(cfg.address.trim(), cfg.username.trim(), cfg.port);
    cmd.arg(&command);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return fail(format!("Could not run SSH: {e}")),
    };
    let mut stderr = child.stderr.take();

    let waited = tokio::time::timeout(Duration::from_secs(15), child.wait()).await;
    let mut err_text = String::new();
    if let Some(mut e) = stderr.take() {
        let _ = tokio::time::timeout(Duration::from_secs(3), e.read_to_string(&mut err_text)).await;
    }
    let low = err_text.to_ascii_lowercase();

    match waited {
        Ok(Ok(status)) if status.success() => WakeAttempt {
            method: "relay".into(),
            ok: true,
            detail: format!("The relay {} sent the wake signal", cfg.address.trim()),
        },
        Ok(Ok(_)) if low.contains("permission denied") || low.contains("publickey") => {
            fail("The relay refused the SSH login (set up key-based login)".into())
        }
        Ok(Ok(_)) => fail("The relay could not send the wake signal".into()),
        Ok(Err(e)) => fail(format!("SSH to the relay failed: {e}")),
        Err(_) => fail("The relay did not answer in time".into()),
    }
}

// ---- Why the wake didn't work ---------------------------------------------

/// One diagnosed condition on the host, phrased for someone who just wants
/// their PC to turn on.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WakeCheck {
    pub ok: bool,
    /// Purely informational rather than pass/fail (e.g. "this is Wi-Fi").
    pub warn: bool,
    pub label: String,
    pub detail: String,
    /// What to actually do about it, when there is something.
    pub fix: Option<String>,
}

/// Asks Windows the three things that decide whether a magic packet works,
/// none of which are visible from this side of the network.
const DIAG_PS: &str = r#"
$ErrorActionPreference='SilentlyContinue'
$hb = (Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Name HiberbootEnabled).HiberbootEnabled
if ($hb -eq $null) { Write-Output 'DC-FASTSTARTUP unknown' }
elseif ($hb -eq 1) { Write-Output 'DC-FASTSTARTUP on' }
else { Write-Output 'DC-FASTSTARTUP off' }
foreach ($a in (Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' })) {
  $pm = Get-NetAdapterPowerManagement -Name $a.Name
  if ($pm.WakeOnMagicPacket -eq 'Enabled') { $w = 'yes' }
  elseif ($pm.WakeOnMagicPacket -eq 'Disabled') { $w = 'no' }
  else { $w = 'unknown' }
  if ($a.PhysicalMediaType -match 'Wireless|802.11') { $m = 'wifi' } else { $m = 'wired' }
  Write-Output ('DC-ADAPTER ' + $a.Name + '|' + $m + '|' + $w + '|' + $a.MacAddress)
}
$armed = @(powercfg /devicequery wake_armed 2>$null)
Write-Output ('DC-ARMED ' + ($armed -join '; '))
"#;

/// Find out why a magic packet isn't waking this PC.
///
/// Wake-on-LAN failing is almost never a network problem — it is one of three
/// Windows settings that can't be seen from the client: Fast Startup leaving
/// the NIC powered down after shutdown, the adapter not being allowed to wake
/// the machine, or the saved MAC belonging to an adapter that isn't the one
/// in use. This checks all of them and says what to change.
pub async fn diagnose(
    address: &str,
    ssh: &crate::settings::SshConfig,
    windows_user: &str,
    macs: &[String],
) -> Result<Vec<WakeCheck>, String> {
    let raw = ssh::run_powershell(address, ssh, DIAG_PS, windows_user, Duration::from_secs(30)).await?;
    let mut checks = Vec::new();
    let mut adapters: Vec<(String, String, String, String)> = Vec::new();

    for line in raw.lines().map(str::trim) {
        if let Some(v) = line.strip_prefix("DC-FASTSTARTUP ") {
            checks.push(match v.trim() {
                "on" => WakeCheck {
                    ok: false,
                    warn: false,
                    label: "Fast Startup is on".into(),
                    detail: "With Fast Startup, Windows powers down the network adapter when you shut down the PC, so the wake signal never gets through.".into(),
                    fix: Some("Control Panel → Power Options → \"Choose what the power buttons do\" → \"Change settings that are currently unavailable\" → untick \"Turn on fast startup\".".into()),
                },
                "off" => WakeCheck {
                    ok: true,
                    warn: false,
                    label: "Fast Startup is off".into(),
                    detail: "Good — the network adapter stays awake enough to listen for the wake signal.".into(),
                    fix: None,
                },
                _ => WakeCheck {
                    ok: true,
                    warn: true,
                    label: "Could not read the Fast Startup setting".into(),
                    detail: "Could not tell whether Fast Startup is on. Check it manually if waking doesn't work.".into(),
                    fix: None,
                },
            });
        } else if let Some(v) = line.strip_prefix("DC-ADAPTER ") {
            let parts: Vec<&str> = v.split('|').collect();
            if parts.len() == 4 {
                adapters.push((
                    parts[0].to_string(),
                    parts[1].to_string(),
                    parts[2].to_string(),
                    parts[3].to_string(),
                ));
            }
        } else if let Some(v) = line.strip_prefix("DC-ARMED ") {
            let armed = v.trim();
            let none = armed.is_empty() || armed.eq_ignore_ascii_case("NONE");
            checks.push(WakeCheck {
                ok: !none,
                warn: false,
                label: if none {
                    "Nothing is allowed to wake the PC".into()
                } else {
                    "The network adapter is allowed to wake the PC".into()
                },
                detail: if none {
                    "Windows reports that no devices are allowed to wake the machine.".into()
                } else {
                    format!("Windows reports: {armed}")
                },
                fix: none.then(|| "Device Manager → the network adapter → Properties → Power Management → tick \"Allow this device to wake the computer\".".to_string()),
            });
        }
    }

    if adapters.is_empty() {
        checks.push(WakeCheck {
            ok: true,
            warn: true,
            label: "Found no active network adapters".into(),
            detail: "Could not read the network adapters. The command may require administrator rights.".into(),
            fix: None,
        });
    }

    for (name, media, wake_ok, mac) in &adapters {
        match wake_ok.as_str() {
            "no" => checks.push(WakeCheck {
                ok: false,
                warn: false,
                label: format!("\"{name}\" does not respond to wake signals"),
                detail: "The adapter is in use, but is not set up to wake on a magic packet.".into(),
                fix: Some("Device Manager → this network adapter → Properties → Advanced → set \"Wake on Magic Packet\" to Enabled.".into()),
            }),
            "yes" => checks.push(WakeCheck {
                ok: true,
                warn: false,
                label: format!("\"{name}\" responds to wake signals"),
                detail: format!("MAC address {mac}."),
                fix: None,
            }),
            _ => {}
        }

        // The saved MAC has to belong to the adapter that is actually up —
        // packets aimed at the other one are simply never heard.
        let known = macs.iter().any(|m| net::macs_equal(m, mac));
        if !known {
            checks.push(WakeCheck {
                ok: false,
                warn: false,
                label: format!("The MAC address of \"{name}\" is not saved"),
                detail: format!("This adapter is in use right now, but {mac} is not in your list — the wake signal is being sent somewhere else."),
                fix: Some(format!("Add {mac} under MAC addresses in Wake.")),
            });
        }

        if media == "wifi" {
            checks.push(WakeCheck {
                ok: true,
                warn: true,
                label: format!("\"{name}\" is Wi-Fi"),
                detail: "Wake over Wi-Fi exists, but many adapters don't support it, and it rarely works from a fully powered-off state. A wired connection is much more reliable.".into(),
                fix: None,
            });
        }
    }

    Ok(checks)
}
