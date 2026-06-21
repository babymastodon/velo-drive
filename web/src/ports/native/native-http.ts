// Routes the workout-URL scrapers through the Rust http_get command in the native
// shell (no CORS), instead of the browser fetch used in the PWA.

import { invoke } from '@tauri-apps/api/core';
import { setHttpImpl, setHttpBytesImpl } from '../../core/net.js';

export function installNativeHttp(): void {
  setHttpImpl(async (url) => {
    const r = await invoke<{ status: number; ok: boolean; body: string }>('http_get', { url });
    return { ok: r.ok, status: r.status, text: r.body };
  });
  setHttpBytesImpl(async (url) => {
    const r = await invoke<{ status: number; ok: boolean; bodyB64: string }>('http_get_bytes', {
      url,
    });
    const bin = atob(r.bodyB64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { ok: r.ok, status: r.status, bytes };
  });
}
