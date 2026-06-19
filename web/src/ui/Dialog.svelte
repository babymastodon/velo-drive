<script lang="ts">
  // A single promise-backed alert/confirm dialog. Reuses the settings overlay
  // backdrop + modal chrome classes so it sits on the same re-hosted CSS. The
  // OK/Cancel resolve the originating promise via the dialog store.
  import OverlayModal from './OverlayModal.svelte';
  import type { DialogStore } from '../state/dialog.svelte.js';

  let { dialogs }: { dialogs: DialogStore } = $props();

  const req = $derived(dialogs.current);
</script>

<OverlayModal
  overlayClass="settings-overlay dialog-overlay"
  overlayId="dialogOverlay"
  ariaLabel={req?.title ?? 'Dialog'}
  open={!!req}
  onClose={() => dialogs.resolve(false)}
>
  {#if req}
    <div class="settings-modal dialog-modal" data-testid="dialog" tabindex="-1" role="document">
      {#if req.title}
        <header class="settings-header">
          <div class="settings-header-main">
            <div class="settings-title">{req.title}</div>
          </div>
        </header>
      {/if}
      <div class="settings-body">
        <p class="dialog-message" data-testid="dialog-message">{req.message}</p>
        {#if req.kind === 'prompt'}
          <input
            class="dialog-input"
            type="text"
            data-testid="dialog-input"
            placeholder={req.placeholder ?? ''}
            value={req.inputValue ?? ''}
            oninput={(e) => { if (req) req.inputValue = (e.currentTarget as HTMLInputElement).value; }}
            onkeydown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); dialogs.resolve(true); }
              else if (e.key === 'Escape') { e.preventDefault(); dialogs.resolve(false); }
            }}
          />
        {/if}
        <div class="dialog-actions">
          {#if req.kind === 'confirm' || req.kind === 'prompt'}
            <button
              class="settings-button"
              type="button"
              data-testid="dialog-cancel"
              onclick={() => dialogs.resolve(false)}>{req.cancelLabel}</button
            >
          {/if}
          <button
            class="settings-button settings-button-primary"
            type="button"
            data-testid="dialog-ok"
            onclick={() => dialogs.resolve(true)}>{req.okLabel}</button
          >
        </div>
      </div>
    </div>
  {/if}
</OverlayModal>

<style>
  .dialog-modal {
    width: min(420px, 80vw);
    height: auto;
    max-height: 60vh;
  }
  .dialog-message {
    margin: 0 0 16px;
    line-height: 1.5;
    white-space: pre-line;
  }
  .dialog-input {
    width: 100%;
    box-sizing: border-box;
    margin: 0 0 16px;
    padding: 8px 10px;
    font: inherit;
  }
  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
