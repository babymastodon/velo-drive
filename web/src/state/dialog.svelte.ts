// state/dialog.svelte.ts
//
// Promise-based confirm()/alert() backed by a reactive request slot. The
// DialogHost renders the active request; resolving the request closes it. Only
// one dialog is shown at a time (requests queue via the returned promise chain).

export interface PickDevice {
  id: string;
  name: string;
  rssi?: number | null;
}

export interface DialogRequest {
  kind: 'alert' | 'confirm' | 'prompt' | 'device';
  message: string;
  title?: string;
  okLabel: string;
  cancelLabel?: string;
  // For prompt: the initial input value + a place for the host to mirror edits.
  inputValue?: string;
  placeholder?: string;
  // For prompt: an example value shown as a styled monospace hint.
  example?: string;
  // For prompt: optional action links rendered as buttons (e.g. "browse X").
  links?: { label: string; onClick: () => void }[];
  // For device: the scanned devices to choose from.
  devices?: PickDevice[];
  resolve: (value: boolean) => void;
  // For prompt: resolves with the entered string (or null on cancel).
  resolveText?: (value: string | null) => void;
  // For device: resolves with the chosen device id (or null on cancel).
  resolveDevice?: (id: string | null) => void;
}

export class DialogStore {
  current = $state<DialogRequest | null>(null);

  alert(message: string, opts: { title?: string; okLabel?: string } = {}): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.current = {
        kind: 'alert',
        message,
        title: opts.title,
        okLabel: opts.okLabel ?? 'OK',
        resolve,
      };
    });
  }

  confirm(
    message: string,
    opts: { title?: string; okLabel?: string; cancelLabel?: string } = {},
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.current = {
        kind: 'confirm',
        message,
        title: opts.title,
        okLabel: opts.okLabel ?? 'OK',
        cancelLabel: opts.cancelLabel ?? 'Cancel',
        resolve,
      };
    });
  }

  /**
   * Promise-based text prompt (replaces window.prompt). Resolves with the
   * entered string, or null if cancelled / empty-on-cancel.
   */
  prompt(
    message: string,
    opts: {
      title?: string;
      okLabel?: string;
      cancelLabel?: string;
      defaultValue?: string;
      placeholder?: string;
      example?: string;
      links?: { label: string; onClick: () => void }[];
    } = {},
  ): Promise<string | null> {
    return new Promise<string | null>((resolveText) => {
      this.current = {
        kind: 'prompt',
        message,
        title: opts.title,
        okLabel: opts.okLabel ?? 'OK',
        cancelLabel: opts.cancelLabel ?? 'Cancel',
        inputValue: opts.defaultValue ?? '',
        placeholder: opts.placeholder,
        example: opts.example,
        links: opts.links,
        resolve: () => {},
        resolveText,
      };
    });
  }

  /** Promise-based BLE device chooser. Resolves with the chosen device id, or
   *  null if cancelled. */
  pickDevice(title: string, message: string, devices: PickDevice[]): Promise<string | null> {
    return new Promise<string | null>((resolveDevice) => {
      this.current = {
        kind: 'device',
        title,
        message,
        okLabel: 'OK',
        cancelLabel: 'Cancel',
        devices,
        resolve: () => {},
        resolveDevice,
      };
    });
  }

  /** Pick a specific device (closes the dialog + resolves with its id). */
  chooseDevice(id: string): void {
    const req = this.current;
    this.current = null;
    req?.resolveDevice?.(id);
  }

  resolve(value: boolean): void {
    const req = this.current;
    this.current = null;
    if (req?.kind === 'prompt') {
      req.resolveText?.(value ? (req.inputValue ?? '') : null);
      return;
    }
    if (req?.kind === 'device') {
      req.resolveDevice?.(null); // cancelled
      return;
    }
    req?.resolve(value);
  }
}
