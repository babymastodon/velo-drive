// Native HTTP GET — lets the workout-URL scrapers (TrainerDay JSON, WhatsOnZwift
// HTML) fetch cross-origin without the webview's CORS restriction. In the PWA the
// scrapers use the browser `fetch`; in the native app they route here.

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;

#[derive(Serialize)]
pub struct HttpResp {
    pub status: u16,
    pub ok: bool,
    pub body: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpBytesResp {
    pub status: u16,
    pub ok: bool,
    pub body_b64: String,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (X11; Linux x86_64) VeloDrive")
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn http_get(url: String) -> Result<HttpResp, String> {
    let resp = client()?.get(&url).send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let ok = resp.status().is_success();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(HttpResp { status, ok, body })
}

/// GET binary (e.g. a workout zip) as base64.
#[tauri::command]
pub async fn http_get_bytes(url: String) -> Result<HttpBytesResp, String> {
    let resp = client()?.get(&url).send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let ok = resp.status().is_success();
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    Ok(HttpBytesResp {
        status,
        ok,
        body_b64: STANDARD.encode(&bytes),
    })
}
