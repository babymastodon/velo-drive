// hrm-spike — the first Linux BLE spike for the VeloDrive native port.
//
// Proves the risky part end-to-end with NO Tauri/UI involved: btleplug talks to
// BlueZ, finds a heart-rate monitor, connects, subscribes to notifications, and
// streams live BPM. If this works against real hardware, the trainer (FTMS) path
// is the same shape plus a control-point write.
//
//   cargo run --bin hrm-spike                 # scan 8s, auto-find by HR service
//   cargo run --bin hrm-spike 15              # scan 15s
//   cargo run --bin hrm-spike "Polar H10"     # target by name substring
//   cargo run --bin hrm-spike AA:BB:CC:DD:EE:FF   # target by address
//
// The name/address form connects and discovers services directly, so it works
// even for straps that don't advertise the HR service UUID until connected.
//
// HR-frame parsing mirrors the app's WebBluetoothTransport (HR Measurement
// 0x2A37: flags byte selects 8- vs 16-bit BPM).

use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use btleplug::api::{Central, Manager as _, Peripheral as _, ScanFilter};
use btleplug::platform::{Manager, Peripheral};
use futures::StreamExt;
use uuid::Uuid;

// 16-bit BLE UUIDs expanded against the Bluetooth base UUID.
const HR_SERVICE: Uuid = Uuid::from_u128(0x0000_180d_0000_1000_8000_0080_5f9b_34fb);
const HR_MEASUREMENT: Uuid = Uuid::from_u128(0x0000_2a37_0000_1000_8000_0080_5f9b_34fb);

struct Row {
    p: Peripheral,
    name: String,
    addr: String,
    rssi: Option<i16>,
    has_hr: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    // First arg is either a scan-duration (number) or a name/address to target.
    let (scan_secs, target): (u64, Option<String>) = match std::env::args().nth(1) {
        None => (8, None),
        Some(a) => match a.parse::<u64>() {
            Ok(n) => (n, None),
            Err(_) => (8, Some(a.to_lowercase())),
        },
    };

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

    match &target {
        Some(t) => println!("[spike] scanning {scan_secs}s, looking for a device matching '{t}'…"),
        None => println!("[spike] scanning {scan_secs}s for a heart-rate monitor (service 0x180D)…"),
    }
    central
        .start_scan(ScanFilter::default())
        .await
        .context("start_scan (BlueZ permission?)")?;
    tokio::time::sleep(Duration::from_secs(scan_secs)).await;
    let peripherals = central.peripherals().await?;
    let _ = central.stop_scan().await;
    if peripherals.is_empty() {
        return Err(anyhow!(
            "no BLE devices seen at all — is the HRM on and broadcasting?"
        ));
    }

    let mut rows: Vec<Row> = Vec::new();
    for p in &peripherals {
        // Devices come and go mid-scan; a flaky/vanished one must not abort the run.
        let props = match p.properties().await {
            Ok(Some(props)) => props,
            _ => continue,
        };
        rows.push(Row {
            p: p.clone(),
            name: props.local_name.unwrap_or_default(),
            addr: props.address.to_string(),
            rssi: props.rssi,
            has_hr: props.services.contains(&HR_SERVICE),
        });
    }
    rows.sort_by(|a, b| b.rssi.unwrap_or(i16::MIN).cmp(&a.rssi.unwrap_or(i16::MIN)));
    println!("[spike] {} device(s) seen.", rows.len());

    let chosen = match &target {
        Some(t) => rows.iter().find(|r| {
            r.addr.to_lowercase() == *t || (!r.name.is_empty() && r.name.to_lowercase().contains(t))
        }),
        None => rows.iter().find(|r| r.has_hr),
    };

    let Some(chosen) = chosen else {
        println!("[spike] no match. Strongest nearby devices (re-run: hrm-spike <address|name>):");
        for r in rows.iter().take(15) {
            let label = if r.name.is_empty() { "(unknown)" } else { &r.name };
            println!(
                "  {:>5} dBm  {}  {:<26} hr_advertised={}",
                r.rssi.map(|v| v.to_string()).unwrap_or_else(|| "?".into()),
                r.addr,
                label,
                r.has_hr
            );
        }
        return Err(anyhow!(
            "no device advertised the Heart Rate service. If your strap is in the list \
             above (likely the strongest unnamed one), re-run `hrm-spike <address>` to \
             connect and check its services directly — some straps don't advertise \
             0x180D until connected. Also make sure it isn't connected to a phone/watch/app."
        ));
    };

    let label = if chosen.name.is_empty() {
        chosen.addr.clone()
    } else {
        chosen.name.clone()
    };
    println!("[spike] connecting to '{label}' ({})…", chosen.addr);
    connect_with_retry(&chosen.p).await?;
    chosen
        .p
        .discover_services()
        .await
        .context("discover_services")?;

    let chr = chosen
        .p
        .characteristics()
        .into_iter()
        .find(|c| c.uuid == HR_MEASUREMENT)
        .ok_or_else(|| {
            anyhow!("connected, but no HR Measurement characteristic (0x2A37) — not an HRM?")
        })?;
    chosen.p.subscribe(&chr).await.context("subscribe")?;
    println!("[spike] connected + subscribed. Streaming BPM (Ctrl-C to stop)…\n");

    let mut notifs = chosen.p.notifications().await?;
    loop {
        tokio::select! {
            maybe = notifs.next() => match maybe {
                Some(data) if data.uuid == HR_MEASUREMENT => match parse_hr(&data.value) {
                    Some(bpm) => println!("  \u{2665} {bpm} bpm"),
                    None => println!("  (unparseable HR frame: {:02x?})", data.value),
                },
                Some(_) => {}
                None => {
                    println!("[spike] notification stream ended (device disconnected).");
                    break;
                }
            },
            _ = tokio::signal::ctrl_c() => {
                println!("\n[spike] disconnecting…");
                let _ = chosen.p.unsubscribe(&chr).await;
                let _ = chosen.p.disconnect().await;
                break;
            }
        }
    }
    Ok(())
}

/// BLE connects are flaky (BlueZ "service discovery timed out" on a stale cache is
/// common right after a prior session) — retry a few times.
async fn connect_with_retry(p: &Peripheral) -> Result<()> {
    let mut last = None;
    for attempt in 1..=3 {
        match p.connect().await {
            Ok(()) => return Ok(()),
            Err(e) => {
                eprintln!("[spike] connect attempt {attempt}/3 failed: {e}; retrying…");
                last = Some(e);
                tokio::time::sleep(Duration::from_millis(800)).await;
            }
        }
    }
    Err(anyhow!(last.unwrap())).context("connect (after 3 retries)")
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
