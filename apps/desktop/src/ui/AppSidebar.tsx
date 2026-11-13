import type { MouseEvent, ReactNode } from 'react';

/**
 * An app's sidebar (zone 2), in the same order in every app: Search, the app's places in named sections, From Mobius,
 * More. The shell draws the head above it (the app's name, New, Pinned); the app fills the rest with these pieces.
 */
export function AppSidebar({ label, children }: { /** "<App> sidebar", the name screen readers and tests find it by. */ label: string; children: ReactNode }) {
  return <aside className="side ui-side" aria-label={label}>{children}</aside>;
}

/** The sidebar's search: it narrows the app's own places and items, never all of Mobius. */
export function SidebarSearch({ label, value, onChange, placeholder = 'Search' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <input type="search" className="side-search" aria-label={label} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />;
}

/** A named section of places ("Mailboxes", "Lists"), with at most one small action beside its name (New list). */
export function SidebarSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="ui-side-section" aria-label={title}>
      <div className="side-head">
        <h3 className="side-title">{title}</h3>
        {action && <div className="side-actions">{action}</div>}
      </div>
      <ul role="list" className="ui-side-list">{children}</ul>
    </section>
  );
}

/** One place or item in a section: an icon, its name, a count, and whether it is the one showing. */
export function SidebarRow({ icon, label, count, current = false, proposed = false, onSelect, onContextMenu, title }: {
  icon?: ReactNode;
  label: string;
  /** A small number at the end (unread, to do). Nothing when zero. */
  count?: number;
  current?: boolean;
  /** Mobius made or changed it and the person has not kept it yet: a dashed mark until they decide. */
  proposed?: boolean;
  onSelect: () => void;
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
  title?: string;
}) {
  return (
    <li>
      <button type="button" className="list-row" aria-current={current ? 'page' : undefined} data-proposed={proposed || undefined} title={title} onClick={onSelect} onContextMenu={onContextMenu}>
        {icon}
        <span className="ui-side-name">{label}</span>
        {count ? <span className="list-count">{count}</span> : null}
      </button>
    </li>
  );
}
