// Native Bluetooth connector for VeloDrive (Linux/btleplug today; cross-platform
// by construction). Backs the web TrainerTransport seam via Tauri commands
// (connect/disconnect/set-target) and events (samples/status/log).
//
// Design goals from the brief:
// * Error handling — every command returns a Result AND emits a `ble://status`
//   error so the UI can show it; nothing panics, BLE tasks swallow nothing
//   silently.
// * Remember + reconnect on start — on a successful connect we emit the device
//   id; JS persists it (lastBikeDeviceId/lastHrDeviceId) and on boot calls
//   `ble_reconnect` to reconnect without a user gesture.
// * Polite with other apps — a BLE peripheral talks to ONE central at a time, so
//   we can't steal an active connection. To avoid fighting another app for a
//   device that briefly frees up, reconnect uses bounded exponential backoff and
//   GIVES UP after a few tries (the user can retry on demand). Trainer CONTROL
//   (FTMS requestControl) is taken lazily on the first target write, so merely
//   reading data never grabs control from another app. Intentional disconnects
//   suppress auto-reconnect; we disconnect cleanly on exit.

use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use btleplug::api::{Central, Characteristic, Manager as _, Peripheral as _, ScanFilter, WriteType};
use btleplug::platform::{Adapter, Manager, Peripheral};
use futures::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use uuid::Uuid;

// 16-bit BLE UUIDs expanded against the Bluetooth base UUID.
const FTMS_SERVICE: Uuid = Uuid::from_u128(0x0000_1826_0000_1000_8000_0080_5f9b_34fb);
const HR_SERVICE: Uuid = Uuid::from_u128(0x0000_180d_0000_1000_8000_0080_5f9b_34fb);
const INDOOR_BIKE_DATA: Uuid = Uuid::from_u128(0x0000_2ad2_0000_1000_8000_0080_5f9b_34fb);
const CONTROL_POINT: Uuid = Uuid::from_u128(0x0000_2ad9_0000_1000_8000_0080_5f9b_34fb);
const HR_MEASUREMENT: Uuid = Uuid::from_u128(0x0000_2a37_0000_1000_8000_0080_5f9b_34fb);

const OP_REQUEST_CONTROL: u8 = 0x00;
const OP_SET_TARGET_RESISTANCE: u8 = 0x04;
const OP_SET_TARGET_POWER: u8 = 0x05;
const OP_START_OR_RESUME: u8 = 0x07;

const SCAN_SECS: u64 = 6;
const RECONNECT_MAX_ATTEMPTS: u32 = 6;
const RECONNECT_BASE: Duration = Duration::from_secs(1);
const RECONNECT_CAP: Duration = Duration::from_secs(30);
/// How long to wait for a notification before treating the link as dead. FTMS
/// trainers and HR straps notify continuously (~1 Hz+) while alive, so this much
/// silence means the link stalled (device slept, supervision timeout) even though
/// BlueZ still reports it "connected" — the case where the indicator stays green
/// but no power flows until a manual reconnect.
const NOTIFY_STALL: Duration = Duration::from_secs(30);

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Bike,
    Hr,
}
impl Role {
    fn name(self) -> &'static str {
        match self {
            Role::Bike => "bike",
            Role::Hr => "hr",
        }
    }
    fn service(self) -> Uuid {
        match self {
            Role::Bike => FTMS_SERVICE,
            Role::Hr => HR_SERVICE,
        }
    }
    fn data_uuid(self) -> Uuid {
        match self {
            Role::Bike => INDOOR_BIKE_DATA,
            Role::Hr => HR_MEASUREMENT,
        }
    }
}

#[derive(Clone, Serialize)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub rssi: Option<i16>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusEvent {
    role: String,
    state: String,
    message: String,
    device_id: Option<String>,
    device_name: Option<String>,
}

#[derive(Clone, Serialize)]
struct BikeSample {
    power: Option<i32>,
    cadence: Option<f32>,
    speed: Option<f32>,
    hr: Option<u8>,
}

#[derive(Clone, Serialize)]
struct HrSample {
    hr: u16,
}

#[derive(Default)]
struct RoleState {
    peripheral: Option<Peripheral>,
    control_point: Option<Characteristic>,
    controlled: bool,
    wanted_id: Option<String>,
    /// Bumped on each user-initiated connect/disconnect to cancel stale
    /// forward/reconnect tasks. Internal reconnects keep the same generation.
    generation: u64,
    intentional: bool,
}

