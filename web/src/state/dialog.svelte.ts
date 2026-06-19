// state/dialog.svelte.ts
//
// Promise-based confirm()/alert() backed by a reactive request slot. The
// DialogHost renders the active request; resolving the request closes it. Only
// one dialog is shown at a time (requests queue via the returned promise chain).

export interface DialogRequest {
  kind: 'alert' | 'confirm' | 'prompt';
  message: string;
  title?: string;
  okLabel: string;
  cancelLabel?: string;
  // For prompt: the initial input value + a place for the host to mirror edits.
  inputValue?: string;
  placeholder?: string;
  resolve: (value: boolean) => void;
  // For prompt: resolves with the entered string (or null on cancel).
  resolveText?: (value: string | null) => void;
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
    opts: { title?: string; okLabel?: string; cancelLabel?: string; defaultValue?: string; placeholder?: string } = {},
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
        resolve: () => {},
        resolveText,
      };
    });
  }

  resolve(value: boolean): void {
    const req = this.current;
    this.current = null;
    if (req?.kind === 'prompt') {
      req.resolveText?.(value ? (req.inputValue ?? '') : null);
      return;
    }
    req?.resolve(value);
  }

  /** Resolve a prompt with the current input value (OK) or null (cancel). */
  resolvePrompt(accepted: boolean): void {
    const req = this.current;
    this.current = null;
    req?.resolveText?.(accepted ? (req.inputValue ?? '') : null);
  }
}
