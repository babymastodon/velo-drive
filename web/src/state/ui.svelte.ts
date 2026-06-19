// state/ui.svelte.ts
//
// The overlay-host model. There is at most ONE active full-screen overlay at a
// time (welcome | settings | …). Components read `ui.activeOverlay` reactively;
// the global keymap + the overlay chrome call open/close. Escape closes the
// active overlay, except the Settings logs sub-view returns to the main view
// first (matching the legacy disposition in docs/settings.js).

export type OverlayId = 'none' | 'welcome' | 'settings' | 'picker' | 'planner';

/**
 * An overlay's keydown handler. Returns true if it consumed the key (so the
 * shell can preventDefault/stopPropagation). Overlays register themselves here
 * on mount; the App keymap (overlayKeyHandlers hook) routes keys to the active
 * overlay's handler. Mirrors the legacy per-view document keydown listeners.
 */
export type OverlayKeyHandler = (e: KeyboardEvent) => boolean;

export class UiStore {
  activeOverlay = $state<OverlayId>('none');

  // Per-overlay keydown handlers, populated by the overlay components (picker
  // wave). Not reactive state — read by the App keymap on each keypress.
  overlayKeyHandlers: Partial<Record<OverlayId, OverlayKeyHandler>> = {};

  /** Register (or clear) an overlay's keydown handler. */
  registerOverlayKeyHandler(id: OverlayId, handler: OverlayKeyHandler | null): void {
    if (handler) this.overlayKeyHandlers[id] = handler;
    else delete this.overlayKeyHandlers[id];
  }

  // Settings has an internal logs sub-view; Escape returns here first.
  settingsLogsOpen = $state(false);

  // The planner has an internal ride-detail sub-view; Escape/Backspace return to
  // the calendar first (and Escape on the calendar does NOT close the planner —
  // legacy ignores it). Set by PlannerView; consumed in handleEscape. The
  // PlannerView's own key handler does the calendar→detail pop for Backspace.
  plannerDetailOpen = $state(false);

  // Welcome render mode ("full" tour vs "splash" only). Default off on boot.
  welcomeMode = $state<'full' | 'splash'>('full');
  // Which slide the welcome tour opens on (for deterministic tests).
  welcomeStartIndex = $state(0);

  // When a ride finishes, the shell opens the planner to the saved ride. The
  // planner reads this on open to select the day + open the ride's detail
  // (consumed in the planner wave; set here by onWorkoutEnded). Mirrors the
  // legacy planner.openDetailByFile(fileName, date) call.
  pendingHistoryFile = $state<{ fileName: string; date: Date } | null>(null);

  // Open the planner focused on a just-saved ride (legacy onWorkoutEnded flow).
  openPlannerForRide(fileName: string | null, date: Date): void {
    this.pendingHistoryFile = fileName ? { fileName, date } : null;
    this.activeOverlay = 'planner';
  }

  open(id: OverlayId): void {
    if (id === 'settings') this.settingsLogsOpen = false;
    this.activeOverlay = id;
  }

  openWelcome(mode: 'full' | 'splash' = 'full', startIndex = 0): void {
    this.welcomeMode = mode;
    this.welcomeStartIndex = startIndex;
    this.activeOverlay = 'welcome';
  }

  close(): void {
    this.settingsLogsOpen = false;
    this.plannerDetailOpen = false;
    this.activeOverlay = 'none';
  }

  /**
   * Escape disposition: the Settings logs sub-view returns to the main view
   * first; otherwise the active overlay closes. Returns true if it handled the
   * key (so the caller can stopPropagation/preventDefault).
   */
  handleEscape(): boolean {
    if (this.activeOverlay === 'none') return false;
    if (this.activeOverlay === 'settings' && this.settingsLogsOpen) {
      this.settingsLogsOpen = false;
      return true;
    }
    // The planner's ride-detail sub-view is popped by the planner's own key
    // handler (routed first in App). If we still see it open here, the detail
    // view owns Escape — never close the whole planner from detail (legacy
    // pops detail first, ignores Escape on the calendar otherwise). The handler
    // already returned true in that case, so this is a defensive guard.
    if (this.activeOverlay === 'planner' && this.plannerDetailOpen) {
      return true;
    }
    this.close();
    return true;
  }
}
