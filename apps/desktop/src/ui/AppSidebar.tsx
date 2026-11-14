import { useId, useState, type DOMAttributes, type HTMLAttributes, type MouseEvent, type ReactNode } from 'react';

/**
 * An app's sidebar (zone 2), in the same order in every app: Search, the app's places in named sections, From Mobius,
 * More. The shell draws the head above it (the app's name, New, Pinned); the app fills the rest with these pieces.
 */
export function AppSidebar({ label, children, className, ...rest }: {
  /** "<App> sidebar", the name screen readers and tests find it by. */
  label: string;
  children: ReactNode;
  /** The app's own class, added to the shared ones, for the few rules that are the app's alone. */
  className?: string;
} & Omit<HTMLAttributes<HTMLElement>, 'aria-label' | 'children' | 'className'> & { [data: `data-${string}`]: string | number | boolean | undefined }) {
  return <aside {...rest} className={className ? `side ui-side ${className}` : 'side ui-side'} aria-label={label}>{children}</aside>;
}

/** The sidebar's search: it narrows the app's own places and items, never all of Mobius. */
export function SidebarSearch({ label, value, onChange, placeholder = 'Search' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <input type="search" className="side-search" aria-label={label} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />;
}

/** A named section of places ("Mailboxes", "Lists"), with at most one small action beside its name (New list). */
export function SidebarSection({ title, action, children, foldable = false, open, defaultOpen = true, onToggle }: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  /** The section's name folds it away and back (a notebook, say). */
  foldable?: boolean;
  /** Whether it is open, when the app keeps that itself; otherwise the section remembers it while shown. */
  open?: boolean;
  defaultOpen?: boolean;
  onToggle?: (open: boolean) => void;
}) {
  const [own, setOwn] = useState(defaultOpen);
  const shown = !foldable || (open ?? own);
  const toggle = () => { const next = !shown; if (open === undefined) setOwn(next); onToggle?.(next); };
  return (
    <section className="ui-side-section" aria-label={title} data-folded={foldable && !shown ? true : undefined}>
      <div className="side-head">
        {foldable
          ? <h3 className="side-title"><button type="button" className="ui-side-fold" aria-expanded={shown} onClick={toggle}><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3 7.5 6 4.5 9" /></svg>{title}</button></h3>
          : <h3 className="side-title">{title}</h3>}
        {action && <div className="side-actions">{action}</div>}
      </div>
      {shown && <ul role="list" className="ui-side-list">{children}</ul>}
    </section>
  );
}

/** One place or item in a section: an icon, its name, a count, and whether it is the one showing. */
/** What a row needs to take a drop: the drag handlers, and `data-drop` while something hovers over it. */
export type SidebarRowDrop<T extends Element = HTMLButtonElement> = Pick<DOMAttributes<T>, 'onDragOver' | 'onDragLeave' | 'onDrop'> & { 'data-drop'?: true | undefined };

export function SidebarRow({ icon, label, sub, count, current = false, proposed = false, onSelect, onContextMenu, title, trail, drop }: {
  icon?: ReactNode;
  label: string;
  /** A second, quieter line under the name (a note's first words, a date). */
  sub?: ReactNode;
  /** A small number at the end (unread, to do). Nothing when zero. */
  count?: number;
  current?: boolean;
  /** Mobius made or changed it and the person has not kept it yet: a dashed mark until they decide. */
  proposed?: boolean;
  onSelect: () => void;
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
  title?: string;
  /** Extra controls drawn after the row button, inside the row (a hover Pin, an inline Confirm). */
  trail?: ReactNode;
  /** Files: the row takes a dragged item (a folder row a file can be dropped on). `data-drop` marks it while one hovers. */
  drop?: SidebarRowDrop | undefined;
}) {
  const subId = useId();
  return (
    <li className={trail === undefined ? undefined : 'ui-side-row-trail'}>
      <button
        type="button"
        className="list-row"
        aria-current={current ? 'page' : undefined}
        data-proposed={proposed || undefined}
        title={title}
        // With a sub line, the row is still named by its label alone; the sub line describes it.
        aria-label={sub === undefined ? undefined : label}
        aria-describedby={sub === undefined ? undefined : subId}
        onClick={onSelect}
        onContextMenu={onContextMenu}
        {...drop}
      >
        {icon}
        {sub === undefined
          ? <span className="ui-side-name">{label}</span>
          : <span className="ui-side-text"><span className="ui-side-name">{label}</span><span className="ui-side-sub" id={subId}>{sub}</span></span>}
        {count ? <span className="list-count">{count}</span> : null}
      </button>
      {trail}
    </li>
  );
}
