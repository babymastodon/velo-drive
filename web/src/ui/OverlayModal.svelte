<script lang="ts">
  // Shared modal chrome: a fixed backdrop overlay that closes when the user
  // clicks/taps the backdrop itself (not the modal contents). Reproduces the
  // legacy pointerdown/pointerup "press started AND ended on the backdrop"
  // gesture so a drag that ends outside doesn't dismiss. The backdrop class is
  // supplied by the caller (e.g. `settings-overlay`) so the re-hosted CSS
  // applies unchanged; the modal contents are the default slot.

  let {
    overlayClass = '',
    overlayId,
    ariaLabel,
    open = false,
    onClose,
    children,
  }: {
    overlayClass?: string;
    overlayId?: string;
    ariaLabel?: string;
    open?: boolean;
    onClose?: () => void;
    children?: import('svelte').Snippet;
  } = $props();

  let overlayEl = $state<HTMLDivElement | null>(null);
  let pointerDownOnBackdrop = false;

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== undefined && e.button !== 0) return;
    pointerDownOnBackdrop = e.target === overlayEl;
  }
  function onPointerUp(e: PointerEvent): void {
    if (pointerDownOnBackdrop && e.target === overlayEl) onClose?.();
    pointerDownOnBackdrop = false;
  }
</script>

{#if open}
  <div
    bind:this={overlayEl}
    id={overlayId}
    class="{overlayClass}"
    style="display: flex"
    role="dialog"
    aria-modal="true"
    aria-label={ariaLabel}
    onpointerdown={onPointerDown}
    onpointerup={onPointerUp}
  >
    {@render children?.()}
  </div>
{/if}
