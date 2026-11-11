import type { ReactNode } from 'react';
import { APP_ICONS } from './Rail';

export interface EmptyStateProps {
  /** The app whose icon and colour it shows (an app id, such as `docs`), or an icon of its own. */
  app?: string;
  icon?: ReactNode;
  /** What is missing, in a few words: "No documents yet". */
  title: string;
  /** One line on what to do, or what the app is for. */
  line?: string;
  /** The one action, as "New document". */
  action?: { label: string; run: () => void };
  /** The region's name for screen readers; the title when not given. */
  label?: string;
}

/**
 * What an app shows when there is nothing to show: its icon, a bold title, one grey line, and the one thing to do next,
 * as macOS apps do. Every app uses this one, so empty places look and read the same everywhere.
 */
export function EmptyState({ app, icon, title, line, action, label }: EmptyStateProps) {
  const glyph = icon ?? (app ? APP_ICONS[app] : null);
  const said = shownLine(title, line);
  return (
    <section className="empty-state" aria-label={label ?? title} data-app={app}>
      {glyph && (
        <span className="empty-state-icon" aria-hidden="true" style={app ? { background: `var(--app-${app})` } : undefined}>
          <svg viewBox="0 0 20 20">{glyph}</svg>
        </span>
      )}
      <h2 className="empty-state-title">{title}</h2>
      {said && <p className="empty-state-line">{said}</p>}
      {action && <button type="button" className="btn primary empty-state-action" onClick={action.run}>{action.label}</button>}
    </section>
  );
}

/** With nothing made yet ("No documents yet"), there is nothing on the left to choose: "Choose one on the left, or start a new one." becomes "Start a new one." */
export function shownLine(title: string, line: string | undefined): string | undefined {
  if (!line || !/ yet$/.test(title)) return line;
  const m = /^Choose [^,]* on the left, or (.+)$/.exec(line);
  return m ? m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1) : line;
}
