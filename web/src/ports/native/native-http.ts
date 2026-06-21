// Routes the workout-URL scrapers through the Rust http_get command in the native
// shell (no CORS), instead of the browser fetch used in the PWA.

import { invoke } from '@tauri-apps/api/core';
import { setHttpImpl } from '../../core/net.js';

export function installNativeHttp(): void {
  setHttpImpl(async (url) => {
    const r = await invoke<{ status: number; ok: boolean; body: string }>('http_get', { url });
    return { ok: r.ok, status: r.status, text: r.body };
  });
}
