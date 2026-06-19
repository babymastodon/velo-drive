// state/logs.svelte.ts
//
// A small reactive append-only log store. The composition root wires the
// transport `log` events + the engine `onLog` callback into `append`; the
// Settings logs sub-view (#settingsLogsContent) renders the lines and
// auto-scrolls when the user is already at the bottom (mirrors the legacy
// docs/settings.js addLogLineToSettings selection-preserving append).
//
// We store the lines as an array (reactive) rather than mutating textContent
// directly: Svelte re-renders the joined text, and the SettingsView handles the
// "scroll to bottom only if already at the bottom" behavior so a user reading
// scrollback isn't yanked down.

const MAX_LOG_LINES = 2000;

export class LogsStore {
  lines = $state<string[]>([]);

  /** Append one log line (caps the buffer at MAX_LOG_LINES). */
  append = (line: string): void => {
    const next = this.lines.concat(line);
    if (next.length > MAX_LOG_LINES) next.splice(0, next.length - MAX_LOG_LINES);
    this.lines = next;
  };
}