pub struct Ble {
    app: AppHandle,
    central: Option<Adapter>,
    bike: Arc<Mutex<RoleState>>,
    hr: Arc<Mutex<RoleState>>,
}

impl Ble {
    pub async fn new(app: AppHandle) -> Self {
        let central = match Manager::new().await {
            Ok(m) => m.adapters().await.ok().and_then(|a| a.into_iter().next()),
            Err(_) => None,
        };
        if central.is_none() {
            log(&app, "no Bluetooth adapter found");
        }
        Self {
            app,
            central,
            bike: Arc::new(Mutex::new(RoleState::default())),
            hr: Arc::new(Mutex::new(RoleState::default())),
        }
    }

    fn state(&self, role: Role) -> Arc<Mutex<RoleState>> {
        match role {
            Role::Bike => self.bike.clone(),
            Role::Hr => self.hr.clone(),
        }
    }

    fn central(&self) -> Result<Adapter, String> {
        self.central
            .clone()
            .ok_or_else(|| "no Bluetooth adapter".to_string())
    }

    pub async fn scan(&self, secs: u64) -> Result<Vec<DeviceInfo>, String> {
        let central = self.central()?;
        scan_devices(&central, secs, None).await.map_err(|e| e.to_string())
    }

    /// Scan for devices advertising the role's service (FTMS for the trainer, HR
    /// for the monitor) — what the device picker shows.
    pub async fn scan_role(&self, role: Role, secs: u64) -> Result<Vec<DeviceInfo>, String> {
        let central = self.central()?;
        log(&self.app, format!("scanning {secs}s for {} devices…", role.name()));
        let out = scan_devices(&central, secs, Some(role.service()))
            .await
            .map_err(|e| e.to_string())?;
        log(
            &self.app,
            format!("scan found {} {} device(s)", out.len(), role.name()),
        );
        Ok(out)
    }

    /// User-initiated connect ("picker": auto-pick the first device advertising the
    /// role's service) or, with `want_id`, connect to a specific saved device.
    pub async fn connect(&self, role: Role, want_id: Option<String>) -> Result<(), String> {
        let central = self.central()?;
        let state = self.state(role);
        let gen_id = {
            let mut s = state.lock().await;
            s.intentional = false;
            s.generation += 1;
            s.generation
        };
        do_connect(self.app.clone(), central, role, state, want_id, gen_id, true).await
    }

    /// Boot reconnect to the saved devices. Soft: an absent device leaves the role
    /// idle rather than raising an error toast.
    pub async fn reconnect_saved(&self, bike_id: Option<String>, hr_id: Option<String>) {
        if let (Ok(central), Some(id)) = (self.central(), bike_id) {
            let state = self.state(Role::Bike);
            let gen_id = bump(&state).await;
            let _ = do_connect(self.app.clone(), central, Role::Bike, state, Some(id), gen_id, false).await;
        }
        if let (Ok(central), Some(id)) = (self.central(), hr_id) {
            let state = self.state(Role::Hr);
            let gen_id = bump(&state).await;
            let _ = do_connect(self.app.clone(), central, Role::Hr, state, Some(id), gen_id, false).await;
        }
    }

