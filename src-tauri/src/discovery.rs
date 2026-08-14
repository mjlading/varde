//! LAN discovery of GameStream hosts (Apollo / Sunshine) via mDNS.
//! Browses `_nvstream._tcp.local.` for a fixed window and returns what it finds.

use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::Serialize;
use std::collections::BTreeMap;
use std::time::{Duration, Instant};

const SERVICE_TYPE: &str = "_nvstream._tcp.local.";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredHost {
    /// Human-friendly instance name advertised by the host.
    pub name: String,
    pub address: String,
    pub hostname: String,
    pub port: u16,
}

/// Browse the LAN for GameStream hosts for `timeout`. Blocking — call from a
/// blocking task. Results are de-duplicated by IP address.
pub fn discover(timeout: Duration) -> Result<Vec<DiscoveredHost>, String> {
    let daemon = ServiceDaemon::new().map_err(|e| format!("mDNS is not available: {e}"))?;
    let receiver = daemon
        .browse(SERVICE_TYPE)
        .map_err(|e| format!("Could not start the mDNS scan: {e}"))?;

    let mut found: BTreeMap<String, DiscoveredHost> = BTreeMap::new();
    let deadline = Instant::now() + timeout;

    while let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
        match receiver.recv_timeout(remaining) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                let addr = info
                    .get_addresses()
                    .iter()
                    .find(|a| a.is_ipv4())
                    .or_else(|| info.get_addresses().iter().next())
                    .map(|a| a.to_string());

                if let Some(address) = addr {
                    let hostname = info.get_hostname().trim_end_matches('.').to_string();
                    let name = instance_name(info.get_fullname()).unwrap_or_else(|| {
                        hostname
                            .trim_end_matches(".local")
                            .to_string()
                    });
                    found.entry(address.clone()).or_insert(DiscoveredHost {
                        name,
                        address,
                        hostname,
                        port: info.get_port(),
                    });
                }
            }
            Ok(_) => {}
            Err(_) => break, // timed out
        }
    }

    let _ = daemon.shutdown();
    Ok(found.into_values().collect())
}

/// Extract the instance label from a full mDNS name like
/// `My PC._nvstream._tcp.local.`.
fn instance_name(fullname: &str) -> Option<String> {
    let idx = fullname.find("._nvstream")?;
    let raw = &fullname[..idx];
    if raw.is_empty() {
        None
    } else {
        Some(raw.replace("\\032", " "))
    }
}
