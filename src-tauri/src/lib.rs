// VeloDrive native shell. Hosts the existing web UI in a system webview and
// bridges Bluetooth to native Rust (see ble.rs).

mod ble;

use std::sync::Arc;

use ble::{Ble, DeviceInfo, Role};
use tauri::{Manager, RunEvent, State};

#[tauri::command]
async fn ble_scan(ble: State<'_, Arc<Ble>>, secs: Option<u64>) -> Result<Vec<DeviceInfo>, String> {
    let ble = ble.inner().clone();
    ble.scan(secs.unwrap_or(6)).await
}

#[tauri::command]
async fn ble_connect_bike(ble: State<'_, Arc<Ble>>) -> Result<(), String> {
    let ble = ble.inner().clone();
    ble.connect(Role::Bike, None).await
}

#[tauri::command]
async fn ble_connect_hr(ble: State<'_, Arc<Ble>>) -> Result<(), String> {
    let ble = ble.inner().clone();
    ble.connect(Role::Hr, None).await
}

#[tauri::command]
async fn ble_reconnect(
    ble: State<'_, Arc<Ble>>,
    bike_id: Option<String>,
    hr_id: Option<String>,
) -> Result<(), String> {
    let ble = ble.inner().clone();
    ble.reconnect_saved(bike_id, hr_id).await;
    Ok(())
}

#[tauri::command]
async fn ble_set_target_power(ble: State<'_, Arc<Ble>>, watts: i16) -> Result<(), String> {
    let ble = ble.inner().clone();
    ble.set_target_power(watts).await
}

#[tauri::command]
async fn ble_set_resistance(ble: State<'_, Arc<Ble>>, tenths: i16) -> Result<(), String> {
    let ble = ble.inner().clone();
    ble.set_resistance(tenths).await
}

#[tauri::command]
async fn ble_disconnect_bike(ble: State<'_, Arc<Ble>>) -> Result<(), String> {
    let ble = ble.inner().clone();
    ble.disconnect(Role::Bike).await
}

#[tauri::command]
async fn ble_disconnect_hr(ble: State<'_, Arc<Ble>>) -> Result<(), String> {
    let ble = ble.inner().clone();
    ble.disconnect(Role::Hr).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            ble_scan,
            ble_connect_bike,
            ble_connect_hr,
            ble_reconnect,
            ble_set_target_power,
            ble_set_resistance,
            ble_disconnect_bike,
            ble_disconnect_hr,
        ])
        .setup(|app| {
            // Init the BLE manager up front so events can fire as soon as the UI
            // calls reconnect/connect.
            let handle = app.handle().clone();
            let ble = tauri::async_runtime::block_on(Ble::new(handle));
            app.manage(Arc::new(ble));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building VeloDrive")
        .run(|app_handle, event| {
            // Free the trainer/HRM for other apps on exit.
            if let RunEvent::ExitRequested { .. } = event {
                if let Some(ble) = app_handle.try_state::<Arc<Ble>>() {
                    let ble = ble.inner().clone();
                    tauri::async_runtime::block_on(ble.shutdown());
                }
            }
        });
}
