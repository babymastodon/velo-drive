import './styles/index.css';
import { installPlatformShim } from './app/shim.js';
import { mount } from 'svelte';
import App from './ui/App.svelte';

// Install the platform shim BEFORE the app boots (mirrors the legacy
// velo-shim.js): when the harness env is present, swap navigator.bluetooth /
// timers / Date / AudioContext / indexedDB / showDirectoryPicker for the fakes.
// The ports read these globals lazily (inside methods / via injected defaults),
// so importing them above does not capture the real globals before this runs.
installPlatformShim();

const app = mount(App, { target: document.getElementById('app')! });

// Register the offline service worker for the PWA — but ONLY in a normal page
// (not under the test harness, where SW caching would add nondeterminism to the
// Playwright runs, and not in non-secure / non-HTTPS contexts where SW APIs are
// unavailable). The harness injects window.__VELO_TEST_ENV__ before app code
// runs, so its presence reliably gates registration off during tests.
const isHarness = !!(window as unknown as { __VELO_TEST_ENV__?: unknown }).__VELO_TEST_ENV__;
if (
  !isHarness &&
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator &&
  window.location.protocol !== 'chrome-extension:' &&
  (window.isSecureContext ?? window.location.protocol === 'https:')
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('[main] service worker registration failed:', err);
    });
  });
}

export default app;
