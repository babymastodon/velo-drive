// core/net.ts — a tiny HTTP-GET seam for the workout-URL scrapers.
//
// Default: the browser `fetch` (PWA), which is subject to CORS. The native shell
// installs a Rust-backed implementation (no CORS) at boot via setHttpImpl. Kept
// here so scrapers stay platform-agnostic and the unit harness can stub `fetch`.

export interface HttpResult {
  ok: boolean;
  status: number;
  text: string;
}

export interface HttpBytesResult {
  ok: boolean;
  status: number;
  bytes: Uint8Array;
}

export type HttpGet = (url: string) => Promise<HttpResult>;
export type HttpGetBytes = (url: string) => Promise<HttpBytesResult>;

let nativeImpl: HttpGet | null = null;
let nativeBytesImpl: HttpGetBytes | null = null;

/** Install a platform HTTP implementation (the native shell does this in Tauri). */
export function setHttpImpl(fn: HttpGet): void {
  nativeImpl = fn;
}
export function setHttpBytesImpl(fn: HttpGetBytes): void {
  nativeBytesImpl = fn;
}

/** GET a URL as text. Throws on network/CORS failure (browser path). */
export async function httpGetText(url: string): Promise<HttpResult> {
  if (nativeImpl) return nativeImpl(url);
  const res = await fetch(url, { credentials: 'omit' });
  return { ok: res.ok, status: res.status, text: res.ok ? await res.text() : '' };
}

/** GET a URL as bytes (e.g. a workout zip). Throws on network/CORS failure. */
export async function httpGetBytes(url: string): Promise<HttpBytesResult> {
  if (nativeBytesImpl) return nativeBytesImpl(url);
  const res = await fetch(url, { credentials: 'omit' });
  const bytes = res.ok ? new Uint8Array(await res.arrayBuffer()) : new Uint8Array(0);
  return { ok: res.ok, status: res.status, bytes };
}
