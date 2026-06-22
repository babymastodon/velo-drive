<script lang="ts">
  // Custom filter dropdown matching the bottom-bar (main-page) drop style: a
  // borderless .inline-clicktoggle trigger + a floating menu with the shared
  // hover shade. Opens downward (fixed-positioned so it can't be clipped by the
  // picker's scroll containers). Used for the library's zone/duration filters.
  interface Option {
    value: string;
    label: string;
    dotClass?: string;
  }
  let {
    value = $bindable(),
    open = $bindable(false),
    options,
    placeholder,
    testid,
    ariaLabel,
  }: {
    value: string;
    open?: boolean;
    options: Option[];
    placeholder: string;
    testid?: string;
    ariaLabel?: string;
  } = $props();

  let rootEl = $state<HTMLElement | null>(null);
  let btnEl = $state<HTMLButtonElement | null>(null);
  let highlightIdx = $state(0);
  let menuPos = $state<{ left: number; top: number; minWidth: number }>({ left: 0, top: 0, minWidth: 0 });

  const allOptions = $derived<Option[]>([{ value: '', label: placeholder }, ...options]);
  const selected = $derived(options.find((o) => o.value === value) ?? null);

  function choose(v: string): void {
    value = v;
    open = false;
    btnEl?.focus();
  }

  // Position + highlight when opening.
  $effect(() => {
    if (!open) return;
    const r = btnEl?.getBoundingClientRect();
    if (r) menuPos = { left: r.left, top: r.bottom + 4, minWidth: r.width };
    const i = allOptions.findIndex((o) => o.value === value);
    highlightIdx = i >= 0 ? i : 0;
  });

  // Outside-click + keyboard while open.
  $effect(() => {
    if (!open) return;
    function onDown(e: Event): void {
      const t = e.target as Node;
      if (rootEl && !rootEl.contains(t) && !(menuEl && menuEl.contains(t))) open = false;
    }
    function onKey(e: KeyboardEvent): void {
      const k = (e.key || '').toLowerCase();
      if (e.key === 'Escape') {
        open = false;
      } else if (k === 'j' || e.key === 'ArrowDown') {
        highlightIdx = Math.min(allOptions.length - 1, highlightIdx + 1);
      } else if (k === 'k' || e.key === 'ArrowUp') {
        highlightIdx = Math.max(0, highlightIdx - 1);
      } else if (e.key === 'Enter') {
        choose(allOptions[highlightIdx]?.value ?? '');
      } else {
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  });

  let menuEl = $state<HTMLElement | null>(null);
</script>

<div class="fd" bind:this={rootEl}>
  <button
    class="fd-btn"
    class:fd-btn-active={!!value}
    type="button"
    bind:this={btnEl}
    data-testid={testid}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={ariaLabel}
    onclick={() => (open = !open)}
  >
    {#if selected?.dotClass}<span class="picker-zone-dot {selected.dotClass}"></span>{/if}
    <span class="fd-label">{selected ? selected.label : placeholder}</span>
    {#if !value}
      <svg class="fd-caret" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
    {/if}
  </button>
  {#if value}
    <button
      class="fd-clear"
      type="button"
      data-testid={testid ? `${testid}-clear` : undefined}
      title="Clear filter"
      aria-label="Clear filter"
      onclick={() => choose('')}
    >
      <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
    </button>
  {/if}
  {#if open}
    <div
      class="fd-menu"
      role="menu"
      bind:this={menuEl}
      style="left: {menuPos.left}px; top: {menuPos.top}px; min-width: {menuPos.minWidth}px;"
    >
      {#each allOptions as o, i (o.value)}
        <button
          class="fd-item"
          class:fd-item-hi={i === highlightIdx}
          type="button"
          role="menuitemradio"
          aria-checked={o.value === value}
          data-value={o.value}
          onmousemove={() => (highlightIdx = i)}
          onclick={() => choose(o.value)}
        >
          {#if o.dotClass}<span class="picker-zone-dot {o.dotClass}"></span>{/if}
          <span>{o.label}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .fd {
    position: relative;
    display: inline-flex;
  }
  /* Bordered like the other library controls; turns solid red (no visible border)
     once a value is selected. The floating menu is the shared/main-page style. */
  .fd-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--nav-control-height);
    padding: 0 30px 0 10px;
    max-width: 12rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text-main);
    font: inherit;
    font-size: var(--font-size-base);
    cursor: pointer;
    transition: var(--interactive-transition);
  }
  .fd-btn:hover {
    background: var(--hover-light);
  }
  .fd-btn-active {
    background: var(--cta-bg);
    color: var(--cta-text);
    border-color: var(--cta-bg);
  }
  .fd-btn-active:hover {
    background: var(--cta-bg-hover);
    border-color: var(--cta-bg-hover);
  }
  .fd-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fd-caret {
    position: absolute;
    right: 9px;
    top: 50%;
    transform: translateY(-50%);
    width: 13px;
    height: 13px;
    color: var(--text-muted);
    pointer-events: none;
  }
  /* Only shown when active (red), so the × is white and does NOT highlight. */
  .fd-clear {
    position: absolute;
    right: 0;
    top: 0;
    height: 100%;
    width: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--cta-text);
    cursor: pointer;
  }
  .fd-clear svg {
    width: 12px;
    height: 12px;
  }
  .fd-menu {
    position: fixed;
    z-index: 60;
    display: flex;
    flex-direction: column;
    padding: 6px;
    gap: 1px;
    max-height: 60vh;
    overflow-y: auto;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  }
  .fd-item {
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
    white-space: nowrap;
    padding: 7px 10px;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: var(--text-main);
    font: inherit;
    cursor: pointer;
  }
  .fd-item-hi,
  .fd-item:hover {
    background: var(--hover-strong);
  }
</style>
