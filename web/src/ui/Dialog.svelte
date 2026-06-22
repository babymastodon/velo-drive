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
        {#if req.kind === 'prompt' && req.links?.length}
          <div class="dialog-links">
            {#each req.links as link}
              <button type="button" class="dialog-link" onclick={() => link.onClick()}>{link.label}</button>
            {/each}
          </div>
        {/if}
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
        {#if req.kind === 'prompt' && req.example}
          <div class="dialog-example">
            <span class="dialog-example-label">Example</span>
            <code class="dialog-example-url">{req.example}</code>
          </div>
        {/if}
        {#if req.kind === 'device'}
          <div class="dialog-devices" data-testid="dialog-devices">
            {#each req.devices ?? [] as d (d.id)}
              <button
                class="dialog-device"
                type="button"
                data-testid="dialog-device"
                onclick={() => dialogs.chooseDevice(d.id)}
              >
                <span class="dialog-device-name">{d.name}</span>
                {#if d.rssi != null}<span class="dialog-device-rssi">{d.rssi} dBm</span>{/if}
              </button>
            {/each}
          </div>
        {/if}
        <div class="dialog-actions">
          {#if req.kind === 'confirm' || req.kind === 'prompt' || req.kind === 'device'}
            <button
              class="settings-button"
              type="button"
              data-testid="dialog-cancel"
              onclick={() => dialogs.resolve(false)}>{req.cancelLabel}</button
            >
          {/if}
          {#if req.kind !== 'device'}
            <button
              class="settings-button settings-button-primary"
              type="button"
              data-testid="dialog-ok"
              onclick={() => dialogs.resolve(true)}>{req.okLabel}</button
            >
          {/if}
        </div>
      </div>
    </div>
  {/if}
</OverlayModal>

<style>
  .dialog-modal {
    /* Size to content so a long example URL fits on one line, capped so short
       alerts don't sprawl. */
    width: max-content;
    min-width: min(340px, 90vw);
    max-width: min(560px, 92vw);
    height: auto;
    max-height: 70vh;
  }
  .dialog-message {
    margin: 0 0 14px;
    line-height: 1.55;
    white-space: pre-line;
    color: var(--text-main);
  }
  .dialog-input {
    width: 100%;
    box-sizing: border-box;
    margin: 0 0 12px;
    padding: 9px 11px;
    font: inherit;
    color: var(--text-main);
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .dialog-input::placeholder {
    color: var(--text-muted);
  }
  .dialog-input:focus {
    outline: none;
    border-color: var(--text-muted);
  }
  .dialog-links {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0 0 14px;
  }
  .dialog-link {
    border: 1px solid var(--border);
    background: var(--surface-muted);
    color: var(--text-main);
    border-radius: 6px;
    padding: 6px 12px;
    font: inherit;
    font-size: 0.9em;
    cursor: pointer;
  }
  .dialog-link:hover {
    background: var(--hover-light);
  }
  .dialog-devices {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0 0 16px;
    max-height: 50vh;
    overflow-y: auto;
  }
  .dialog-device {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    text-align: left;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-muted);
    color: var(--text-main);
    font: inherit;
    cursor: pointer;
  }
  .dialog-device:hover {
    background: var(--hover-strong);
  }
  .dialog-device-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dialog-device-rssi {
    font-size: 0.82em;
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .dialog-example {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin: 0 0 16px;
  }
  .dialog-example-label {
    font-size: 0.72em;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .dialog-example-url {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.82em;
    color: var(--text-muted);
    background: var(--surface-muted);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    padding: 7px 9px;
    overflow-wrap: anywhere;
    user-select: all;
  }
  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
