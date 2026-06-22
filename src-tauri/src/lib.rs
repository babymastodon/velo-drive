// VeloDrive native shell. Hosts the existing web UI in a system webview and
// bridges Bluetooth to native Rust (see ble.rs).

mod ble;
mod files;
mod net;

use std::sync::{Arc, Mutex};

use ble::{Ble, DeviceInfo, Role};
use tauri::{AppHandle, Manager, RunEvent, State};

/// Holds a keep-awake guard while a ride is in progress (dropping it releases).
#[derive(Default)]
struct KeepAwake(Mutex<Option<keepawake::KeepAwake>>);

/// Open a URL (or path) in the system default app/browser.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    opener::open(&url).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_keep_awake(state: State<'_, KeepAwake>, on: bool) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if on {
        if guard.is_none() {
            let awake = keepawake::Builder::default()
                .display(true)
                .reason("VeloDrive ride in progress")
                .app_name("VeloDrive")
                .create()
                .map_err(|e| e.to_string())?;
            *guard = Some(awake);
        }
    } else {
        *guard = None;
    }
    Ok(())
}

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

/// Connect a role to a specific device the user picked from the scan list.
#[tauri::command]
async fn ble_connect_device(
    ble: State<'_, Arc<Ble>>,
    role: String,
    id: String,
) -> Result<(), String> {
    let ble = ble.inner().clone();
    let r = if role == "hr" { Role::Hr } else { Role::Bike };
    ble.connect(r, Some(id)).await
}

/// Scan for devices advertising the role's service (for the device picker).
#[tauri::command]
async fn ble_scan_role(
    ble: State<'_, Arc<Ble>>,
    role: String,
    secs: Option<u64>,
) -> Result<Vec<DeviceInfo>, String> {
    let ble = ble.inner().clone();
    let r = if role == "hr" { Role::Hr } else { Role::Bike };
    ble.scan_role(r, secs.unwrap_or(5)).await
}

/// The default VeloDrive data folder: a `library` dir inside the app's own XDG
/// data dir (~/.local/share/bike.velodrive.VeloDrive), so everything's in one place.
#[tauri::command]
fn fs_default_root(app: AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("library").to_string_lossy().into_owned())
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

/// The system window-button layout (GNOME `button-layout`, e.g. "appmenu:close")
/// so our titlebar matches native apps instead of forcing minimize/maximize.
#[cfg(target_os = "linux")]
fn system_decoration_layout() -> Option<String> {
    let out = std::process::Command::new("gsettings")
        .args(["get", "org.gnome.desktop.wm.preferences", "button-layout"])
        .output()
        .ok()?;
    let s = String::from_utf8(out.stdout).ok()?;
    let s = s.trim().trim_matches('\'').trim().to_string();
    (!s.is_empty()).then_some(s)
}

/// tao's client-side titlebar is a GtkEventBox wrapping a GtkHeaderBar that draws
/// the window buttons from its decoration-layout. Find that header bar and set its
/// layout to the system one (e.g. GNOME's "appmenu:close" — close only).
#[cfg(target_os = "linux")]
fn apply_titlebar_layout(w: &gtk::Widget, layout: &str) {
    use gtk::prelude::*;
    if let Some(hb) = w.downcast_ref::<gtk::HeaderBar>() {
        hb.set_decoration_layout(Some(layout));
        return;
    }
    if let Some(c) = w.downcast_ref::<gtk::Container>() {
        for child in c.children() {
            apply_titlebar_layout(&child, layout);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // NVIDIA + Wayland trips WebKitGTK's DMABUF renderer (GBM / Wayland protocol
    // errors → blank/crashing window); SHM rendering is reliable. Must be set
    // before any GTK/webview init. Respect an explicit override.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            ble_scan,
            ble_scan_role,
            ble_connect_bike,
            ble_connect_hr,
            ble_connect_device,
            ble_reconnect,
            ble_set_target_power,
            ble_set_resistance,
            ble_disconnect_bike,
            ble_disconnect_hr,
            files::fs_pick_folder,
            files::fs_read_dir,
            files::fs_read_text,
            files::fs_write_text,
            files::fs_read_bytes,
            files::fs_write_bytes,
            files::fs_mkdir,
            files::fs_remove,
            files::fs_exists,
            net::http_get,
            net::http_get_bytes,
            open_external,
            fs_default_root,
            set_keep_awake,
        ])
        .manage(KeepAwake::default())
        .setup(|app| {
            // Explicitly apply the branded VeloDrive icon to the window (the WM
            // titlebar/taskbar doesn't always pick up the embedded bundle icon).
            if let Some(icon) = app.default_window_icon().cloned() {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_icon(icon);
                }
            }
            // tao draws its own client-side titlebar that ignores GNOME's
            // button-layout; make its header bar match the system one.
            #[cfg(target_os = "linux")]
            if let (Some(layout), Some(gtk_win)) = (
                system_decoration_layout(),
                app.get_webview_window("main")
                    .and_then(|w| w.gtk_window().ok()),
            ) {
                use gtk::prelude::GtkWindowExt;
                if let Some(tb) = gtk_win.titlebar() {
                    apply_titlebar_layout(&tb, &layout);
                }
            }
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
