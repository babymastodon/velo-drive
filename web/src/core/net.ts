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

export type HttpGet = (url: string) => Promise<HttpResult>;

let nativeImpl: HttpGet | null = null;

/** Install a platform HTTP implementation (the native shell does this in Tauri). */
export function setHttpImpl(fn: HttpGet): void {
  nativeImpl = fn;
}

/** GET a URL as text. Throws on network/CORS failure (browser path). */
export async function httpGetText(url: string): Promise<HttpResult> {
  if (nativeImpl) return nativeImpl(url);
  const res = await fetch(url, { credentials: 'omit' });
  return { ok: res.ok, status: res.status, text: res.ok ? await res.text() : '' };
}
