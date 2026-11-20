import type { ReactNode } from 'react';

/*
 * Empty states and the busy mark (docs/design/instrument.md, "Empty state" and "Personality"). An empty view is a
 * small single-weight line drawing in grey ink, one short line, and the New action: it does the teaching, so no tours.
 * The busy mark replaces spinners: a short row of dots that rise and fall like a level meter, in grey, since only
 * Mobius's own work is indigo.
 */

/** The drawings, one per kind of thing, all on the same 112 × 72 grid and line weight. */
export type EmptyKind = 'mail' | 'tasks' | 'notes' | 'calendar' | 'files' | 'search' | 'chats' | 'done' | 'generic';

const DRAWINGS: Record<EmptyKind, ReactNode> = {
  mail: <>
    <rect x="30" y="18" width="52" height="36" rx="4" />
    <path d="m31 21 25 18 25-18" />
    <path d="M18 30h6M14 38h10M18 46h6" data-faint="" />
  </>,
  tasks: <>
    <rect x="34" y="12" width="44" height="50" rx="4" />
    <rect x="41" y="22" width="7" height="7" rx="1.5" /><path d="m42.5 25.5 2 2 3.5-4" />
    <path d="M53 25.5h17" />
    <rect x="41" y="35" width="7" height="7" rx="1.5" /><path d="M53 38.5h13" />
    <rect x="41" y="48" width="7" height="7" rx="1.5" data-faint="" /><path d="M53 51.5h9" data-faint="" />
  </>,
  notes: <>
    <path d="M36 12h30l10 10v40H36z" />
    <path d="M66 12v10h10" />
    <path d="M43 32h26M43 40h26M43 48h16" />
    <path d="m80 50 6-6 4 4-6 6h-4z" data-faint="" />
  </>,
  calendar: <>
    <rect x="30" y="14" width="52" height="46" rx="4" />
    <path d="M30 26h52M42 9v9M70 9v9" />
    <path d="M40 35h4M54 35h4M68 35h4M40 45h4M54 45h4" data-faint="" />
    <rect x="66" y="42" width="8" height="7" rx="1.5" />
  </>,
  files: <>
    <path d="M26 22v32h60V28H56l-5-6z" />
    <path d="M34 22v-6h18l4 6" data-faint="" />
    <path d="M26 30h60" />
  </>,
  search: <>
    <circle cx="50" cy="34" r="16" />
    <path d="m62 46 12 12" />
    <path d="M43 34h14" data-faint="" />
  </>,
  chats: <>
    <path d="M24 18h40a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H40l-9 8v-8h-7a4 4 0 0 1-4-4V22a4 4 0 0 1 4-4z" />
    <path d="M72 30h12a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4h-4v7l-8-7H62" data-faint="" />
    <path d="M30 27h28M30 34h18" />
  </>,
  done: <>
    <circle cx="56" cy="36" r="20" />
    <path d="m46 36 7 7 13-14" />
    <path d="M24 36h8M80 36h8" data-faint="" />
  </>,
  generic: <>
    <rect x="32" y="16" width="48" height="40" rx="4" />
    <path d="M40 28h32M40 36h24M40 44h16" data-faint="" />
  </>,
};

export function EmptyDrawing({ kind }: { kind: EmptyKind }) {
  return <svg className="ui-empty-drawing" viewBox="0 0 112 72" aria-hidden="true">{DRAWINGS[kind]}</svg>;
}

/**
 * What an empty view shows: the drawing, one short line, and its New action. `quiet` is the smaller form at the end of
 * a short list (no drawing).
 */
export function EmptyState({ kind = 'generic', children, action, quiet, className }: {
  kind?: EmptyKind;
  /** One short line: what the view is for, or that it is all done. "That's everything for today." */
  children: ReactNode;
  /** The view's New action, a Button. */
  action?: ReactNode;
  quiet?: boolean;
  className?: string;
}) {
  return (
    <div className={className ? `ui-empty ${className}` : 'ui-empty'} data-quiet={quiet || undefined}>
      {!quiet && <EmptyDrawing kind={kind} />}
      <p className="ui-empty-line">{children}</p>
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  );
}

/**
 * Something is loading or working (not Mobius: its own work is the indigo matrix). A short row of grey dots that rise
 * and fall; still under reduced motion. `label` is read out, and shown beside the dots unless `hideLabel`.
 */
export function Busy({ label, hideLabel, className }: { label: string; hideLabel?: boolean; className?: string }) {
  return (
    <span className={className ? `ui-busy ${className}` : 'ui-busy'} role="status">
      <span className="ui-busy-dots" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <i key={i} style={{ '--i': i } as React.CSSProperties} />)}</span>
      <span className={hideLabel ? 'ui-busy-label sr-only' : 'ui-busy-label'}>{label}</span>
    </span>
  );
}
