//! Networking primitives: Wake-on-LAN, TCP port probing, host status, and
//! ARP-based MAC discovery. No external network dependencies — raw sockets and
//! the OS ARP table only.

use serde::Serialize;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, ToSocketAddrs, UdpSocket};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// GameStream / Sunshine / Apollo HTTP port (stream service).
pub const PORT_STREAM: u16 = 47989;
/// Sunshine / Apollo web UI (HTTPS) — where the pairing PIN is entered.
pub const PORT_WEB: u16 = 47990;
/// Windows Remote Desktop.
pub const PORT_RDP: u16 = 3389;

/// Parse a MAC address in any common form (`AA:BB:CC:DD:EE:FF`, `aa-bb-…`,
/// or 12 bare hex chars) into 6 bytes.
pub fn parse_mac(mac: &str) -> Result<[u8; 6], String> {
    let cleaned: String = mac
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .collect();
    if cleaned.len() != 12 {
        return Err(format!("\"{mac}\" is not a valid MAC address"));
    }
    let mut bytes = [0u8; 6];
    for i in 0..6 {
        bytes[i] = u8::from_str_radix(&cleaned[i * 2..i * 2 + 2], 16)
            .map_err(|_| format!("\"{mac}\" is not a valid MAC address"))?;
    }
    Ok(bytes)
}

/// The subnet-directed broadcast for a host address (assuming a /24, which is
/// the home-LAN case). `None` for hostnames, IPv6, and loopback.
pub fn directed_broadcast(address: &str) -> Option<Ipv4Addr> {
    let ip: Ipv4Addr = address.parse().ok()?;
    if ip.is_loopback() {
        return None;
    }
    let o = ip.octets();
    Some(Ipv4Addr::new(o[0], o[1], o[2], 255))
}

/// Compare two MAC addresses regardless of formatting (case, separators).
pub fn macs_equal(a: &str, b: &str) -> bool {
    matches!((parse_mac(a), parse_mac(b)), (Ok(x), Ok(y)) if x == y)
}

/// Build a 102-byte Wake-on-LAN magic packet for the given MAC.
fn magic_packet(mac: &[u8; 6]) -> [u8; 102] {
    let mut packet = [0u8; 102];
    for b in packet.iter_mut().take(6) {
        *b = 0xFF;
    }
    for chunk in 1..=16 {
        packet[chunk * 6..chunk * 6 + 6].copy_from_slice(mac);
    }
    packet
}

/// Send a magic packet for every provided MAC to the broadcast address.
/// Sends to ports 9 and 7 (the two conventional WoL ports) for good measure.
///
/// `address_hint` is the host's known IP: when it's IPv4, packets also go to
/// the subnet-directed broadcast (e.g. 192.168.1.255, assuming /24 — the home
/// LAN case). The limited broadcast alone can leave through the wrong
/// interface when a VPN is up or the laptop is docked with two NICs; the
/// directed one is routed toward the host's actual subnet. Best-effort.
pub fn send_wol(macs: &[String], address_hint: Option<&str>) -> Result<(), String> {
    if macs.is_empty() {
        return Err("No MAC addresses are saved for this PC".to_string());
    }
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .map_err(|e| format!("Could not open a UDP socket: {e}"))?;
    socket
        .set_broadcast(true)
        .map_err(|e| format!("Could not enable broadcast: {e}"))?;

    let directed: Option<Ipv4Addr> = address_hint.and_then(directed_broadcast);

    // Every send is best-effort: with a VPN kill-switch up, the limited
    // broadcast can be rejected while the subnet-directed one is allowed
    // through (or the other way around). Fail only if not a single packet
    // could be sent.
    let mut sent = 0usize;
    let mut last_err: Option<std::io::Error> = None;
    for mac in macs {
        let parsed = parse_mac(mac)?;
        let packet = magic_packet(&parsed);
        for port in [9u16, 7u16] {
            match socket.send_to(&packet, SocketAddr::from((Ipv4Addr::BROADCAST, port))) {
                Ok(_) => sent += 1,
                Err(e) => last_err = Some(e),
            }
            if let Some(b) = directed {
                match socket.send_to(&packet, SocketAddr::from((b, port))) {
                    Ok(_) => sent += 1,
                    Err(e) => last_err = Some(e),
                }
            }
        }
    }
    if sent == 0 {
        return Err(match last_err {
            Some(e) => format!("Could not send the wake signal: {e}"),
            None => "No valid MAC addresses to wake".to_string(),
        });
    }
    Ok(())
}

/// Attempt a TCP connection with a timeout. Returns true if the port accepts.
pub async fn is_port_open(host: &str, port: u16, timeout: Duration) -> bool {
    let addr = format!("{host}:{port}");
    matches!(
        tokio::time::timeout(timeout, TcpStream::connect(addr.as_str())).await,
        Ok(Ok(_))
    )
}

