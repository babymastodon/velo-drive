// ftms-spike — the trainer half of the Linux BLE bring-up.
//
// Connects an FTMS smart trainer, subscribes to Indoor Bike Data (power/cadence/
// speed), and — if you ask for a wattage — takes control and sets ERG target
// power via the Fitness Machine Control Point. This exercises the one thing the
// HRM spike didn't: a GATT *write*. Same btleplug/BlueZ path otherwise.
//
//   cargo run --bin ftms-spike                 # read-only: stream bike data (safe)
//   cargo run --bin ftms-spike 15              # scan 15s, read-only
//   cargo run --bin ftms-spike "KICKR"         # target by name substring
//   cargo run --bin ftms-spike "KICKR" 120     # ERG: hold 120 W (requestControl
//                                              #   + startOrResume + setTargetPower)
//
// Field/opcode handling mirrors the web app's WebBluetoothTransport.

use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use btleplug::api::{Central, Manager as _, Peripheral as _, ScanFilter, WriteType};
use btleplug::platform::{Manager, Peripheral};
use futures::StreamExt;
use uuid::Uuid;

const FTMS_SERVICE: Uuid = Uuid::from_u128(0x0000_1826_0000_1000_8000_0080_5f9b_34fb);
const INDOOR_BIKE_DATA: Uuid = Uuid::from_u128(0x0000_2ad2_0000_1000_8000_0080_5f9b_34fb);
const CONTROL_POINT: Uuid = Uuid::from_u128(0x0000_2ad9_0000_1000_8000_0080_5f9b_34fb);

// FTMS Control Point opcodes.
const OP_REQUEST_CONTROL: u8 = 0x00;
const OP_SET_TARGET_POWER: u8 = 0x05;
const OP_START_OR_RESUME: u8 = 0x07;

