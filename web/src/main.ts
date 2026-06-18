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
export default app;
