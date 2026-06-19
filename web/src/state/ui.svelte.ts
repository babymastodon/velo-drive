// state/ui.svelte.ts
//
// The overlay-host model. There is at most ONE active full-screen overlay at a
// time (welcome | settings | …). Components read `ui.activeOverlay` reactively;
// the global keymap + the overlay chrome call open/close. Escape closes the
// active overlay, except the Settings logs sub-view returns to the main view
// first (matching the legacy disposition in docs/settings.js).

export type OverlayId = 'none' | 'welcome' | 'settings' | 'picker' | 'planner';

export class UiStore {
  activeOverlay = $state<OverlayId>('none');

  // Settings has an internal logs sub-view; Escape returns here first.
  settingsLogsOpen = $state(false);

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
    this.close();
    return true;
  }
}
