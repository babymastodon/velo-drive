// dom-utils.ts
//
// Small shared DOM helpers for the UI layer.

// Returns true when the given event target is an editable form control or a
// contenteditable element — i.e. a place where the user is typing, so global
// hotkeys / keymaps should NOT fire.
//
// This is the de-duplicated superset of the four previously-divergent copies
// (App.svelte `isEditable`, PlannerView/BuilderView, and the inline PickerView
// guard): INPUT / TEXTAREA / SELECT tags plus contenteditable. The PickerView
// copy had drifted to omit the contenteditable check, but the picker has no
// contenteditable elements, so adopting the superset is behavior-preserving
// while keeping every other call site identical.
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable
  );
}
