import type { ReactNode } from 'react';

/** One setting: its name, what it does, and its control. The id lets search jump straight to it. */
export function Row({ path, title, description, children, highlight }: { path: string; title: string; description?: string; children?: ReactNode; highlight?: boolean }) {
  return (
    <section className="srow" data-setting={path} {...(highlight ? { 'data-highlight': 'true' } : {})} aria-labelledby={`${path}-title`}>
      <div className="srow-head">
        <h3 id={`${path}-title`} className="srow-title">{title}</h3>
        {description && <p className="srow-desc">{description}</p>}
      </div>
      {children && <div className="srow-body">{children}</div>}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="srow-empty">{children}</p>;
}

/** Loading: grey bars the shape of the rows that are coming, never a spinner (Instrument). */
export function Placeholder({ rows = 3 }: { rows?: number }) {
  return (
    <div className="settings-placeholder" role="status" aria-busy="true">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, i) => <span key={i} className="settings-placeholder-bar" style={{ width: `${[72, 56, 64, 48][i % 4]}%` }} />)}
    </div>
  );
}
