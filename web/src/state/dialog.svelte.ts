// state/dialog.svelte.ts
//
// Promise-based confirm()/alert() backed by a reactive request slot. The
// DialogHost renders the active request; resolving the request closes it. Only
// one dialog is shown at a time (requests queue via the returned promise chain).

export interface DialogRequest {
  kind: 'alert' | 'confirm';
  message: string;
  title?: string;
  okLabel: string;
  cancelLabel?: string;
  resolve: (value: boolean) => void;
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

  resolve(value: boolean): void {
    const req = this.current;
    this.current = null;
    req?.resolve(value);
  }
}