    pub async fn set_target_power(&self, watts: i16) -> Result<(), String> {
        let (p, cp) = self.bike_control().await?;
        self.ensure_control(&p, &cp).await?;
        let [lo, hi] = watts.to_le_bytes();
        cp_write(&p, &cp, &[OP_SET_TARGET_POWER, lo, hi])
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn set_resistance(&self, tenths: i16) -> Result<(), String> {
        let (p, cp) = self.bike_control().await?;
        self.ensure_control(&p, &cp).await?;
        let [lo, hi] = tenths.to_le_bytes();
        cp_write(&p, &cp, &[OP_SET_TARGET_RESISTANCE, lo, hi])
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn disconnect(&self, role: Role) -> Result<(), String> {
        let p = {
            let st = self.state(role);
            let mut s = st.lock().await;
            s.intentional = true;
            s.generation += 1;
            s.wanted_id = None;
            s.controlled = false;
            s.control_point = None;
            s.peripheral.take()
        };
        if let Some(p) = p {
            let _ = p.disconnect().await;
        }
        status(&self.app, role, "idle", "Disconnected", None, None);
        Ok(())
    }

    /// Disconnect everything cleanly (on app exit) so other apps can use the
    /// trainer/HRM. Best-effort and concurrent — BlueZ takes ~2s to answer
    /// each Disconnect(), so serializing them doubles the exit wait. Callers
    /// bound the total wait (see the ExitRequested handler).
    pub async fn shutdown(&self) {
        let _ = tokio::join!(self.disconnect(Role::Bike), self.disconnect(Role::Hr));
    }

    async fn bike_control(&self) -> Result<(Peripheral, Characteristic), String> {
        let s = self.bike.lock().await;
        let p = s
            .peripheral
            .clone()
            .ok_or_else(|| "trainer not connected".to_string())?;
        let cp = s
            .control_point
            .clone()
            .ok_or_else(|| "trainer has no control point".to_string())?;
        Ok((p, cp))
    }

    /// Take FTMS control lazily — only the first time we actually drive the
    /// trainer, so passively reading data doesn't grab control from another app.
    async fn ensure_control(&self, p: &Peripheral, cp: &Characteristic) -> Result<(), String> {
        if self.bike.lock().await.controlled {
            return Ok(());
        }
        cp_write(p, cp, &[OP_REQUEST_CONTROL])
            .await
            .map_err(|e| format!("requestControl failed (another app in control?): {e}"))?;
        cp_write(p, cp, &[OP_START_OR_RESUME])
            .await
            .map_err(|e| e.to_string())?;
        self.bike.lock().await.controlled = true;
        Ok(())
    }
}

async fn bump(state: &Arc<Mutex<RoleState>>) -> u64 {
    let mut s = state.lock().await;
    s.intentional = false;
    s.generation += 1;
    s.generation
}

fn status(
    app: &AppHandle,
    role: Role,
    state: &str,
    message: &str,
    device_id: Option<String>,
    device_name: Option<String>,
) {
    let _ = app.emit(
        "ble://status",
        StatusEvent {
            role: role.name().into(),
            state: state.into(),
            message: message.into(),
            device_id,
            device_name,
        },
    );
}

fn log(app: &AppHandle, msg: impl Into<String>) {
    let _ = app.emit("ble://log", msg.into());
}

async fn scan_devices(
    central: &Adapter,
    secs: u64,
    filter: Option<Uuid>,
) -> Result<Vec<DeviceInfo>> {
    central.start_scan(ScanFilter::default()).await.context("start_scan")?;
    tokio::time::sleep(Duration::from_secs(secs)).await;
    let ps = central.peripherals().await?;
    let _ = central.stop_scan().await;
    let mut out = Vec::new();
    for p in ps {
        if let Ok(Some(props)) = p.properties().await {
            // Only keep devices advertising the requested service (FTMS / HR), so
            // the picker lists valid trainers / monitors rather than every gadget.
            if let Some(svc) = filter {
                if !props.services.contains(&svc) {
                    continue;
                }
            }
            out.push(DeviceInfo {
                id: props.address.to_string(),
                name: props.local_name.unwrap_or_default(),
                rssi: props.rssi,
            });
        }
    }
    Ok(out)
}

async fn find_peripheral(central: &Adapter, role: Role, want_id: Option<&str>) -> Result<Peripheral> {
    central.start_scan(ScanFilter::default()).await.context("start_scan")?;
    tokio::time::sleep(Duration::from_secs(SCAN_SECS)).await;
    let ps = central.peripherals().await?;
    let _ = central.stop_scan().await;
    let mut by_service: Option<Peripheral> = None;
    for p in ps {
        // A device that vanished mid-scan must not abort the search.
        let Ok(Some(props)) = p.properties().await else {
            continue;
        };
        let addr = props.address.to_string();
        if let Some(id) = want_id {
            if addr.eq_ignore_ascii_case(id) {
                return Ok(p);
            }
        } else if props.services.contains(&role.service()) && by_service.is_none() {
            by_service = Some(p);
        }
    }
    if want_id.is_some() {
        return Err(anyhow!(
            "saved device not found (off, out of range, or connected to another app)"
        ));
    }
    by_service.ok_or_else(|| {
        anyhow!(
            "no {} found — is it on, awake, and not connected to another app?",
            role.name()
        )
    })
}

async fn connect_peripheral(app: &AppHandle, p: &Peripheral) -> Result<()> {
    // BLE connects are flaky (BlueZ "service discovery timed out" on a stale cache
    // right after a prior session) — retry a few times.
    let mut last = None;
    for attempt in 1..=3 {
        match p.connect().await {
            Ok(()) => return Ok(()),
            Err(e) => {
                log(app, format!("connect attempt {attempt}/3: {e}"));
                last = Some(e);
                tokio::time::sleep(Duration::from_millis(800)).await;
            }
        }
    }
    Err(anyhow!(last.expect("had an error")))
}

#[allow(clippy::too_many_arguments)]
async fn do_connect(
    app: AppHandle,
    central: Adapter,
    role: Role,
    state: Arc<Mutex<RoleState>>,
    want_id: Option<String>,
    gen_id: u64,
    report_error: bool,
) -> Result<(), String> {
    {
        let mut s = state.lock().await;
        if s.generation != gen_id {
            return Ok(()); // superseded by a newer action
        }
        s.wanted_id = want_id.clone();
    }
    status(&app, role, "connecting", "Connecting…", None, None);
    log(
        &app,
        format!(
            "{}: connecting{}",
            role.name(),
            want_id
                .as_ref()
                .map(|i| format!(" to {i}"))
                .unwrap_or_else(|| " (first available)".into())
        ),
    );

    let fail = |app: &AppHandle, msg: String| -> Result<(), String> {
        log(app, format!("{}: {}", role.name(), msg));
        if report_error {
            status(app, role, "error", &msg, None, None);
        } else {
            status(app, role, "idle", "", None, None);
        }
        Err(msg)
    };

    let p = match find_peripheral(&central, role, want_id.as_deref()).await {
        Ok(p) => p,
        Err(e) => return fail(&app, e.to_string()),
    };
    if let Err(e) = connect_peripheral(&app, &p).await {
        return fail(&app, format!("connect failed: {e}"));
    }
    log(&app, format!("{}: connected, discovering services…", role.name()));
    if let Err(e) = p.discover_services().await {
        let _ = p.disconnect().await;
        return fail(&app, format!("service discovery failed: {e}"));
    }

    let chars = p.characteristics();
    let data_char = match chars.iter().find(|c| c.uuid == role.data_uuid()).cloned() {
        Some(c) => c,
        None => {
            let _ = p.disconnect().await;
            return fail(&app, format!("{}: expected data characteristic missing", role.name()));
        }
    };
    if let Err(e) = p.subscribe(&data_char).await {
        let _ = p.disconnect().await;
        return fail(&app, format!("subscribe failed: {e}"));
    }
    let control_point = if role == Role::Bike {
        chars.iter().find(|c| c.uuid == CONTROL_POINT).cloned()
    } else {
        None
    };

    let props = p.properties().await.ok().flatten();
    let id = props.as_ref().map(|pr| pr.address.to_string());
    let name = props.and_then(|pr| pr.local_name);

    {
        let mut s = state.lock().await;
        if s.generation != gen_id {
            let _ = p.disconnect().await; // superseded while connecting
            return Ok(());
        }
        s.peripheral = Some(p.clone());
        s.control_point = control_point;
        s.controlled = false;
        s.wanted_id = id.clone();
    }
    status(&app, role, "connected", "Connected", id, name);
    spawn_forward(app, central, role, state, p, data_char, gen_id);
    Ok(())
}

fn spawn_forward(
    app: AppHandle,
    central: Adapter,
    role: Role,
    state: Arc<Mutex<RoleState>>,
    p: Peripheral,
    data_char: Characteristic,
    gen_id: u64,
) {
    tauri::async_runtime::spawn(async move {
        let mut notifs = match p.notifications().await {
            Ok(n) => n,
            Err(e) => {
                log(&app, format!("{}: notifications failed: {e}", role.name()));
                return;
            }
        };
        loop {
            // A plain `notifs.next().await` blocks forever if the peripheral stops
            // notifying while the BlueZ link stays up (trainer sleeps, supervision
            // timeout) — the status would stay "connected" with no data flowing.
            // Bound the wait: NOTIFY_STALL of silence means the link is dead in
            // practice, so tear it down and fall through to the reconnect path.
            let data = match tokio::time::timeout(NOTIFY_STALL, notifs.next()).await {
                Ok(Some(data)) => data,
                Ok(None) => break, // stream ended → a real disconnect
                Err(_) => {
                    let superseded = {
                        let s = state.lock().await;
                        s.generation != gen_id
                    };
                    if superseded {
                        return;
                    }
                    log(
                        &app,
                        format!(
                            "{}: no data for {}s — forcing reconnect",
                            role.name(),
                            NOTIFY_STALL.as_secs()
                        ),
                    );
                    let _ = p.disconnect().await; // drop the stale link so reconnect is clean
                    break;
                }
            };
            {
                let s = state.lock().await;
                if s.generation != gen_id {
                    return; // superseded
                }
            }
            if data.uuid == data_char.uuid {
                match role {
                    Role::Bike => {
                        let _ = app.emit("ble://bike-sample", parse_bike(&data.value));
                    }
                    Role::Hr => {
                        if let Some(hr) = parse_hr(&data.value) {
                            let _ = app.emit("ble://hr-sample", HrSample { hr });
                        }
                    }
                }
            }
        }
        // The notification stream ended (or stalled) → the link dropped.
        let (intentional, cur_gen, wanted) = {
            let s = state.lock().await;
            (s.intentional, s.generation, s.wanted_id.clone())
        };
        if cur_gen != gen_id {
            return; // superseded
        }
        {
            let mut s = state.lock().await;
            if s.generation == gen_id {
                s.peripheral = None;
                s.control_point = None;
                s.controlled = false;
            }
        }
        if intentional {
            status(&app, role, "idle", "Disconnected", None, None);
            return;
        }
        status(&app, role, "disconnected", "Connection lost — reconnecting…", None, None);
        if let Some(id) = wanted {
            reconnect_backoff(app, central, role, state, id, gen_id).await;
        }
    });
}

/// Bounded exponential-backoff reconnect. Gives up after a few tries so we don't
/// hammer a device that another app may want; the user can retry on demand.
async fn reconnect_backoff(
    app: AppHandle,
    central: Adapter,
    role: Role,
    state: Arc<Mutex<RoleState>>,
    id: String,
    gen_id: u64,
) {
    let mut delay = RECONNECT_BASE;
    for attempt in 1..=RECONNECT_MAX_ATTEMPTS {
        {
            let s = state.lock().await;
            if s.generation != gen_id || s.intentional {
                return; // superseded or user cancelled
            }
        }
        tokio::time::sleep(delay).await;
        {
            let s = state.lock().await;
            if s.generation != gen_id || s.intentional {
                return;
            }
        }
        status(
            &app,
            role,
            "connecting",
            &format!("Reconnecting (try {attempt}/{RECONNECT_MAX_ATTEMPTS})…"),
            None,
            None,
        );
        // Same generation — an internal reconnect, not a new user action.
        match do_connect(
            app.clone(),
            central.clone(),
            role,
            state.clone(),
            Some(id.clone()),
            gen_id,
            false,
        )
        .await
        {
            Ok(()) => return, // connected (or superseded) — either way we stop here
            Err(_) => delay = (delay * 2).min(RECONNECT_CAP),
        }
    }
    status(
        &app,
        role,
        "disconnected",
        "Could not reconnect — tap to retry.",
        None,
        None,
    );
}

async fn cp_write(p: &Peripheral, cp: &Characteristic, bytes: &[u8]) -> Result<()> {
    p.write(cp, bytes, WriteType::WithResponse)
        .await
        .with_context(|| format!("control-point write {bytes:02x?}"))
}

/// Parse an FTMS Indoor Bike Data frame (0x2AD2) — same field layout the web app
/// decodes. Pulls speed/cadence/power/HR and skips the rest by advancing offset.
fn parse_bike(v: &[u8]) -> BikeSample {
    let mut d = BikeSample {
        power: None,
        cadence: None,
        speed: None,
        hr: None,
    };
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
        if let Some(x) = take_u16(v, &mut o) {
            d.speed = Some(x as f32 * 0.01);
        }
    }
    if flags & 0x0002 != 0 {
        take_u16(v, &mut o);
    }
    if flags & 0x0004 != 0 {
        if let Some(x) = take_u16(v, &mut o) {
            d.cadence = Some(x as f32 * 0.5);
        }
    }
    if flags & 0x0008 != 0 {
        take_u16(v, &mut o);
    }
    if flags & 0x0010 != 0 {
        o += 3;
    }
    if flags & 0x0020 != 0 {
        take_u16(v, &mut o);
    }
    if flags & 0x0040 != 0 {
        if let Some(x) = take_u16(v, &mut o) {
            d.power = Some(x as i16 as i32);
        }
    }
    if flags & 0x0080 != 0 {
        take_u16(v, &mut o);
    }
    if flags & 0x0100 != 0 {
        o += 5;
    }
    if flags & 0x0200 != 0 {
        if let Some(b) = v.get(o) {
            d.hr = Some(*b);
        }
    }
    d
}

/// Parse a BLE Heart Rate Measurement (0x2A37): flags bit 0 → 8- vs 16-bit BPM.
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
