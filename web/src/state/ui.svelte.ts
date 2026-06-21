// state/ui.svelte.ts
//
// The overlay-host model. There is at most ONE active full-screen overlay at a
// time (welcome | settings | …). Components read `ui.activeOverlay` reactively;
// the global keymap + the overlay chrome call open/close. Escape closes the
// active overlay, except the Settings logs sub-view returns to the main view
// first.

export type OverlayId = 'none' | 'welcome' | 'settings' | 'picker' | 'planner';

/**
 * An overlay's keydown handler. Returns true if it consumed the key (so the
 * shell can preventDefault/stopPropagation). Overlays register themselves here
 * on mount; the App keymap (overlayKeyHandlers hook) routes keys to the active
 * overlay's handler.
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

  // Schedule-mode handoff: the planner re-opens the picker as the workout
  // LIBRARY in "Schedule Workout" / "Edit Schedule" mode so the user browses +
  // picks ANY workout for a calendar day. When set, PickerView relabels its
  // chrome, hides Create-workout, shows Back-to-calendar (+ Unschedule in edit
  // mode) and schedules instead of loading the workout onto the HUD. Cleared on
  // every disposition (select / back / Escape) which returns to the planner
  // overlay.
  pickerScheduleContext = $state<{ dateKey: string; entry: { date: string; workoutTitle: string } | null; editMode: boolean } | null>(null);

  /**
   * Open the picker in schedule mode for a calendar day (from the planner). The
   * picker becomes the workout library so the user can browse + pick ANY
   * workout; selecting writes schedule.json and returns to the planner. In edit
   * mode the entry is pre-targeted (selecting REPLACES it; Unschedule removes
   * it).
   */
  openPickerForSchedule(dateKey: string, entry: { date: string; workoutTitle: string } | null = null, editMode = false): void {
    this.pickerScheduleContext = { dateKey, entry, editMode };
    this.activeOverlay = 'picker';
  }

  /** Return from schedule mode to the planner overlay (cancel or post-schedule). */
  returnToPlannerFromSchedule(): void {
    this.pickerScheduleContext = null;
    this.activeOverlay = 'planner';
  }

  // The picker hosts an in-place workout builder. While the builder is showing,
  // the BuilderView owns ALL keys (including Escape, which deselects a block or
  // goes Back — it must NOT close the picker). The App's global key router
  // checks this to suppress global hotkeys + the close-on-Escape disposition
  // while the builder is open (Escape returns early in builder mode).
  pickerBuilderMode = $state(false);

  // The boot-time auto-open (startupNeedsAttention) can force a help section
  // open when it auto-opens Settings. SettingsView reads + clears this on open.
  // null = no forced section.
  forceHelpSection = $state<string | null>(null);

  // The planner has an internal ride-detail sub-view; Escape/Backspace return to
  // the calendar first (and Escape on the calendar does NOT close the planner —
  // it is ignored). Set by PlannerView; consumed in handleEscape. The
  // PlannerView's own key handler does the calendar→detail pop for Backspace.
  plannerDetailOpen = $state(false);

  // Welcome render mode ("full" tour vs "splash" only). Default off on boot.
  welcomeMode = $state<'full' | 'splash'>('full');
  // Which slide the welcome tour opens on (for deterministic tests).
  welcomeStartIndex = $state(0);

  // When a ride finishes, the shell opens the planner to the saved ride. The
  // planner reads this on open to select the day + open the ride's detail
  // (consumed in the planner wave; set here by onWorkoutEnded).
  pendingHistoryFile = $state<{ fileName: string; date: Date } | null>(null);

  // Open the planner focused on a just-saved ride (onWorkoutEnded flow).
  openPlannerForRide(fileName: string | null, date: Date): void {
    this.pendingHistoryFile = fileName ? { fileName, date } : null;
    this.activeOverlay = 'planner';
  }

  open(id: OverlayId): void {
    if (id === 'settings') this.settingsLogsOpen = false;
    // A normal picker open (W key / chart "Select a workout") is LIBRARY mode —
    // clear any stale schedule context so it never leaks into a plain open.
    if (id !== 'picker') this.pickerScheduleContext = null;
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
    this.pickerScheduleContext = null;
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
    // view owns Escape — never close the whole planner from detail (detail is
    // popped first; Escape on the calendar is ignored otherwise). The handler
    // already returned true in that case, so this is a defensive guard.
    if (this.activeOverlay === 'planner' && this.plannerDetailOpen) {
      return true;
    }
    // Schedule-mode picker: Escape returns to the planner calendar WITHOUT
    // scheduling, it does NOT close everything. The picker's own key handler
    // normally consumes Escape first; this is the defensive fallback.
    if (this.activeOverlay === 'picker' && this.pickerScheduleContext) {
      this.returnToPlannerFromSchedule();
      return true;
    }
    this.close();
    return true;
  }
}
