// hrm-spike — the first Linux BLE spike for the VeloDrive native port.
//
// Proves the risky part end-to-end with NO Tauri/UI involved: btleplug talks to
// BlueZ, finds a heart-rate monitor, connects, subscribes to notifications, and
// streams live BPM. If this works against real hardware, the trainer (FTMS) path
// is the same shape plus a control-point write.
//
//   cargo run --bin hrm-spike [scan_seconds]   (default 8s)
//
// Mirrors the app's existing BLE constants/parsing (Heart Rate service 0x180D,
// HR Measurement 0x2A37; flags-byte selects 8- vs 16-bit BPM).

use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use btleplug::api::{Central, Manager as _, Peripheral as _, ScanFilter};
use btleplug::platform::{Manager, Peripheral};
use futures::StreamExt;
use uuid::Uuid;

// 16-bit BLE UUIDs expanded against the Bluetooth base UUID.
const HR_SERVICE: Uuid = Uuid::from_u128(0x0000_180d_0000_1000_8000_0080_5f9b_34fb);
const HR_MEASUREMENT: Uuid = Uuid::from_u128(0x0000_2a37_0000_1000_8000_0080_5f9b_34fb);

#[tokio::main]
async fn main() -> Result<()> {
    let scan_secs: u64 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(8);

    let manager = Manager::new()
        .await
        .context("creating BLE manager (is bluetoothd running?)")?;
    let central = manager
        .adapters()
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| anyhow!("no Bluetooth adapter found"))?;
    println!(
        "[spike] adapter: {}",
        central.adapter_info().await.unwrap_or_default()
    );

    println!("[spike] scanning {scan_secs}s for a heart-rate monitor (service 0x180D)…");
    central
        .start_scan(ScanFilter::default())
        .await
        .context("start_scan (BlueZ permission?)")?;
    tokio::time::sleep(Duration::from_secs(scan_secs)).await;

    let peripherals = central.peripherals().await?;
    if peripherals.is_empty() {
        return Err(anyhow!(
            "no BLE devices seen at all — is the HRM on and broadcasting?"
        ));
    }

    println!("[spike] discovered {} device(s):", peripherals.len());
    let mut hrm: Option<Peripheral> = None;
    for p in &peripherals {
        let Some(props) = p.properties().await? else {
            continue;
        };
        let name = props.local_name.unwrap_or_else(|| "(unknown)".into());
        let has_hr = props.services.contains(&HR_SERVICE);
        println!(
            "  - {name:<28} rssi={:>4?}  heart-rate-service={}",
            props.rssi, has_hr
        );
        if has_hr && hrm.is_none() {
            hrm = Some(p.clone());
        }
    }
    let _ = central.stop_scan().await;

    let hrm = hrm.ok_or_else(|| {
        anyhow!(
            "no device advertised the Heart Rate service (0x180D). Make sure the \
             strap is worn / electrodes damp, and not already connected to a phone/app."
        )
    })?;

    let name = hrm
        .properties()
        .await?
        .and_then(|p| p.local_name)
        .unwrap_or_else(|| "(unknown)".into());
    println!("[spike] connecting to '{name}'…");
    hrm.connect().await.context("connect")?;
    hrm.discover_services().await.context("discover_services")?;

    let chr = hrm
        .characteristics()
        .into_iter()
        .find(|c| c.uuid == HR_MEASUREMENT)
        .ok_or_else(|| anyhow!("HR Measurement characteristic (0x2A37) not found"))?;
    hrm.subscribe(&chr).await.context("subscribe")?;
    println!("[spike] connected + subscribed. Streaming BPM (Ctrl-C to stop)…\n");

    let mut notifs = hrm.notifications().await?;
    loop {
        tokio::select! {
            maybe = notifs.next() => match maybe {
                Some(data) if data.uuid == HR_MEASUREMENT => {
                    match parse_hr(&data.value) {
                        Some(bpm) => println!("  \u{2665} {bpm} bpm"),
                        None => println!("  (unparseable HR frame: {:02x?})", data.value),
                    }
                }
                Some(_) => {}
                None => {
                    println!("[spike] notification stream ended (device disconnected).");
                    break;
                }
            },
            _ = tokio::signal::ctrl_c() => {
                println!("\n[spike] disconnecting…");
                let _ = hrm.unsubscribe(&chr).await;
                let _ = hrm.disconnect().await;
                break;
            }
        }
    }
    Ok(())
}

/// Parse a BLE Heart Rate Measurement value (0x2A37). Byte 0 is a flags field;
/// bit 0 selects an 8-bit (0) or 16-bit (1) BPM that follows. Returns the BPM.
fn parse_hr(v: &[u8]) -> Option<u16> {
    let flags = *v.first()?;
    if flags & 0x01 == 0 {
        v.get(1).map(|b| *b as u16)
    } else {
        let lo = *v.get(1)? as u16;
        let hi = *v.get(2)? as u16;
        Some(lo | (hi << 8))
    }
}
