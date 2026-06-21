// app/compat.ts
//
// Platform compatibility detection. Used by SettingsView for the unsupported-OS
// / non-Chrome warning and by the boot-time auto-open (startupNeedsAttention)
// decision.

export interface DetectResult {
  name: string;
  supported: boolean;
}

interface NavLike {
  userAgent?: string;
  platform?: string;
  userAgentData?: { brands?: { brand?: string }[] };
}

function nav(): NavLike {
  return (typeof navigator !== 'undefined' ? navigator : {}) as NavLike;
}

export function detectOs(): DetectResult {
  const n = nav();
  const ua = (n.userAgent || '').toLowerCase();
  const platform = (n.platform || '').toLowerCase();
  let name = 'Unknown OS';
  let supported = false;

  if (ua.includes('windows')) {
    name = 'Windows';
    supported = true;
  } else if (ua.includes('android')) {
    name = 'Android';
    supported = true;
  } else if (ua.includes('mac os x') || platform.includes('mac')) {
    name = 'macOS';
    supported = true;
  } else if (ua.includes('linux')) {
    name = 'Linux';
    supported = true;
  } else if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) {
    name = 'iOS';
  }

  return { name, supported };
}

export function detectBrowser(): DetectResult {
  const n = nav();
  const ua = n.userAgent || '';
  const brandData = n.userAgentData?.brands || [];
  const brandMatch = brandData.find((b) => (b.brand || '').toLowerCase().includes('chrome'));

  let name = 'Unknown browser';

  if (brandMatch) {
    name = brandMatch.brand || name;
  } else if (/chrome/i.test(ua)) {
    name = ua.includes('Edg')
      ? 'Microsoft Edge'
      : ua.includes('OPR')
        ? 'Opera'
        : ua.toLowerCase().includes('brave')
          ? 'Brave'
          : 'Chrome';
  } else if (/safari/i.test(ua) && !/chrome/i.test(ua)) {
    name = 'Safari';
  } else if (/firefox/i.test(ua)) {
    name = 'Firefox';
  }

  const isChromiumBrand =
    (brandMatch && (brandMatch.brand || '').toLowerCase().includes('chrom')) || false;
  const isChromiumUa = /chrome|chromium|crios|edg|opr|brave/i.test(ua);
  const supported = isChromiumBrand || isChromiumUa;

  return { name, supported };
}

/**
 * The compatibility-alert message (empty string when supported).
 */
/** Running inside the Tauri native shell (native BLE; no browser constraints). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Open a URL in the system browser — native opener in the app, window.open in the PWA. */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    try {
      await (await import('@tauri-apps/api/core')).invoke('open_external', { url });
      return;
    } catch {
      /* fall through to window.open */
    }
  }
  window.open(url, '_blank', 'noopener');
}

export function compatMessage(): string {
  // The native shell drives Bluetooth through Rust — browser checks don't apply.
  if (isTauri()) return '';
  const os = detectOs();
  const browser = detectBrowser();
  if (!os.supported) {
    return `${os.name} does not support Web Bluetooth. Please use Linux, Windows, macOS, or Android.`;
  }
  if (!browser.supported) {
    return `${browser.name} does not support Web Bluetooth. Open VeloDrive in Google Chrome to pair your bike.`;
  }
  return '';
}

/** Whether the running platform/browser is unsupported (compat alert would show). */
export function isPlatformIncompatible(): boolean {
  return compatMessage() !== '';
}

/** Bluetooth availability: native in Tauri, else Web Bluetooth (getDevices). */
export function isWebBluetoothAvailable(): boolean {
  if (isTauri()) return true;
  return (
    typeof navigator !== 'undefined' &&
    !!(navigator as Navigator & { bluetooth?: { getDevices?: unknown } }).bluetooth &&
    typeof (navigator as Navigator & { bluetooth?: { getDevices?: unknown } }).bluetooth
      ?.getDevices === 'function'
  );
}
