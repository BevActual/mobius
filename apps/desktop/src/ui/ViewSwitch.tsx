import { useRef, type KeyboardEvent } from 'react';

export interface ViewChoice<T extends string> { id: T; name: string }

/**
 * The view switch: the views of one app as a segmented control in the toolbar's middle, the current one ink-inverted.
 * Arrow keys move between views, as in any radio group. An app with one view shows no switch.
 */
export function ViewSwitch<T extends string>({ label, views, value, onChange }: { label: string; views: readonly ViewChoice<T>[]; value: T; onChange: (id: T) => void }) {
  const group = useRef<HTMLDivElement>(null);
  if (views.length < 2) return null;
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const by = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!by) return;
    event.preventDefault();
    const at = views.findIndex((v) => v.id === value);
    const next = views[(at + by + views.length) % views.length]!;
    onChange(next.id);
    requestAnimationFrame(() => group.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  };
  return (
    <div ref={group} className="ui-views" role="radiogroup" aria-label={label} onKeyDown={key}>
      {views.map((v) => (
        <button key={v.id} type="button" role="radio" className="ui-view" aria-checked={v.id === value} tabIndex={v.id === value ? 0 : -1} onClick={() => onChange(v.id)}>
          {v.name}
        </button>
      ))}
    </div>
  );
}