struct Row {
    p: Peripheral,
    name: String,
    addr: String,
    rssi: Option<i16>,
    has_ftms: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (scan_secs, target): (u64, Option<String>) = match args.first() {
        None => (8, None),
        Some(a) => match a.parse::<u64>() {
            Ok(n) => (n, None),
            Err(_) => (8, Some(a.to_lowercase())),
        },
    };
    let target_watts: Option<i16> = args.get(1).and_then(|s| s.parse().ok());

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
        None => println!("[spike] scanning {scan_secs}s for an FTMS trainer (service 0x1826)…"),
    }
    central
        .start_scan(ScanFilter::default())
        .await
        .context("start_scan (BlueZ permission?)")?;
    tokio::time::sleep(Duration::from_secs(scan_secs)).await;
    let peripherals = central.peripherals().await?;
    let _ = central.stop_scan().await;
    if peripherals.is_empty() {
        return Err(anyhow!("no BLE devices seen — is the trainer on and awake?"));
    }

    let mut rows: Vec<Row> = Vec::new();
    for p in &peripherals {
        let props = match p.properties().await {
            Ok(Some(props)) => props,
            _ => continue,
        };
        rows.push(Row {
            p: p.clone(),
            name: props.local_name.unwrap_or_default(),
            addr: props.address.to_string(),
            rssi: props.rssi,
            has_ftms: props.services.contains(&FTMS_SERVICE),
        });
    }
    rows.sort_by(|a, b| b.rssi.unwrap_or(i16::MIN).cmp(&a.rssi.unwrap_or(i16::MIN)));
    println!("[spike] {} device(s) seen.", rows.len());

    let chosen = match &target {
        Some(t) => rows.iter().find(|r| {
            r.addr.to_lowercase() == *t || (!r.name.is_empty() && r.name.to_lowercase().contains(t))
        }),
        None => rows.iter().find(|r| r.has_ftms),
    };

    let Some(chosen) = chosen else {
        println!("[spike] no match. Strongest nearby devices (re-run: ftms-spike <address|name>):");
        for r in rows.iter().take(15) {
            let label = if r.name.is_empty() { "(unknown)" } else { &r.name };
            println!(
                "  {:>5} dBm  {}  {:<26} ftms_advertised={}",
                r.rssi.map(|v| v.to_string()).unwrap_or_else(|| "?".into()),
                r.addr,
                label,
                r.has_ftms
            );
        }
        return Err(anyhow!(
            "no device advertised the FTMS service. If your trainer is above, re-run \
             `ftms-spike <address>` to connect and check directly. Make sure it's awake \
             (pedal a turn) and not already connected to another app."
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

    let chars = chosen.p.characteristics();
    let idb = chars
        .iter()
        .find(|c| c.uuid == INDOOR_BIKE_DATA)
        .cloned()
        .ok_or_else(|| anyhow!("no Indoor Bike Data characteristic (0x2AD2) — not an FTMS trainer?"))?;
    let cp = chars.iter().find(|c| c.uuid == CONTROL_POINT).cloned();

    chosen.p.subscribe(&idb).await.context("subscribe idb")?;

    if let Some(watts) = target_watts {
        let cp = cp.ok_or_else(|| anyhow!("trainer has no Control Point (0x2AD9); can't set ERG"))?;
        println!("[spike] taking control + setting ERG target {watts} W…");
        cp_write(&chosen.p, &cp, &[OP_REQUEST_CONTROL]).await?;
        cp_write(&chosen.p, &cp, &[OP_START_OR_RESUME]).await?;
        let [lo, hi] = watts.to_le_bytes();
        cp_write(&chosen.p, &cp, &[OP_SET_TARGET_POWER, lo, hi]).await?;
        println!("[spike] ERG set — pedal and watch power track {watts} W.");
    } else {
        println!("[spike] read-only (pass a wattage as the 2nd arg to test ERG control).");
    }
    println!("[spike] streaming Indoor Bike Data (Ctrl-C to stop)…\n");

    let mut notifs = chosen.p.notifications().await?;
    loop {
        tokio::select! {
            maybe = notifs.next() => match maybe {
                Some(data) if data.uuid == INDOOR_BIKE_DATA => {
                    let b = parse_bike(&data.value);
                    println!(
                        "  power={:>4}  cadence={:>5}  speed={:>5}  hr={}",
                        b.power_w.map(|v| v.to_string()).unwrap_or_else(|| "—".into()),
                        b.cadence_rpm.map(|v| format!("{v:.0}")).unwrap_or_else(|| "—".into()),
                        b.speed_kph.map(|v| format!("{v:.1}")).unwrap_or_else(|| "—".into()),
                        b.hr.map(|v| v.to_string()).unwrap_or_else(|| "—".into()),
                    );
                }
                Some(_) => {}
                None => {
                    println!("[spike] notification stream ended (device disconnected).");
                    break;
                }
            },
            _ = tokio::signal::ctrl_c() => {
                println!("\n[spike] disconnecting…");
                let _ = chosen.p.unsubscribe(&idb).await;
                let _ = chosen.p.disconnect().await;
                break;
            }
        }
    }
    Ok(())
}

/// BLE connects are flaky (BlueZ "service discovery timed out" on a stale cache is
/// common right after a prior session) — retry a few times. The production
/// NativeTrainerTransport will do the same with backoff.
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

async fn cp_write(p: &Peripheral, cp: &btleplug::api::Characteristic, bytes: &[u8]) -> Result<()> {
    p.write(cp, bytes, WriteType::WithResponse)
        .await
        .with_context(|| format!("control-point write {bytes:02x?}"))
}

#[derive(Default)]
struct BikeData {
    speed_kph: Option<f32>,
    cadence_rpm: Option<f32>,
    power_w: Option<i32>,
    hr: Option<u8>,
}

/// Parse an FTMS Indoor Bike Data frame (0x2AD2). u16-LE flags, then fixed-order
/// fields present per flag bit. We pull speed/cadence/power/HR and skip the rest
/// by advancing the offset — same layout the web app decodes.
fn parse_bike(v: &[u8]) -> BikeData {
    let mut d = BikeData::default();
    if v.len() < 2 {
        return d;
    }
    let flags = u16::from_le_bytes([v[0], v[1]]);
    let mut o = 2usize;
    let take_u16 = |v: &[u8], o: &mut usize| -> Option<u16> {
        let r = v.get(*o..*o + 2).map(|b| u16::from_le_bytes([b[0], b[1]]));
        if r.is_some() {
            *o += 2;
        }
        r
    };

    if flags & 0x0001 == 0 {
        // bit0 "More Data" == 0 → instantaneous speed present (uint16, 0.01 km/h)
        if let Some(x) = take_u16(v, &mut o) {
            d.speed_kph = Some(x as f32 * 0.01);
        }
    }
    if flags & 0x0002 != 0 {
        take_u16(v, &mut o); // average speed
    }
    if flags & 0x0004 != 0 {
        // instantaneous cadence (uint16, 0.5 rpm)
        if let Some(x) = take_u16(v, &mut o) {
            d.cadence_rpm = Some(x as f32 * 0.5);
        }
    }
    if flags & 0x0008 != 0 {
        take_u16(v, &mut o); // average cadence
    }
    if flags & 0x0010 != 0 {
        o += 3; // total distance (uint24)
    }
    if flags & 0x0020 != 0 {
        take_u16(v, &mut o); // resistance level (sint16)
    }
    if flags & 0x0040 != 0 {
        // instantaneous power (sint16, watts)
        if let Some(x) = take_u16(v, &mut o) {
            d.power_w = Some(x as i16 as i32);
        }
    }
    if flags & 0x0080 != 0 {
        take_u16(v, &mut o); // average power
    }
    if flags & 0x0100 != 0 {
        o += 5; // expended energy (uint16 + uint16 + uint8)
    }
    if flags & 0x0200 != 0 {
        // heart rate (uint8)
        if let Some(b) = v.get(o) {
            d.hr = Some(*b);
        }
    }
    d
}
