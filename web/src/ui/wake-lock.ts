// wake-lock.ts — keep the screen awake during a ride.
//
// During an indoor ride the user isn't touching the device, so the OS dims/sleeps
// the display and the live HUD goes dark. navigator.wakeLock.request('screen')
// prevents that. The lock is AUTO-RELEASED whenever the tab is hidden, so we
// re-acquire on visibilitychange when it's still wanted.
//
// Best-effort + feature-detected: unsupported browsers (some iOS Safari), a
// blocked request, or a non-visible document are all swallowed silently — and it
// is inert under the test harness (request simply no-ops/throws → ignored), so
// it never affects deterministic runs.

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', cb: () => void): void;
}

interface WakeLockApi {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

export class ScreenWakeLock {
  private sentinel: WakeLockSentinelLike | null = null;
  private wanted = false;
  private hookInstalled = false;

  private get api(): WakeLockApi | null {
    if (typeof navigator === 'undefined') return null;
    const wl = (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock;
    return wl && typeof wl.request === 'function' ? wl : null;
  }

  /** Declare whether the screen should stay awake (e.g. a ride is in progress). */
  setWanted(wanted: boolean): void {
    this.ensureVisibilityHook();
    if (wanted === this.wanted) return;
    this.wanted = wanted;
    if (wanted) void this.acquire();
    else void this.release();
  }

  private async acquire(): Promise<void> {
    if (!this.wanted) return;
    if (this.sentinel && !this.sentinel.released) return;
    const api = this.api;
    if (!api) return;
    // A request rejects unless the document is visible; skip and let the
    // visibilitychange hook re-acquire when it returns.
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    try {
      const sentinel = await api.request('screen');
      // The effect may have flipped to not-wanted while awaiting — honor it.
      if (!this.wanted) {
        void sentinel.release().catch(() => {});
        return;
      }
      this.sentinel = sentinel;
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) this.sentinel = null;
      });
    } catch {
      /* unsupported / blocked / not visible — best effort */
    }
  }

  private async release(): Promise<void> {
    const sentinel = this.sentinel;
    this.sentinel = null;
    if (sentinel && !sentinel.released) {
      try {
        await sentinel.release();
      } catch {
        /* ignore */
      }
    }
  }

  private ensureVisibilityHook(): void {
    if (this.hookInstalled || typeof document === 'undefined') return;
    this.hookInstalled = true;
    document.addEventListener('visibilitychange', () => {
      if (this.wanted && document.visibilityState === 'visible') void this.acquire();
    });
  }
}