/// Poll a port until it accepts connections or the overall timeout elapses.
pub async fn wait_for_port(host: &str, port: u16, timeout: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if is_port_open(host, port, Duration::from_millis(1200)).await {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(700)).await;
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostStatus {
    pub reachable: bool,
    pub stream_open: bool,
    pub rdp_open: bool,
    pub web_open: bool,
    pub in_use: bool,
    pub paired: Option<bool>,
    /// Derived label: "offline" | "online" | "in_use".
    /// ("waking" is a transient state the UI manages during an active wake.)
    pub state: String,
}

/// Probe a host's ports and (best-effort) its GameStream server state.
pub async fn host_status(host: &str) -> HostStatus {
    let t = Duration::from_millis(1200);
    let (stream_open, rdp_open, web_open) = tokio::join!(
        is_port_open(host, PORT_STREAM, t),
        is_port_open(host, PORT_RDP, t),
        is_port_open(host, PORT_WEB, t),
    );

    let mut in_use = false;
    let mut paired = None;
    if stream_open {
        if let Some(info) = server_info(host).await {
            in_use = info.busy;
            paired = Some(info.paired);
        }
    }

    let reachable = stream_open || rdp_open || web_open;
    let state = if stream_open && in_use {
        "in_use"
    } else if reachable {
        "online"
    } else {
        "offline"
    }
    .to_string();

    HostStatus {
        reachable,
        stream_open,
        rdp_open,
        web_open,
        in_use,
        paired,
        state,
    }
}

pub struct ServerInfo {
    pub busy: bool,
    pub paired: bool,
}

/// Fetch `/serverinfo` over plain HTTP on the stream port and parse the few
/// fields we care about. Hand-rolled to avoid an HTTP/TLS dependency.
pub async fn server_info(host: &str) -> Option<ServerInfo> {
    let addr = format!("{host}:{PORT_STREAM}");
    let connect = tokio::time::timeout(Duration::from_millis(1500), TcpStream::connect(addr.as_str()));
    let mut stream = connect.await.ok()?.ok()?;

    let request = format!(
        "GET /serverinfo HTTP/1.0\r\nHost: {host}\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).await.ok()?;

    let mut body = Vec::new();
    let read = tokio::time::timeout(
        Duration::from_millis(1500),
        stream.read_to_end(&mut body),
    );
    read.await.ok()?.ok()?;
    let text = String::from_utf8_lossy(&body);

    let busy = extract_tag(&text, "state")
        .map(|s| s.to_ascii_uppercase().contains("BUSY"))
        .unwrap_or(false)
        || extract_tag(&text, "currentgame")
            .map(|g| g.trim() != "0" && !g.trim().is_empty())
            .unwrap_or(false);
    let paired = extract_tag(&text, "PairStatus")
        .map(|p| p.trim() == "1")
        .unwrap_or(false);

    Some(ServerInfo { busy, paired })
}

fn extract_tag<'a>(xml: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    Some(&xml[start..end])
}

/// Resolve a host's MAC address by pinging it (to populate the ARP cache),
/// then reading the OS ARP table. Returns `None` if it can't be determined.
pub async fn resolve_mac(host: &str) -> Option<String> {
    // A ping primes the ARP cache. ICMP may be firewalled, so we ignore the
    // result — a TCP touch to the stream port also refreshes the neighbor entry.
    let _ = ping_once(host).await;
    let _ = is_port_open(host, PORT_STREAM, Duration::from_millis(600)).await;

    let ip = resolve_ip(host)?;
    read_arp_table(&ip)
}

async fn ping_once(host: &str) -> bool {
    #[cfg(target_os = "windows")]
    let args: Vec<String> = vec!["-n".into(), "1".into(), "-w".into(), "1000".into(), host.into()];
    #[cfg(not(target_os = "windows"))]
    let args: Vec<String> = vec!["-c".into(), "1".into(), "-W".into(), "1".into(), host.into()];

    tokio::process::Command::new("ping")
        .args(&args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Resolve a hostname/IP string to a concrete IP string.
pub fn resolve_ip(host: &str) -> Option<String> {
    if host.parse::<IpAddr>().is_ok() {
        return Some(host.to_string());
    }
    (host, 0u16)
        .to_socket_addrs()
        .ok()?
        .next()
        .map(|s| s.ip().to_string())
}

#[cfg(not(target_os = "windows"))]
fn read_arp_table(ip: &str) -> Option<String> {
    // /proc/net/arp columns: IPaddress HWtype Flags HWaddress Mask Device
    let contents = std::fs::read_to_string("/proc/net/arp").ok()?;
    for line in contents.lines().skip(1) {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() >= 4 && cols[0] == ip {
            let mac = cols[3];
            if mac != "00:00:00:00:00:00" {
                return Some(mac.to_ascii_uppercase());
            }
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn read_arp_table(ip: &str) -> Option<String> {
    use std::process::Command;
    let out = Command::new("arp").arg("-a").arg(ip).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let re = regex::Regex::new(r"([0-9A-Fa-f]{2}(?:[-:][0-9A-Fa-f]{2}){5})").ok()?;
    for line in text.lines() {
        if line.contains(ip) {
            if let Some(m) = re.find(line) {
                let mac = m.as_str().replace('-', ":").to_ascii_uppercase();
                if mac != "00:00:00:00:00:00" {
                    return Some(mac);
                }
            }
        }
    }
    None
}

/// Which GameStream host software this is — Sunshine, Apollo, or something
/// else speaking the same protocol. Purely cosmetic: it decides what the UI
/// calls the thing, and every caller has a neutral fallback, so a `None` here
/// costs nothing but a slightly vaguer sentence.
///
/// Read from the host's own web UI rather than `/serverinfo`, which the forks
/// deliberately keep identical so that Moonlight clients can't tell them apart.
pub async fn server_flavour(host: &str) -> Option<String> {
    let client = reqwest::Client::builder()
        // Self-signed by design — these are LAN services with generated certs.
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(4))
        .build()
        .ok()?;
    let body = client
        .get(format!("https://{host}:{PORT_WEB}/"))
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;
    let low = body.to_ascii_lowercase();
    // Apollo is a Sunshine fork and still carries upstream's name in places,
    // so it has to be tested first or every Apollo host reads as Sunshine.
    if low.contains("apollo") {
        Some("Apollo".to_string())
    } else if low.contains("sunshine") {
        Some("Sunshine".to_string())
    } else {
        None
    }
}
