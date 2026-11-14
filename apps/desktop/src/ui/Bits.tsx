import type { ReactNode } from 'react';

/**
 * Small pieces that show a fact (Instrument, "Controls" and "Colour"): chips, counts, avatars, dots and status text.
 * Colour belongs to the person's content and is only ever a small dot, never a fill; red is the one status colour.
 */

/** The shared palette of content colours (tokens.css `--c-*`), for anything the person colours. */
export type ContentColor = 'amber' | 'yellow' | 'green' | 'teal' | 'blue' | 'violet' | 'pink' | 'coral' | 'stone';
export const CONTENT_COLORS: readonly ContentColor[] = ['amber', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink', 'coral', 'stone'];

/** A small round dot: a content colour (a list, a calendar, a label) or `red` for something overdue or failed. */
export function Dot({ color, label }: { color: ContentColor | 'red' | 'ink' | 'mobius'; label?: string }) {
  return <span className="ui-dot" data-tone={color} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

/**
 * A label or tag: an outlined pill with a small colour dot and grey text. One look in lists and in running text. With
 * `onRemove` it has a small × (in a field of tags); with `onClick` the whole chip is a button (a filter).
 */
export function Chip({ children, color, onClick, onRemove, pressed, className }: {
  children: ReactNode;
  color?: ContentColor;
  onClick?: () => void;
  onRemove?: () => void;
  /** A filter chip that is on. */
  pressed?: boolean;
  className?: string;
}) {
  const body = (
    <>
      {color && <Dot color={color} />}
      <span className="ui-chip-text">{children}</span>
    </>
  );
  const cls = className ? `ui-chip ${className}` : 'ui-chip';
  return onClick ? (
    <button type="button" className={cls} aria-pressed={pressed} onClick={onClick}>{body}</button>
  ) : (
    <span className={cls}>
      {body}
      {onRemove && (
        <button type="button" className="ui-chip-x" aria-label={`Remove ${typeof children === 'string' ? children : 'tag'}`} onClick={onRemove}>
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 3.5l5 5M8.5 3.5l-5 5" /></svg>
        </button>
      )}
    </span>
  );
}

/** A plain grey number at the trailing edge of a row, in tabular figures. Never a badge. Nothing shows for zero. */
export function Count({ n, label, max = 999, className }: { n: number; label?: string; max?: number; className?: string }) {
  if (!n) return null;
  return <span className={className ? `ui-count ${className}` : 'ui-count'} aria-label={label ? `${n} ${label}` : undefined}>{n > max ? `${max}+` : n}</span>;
}

/**
 * A grey status letter or short code in the mono face (Code's M, A, D, U; a file's state), with its meaning as the
 * tooltip. `tone="red"` only for a conflict or a failure.
 */
export function StatusLetter({ letter, meaning, tone }: { letter: string; meaning: string; tone?: 'red' }) {
  return <span className="ui-letter" data-tone={tone} title={meaning} aria-label={meaning}>{letter}</span>;
}

/** Initials from a name: "Ada Lovelace" is AL, "ada@example.com" is A. */
export function initials(name: string): string {
  const words = name.replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]![0], words[words.length - 1]![0]] : [words[0]?.[0]];
  return letters.filter(Boolean).join('').toUpperCase();
}

/** A person: a grey circle with their initials, or their photo. The name is the tooltip and accessible name. */
export function Avatar({ name, src, size, className }: { name: string; src?: string; size?: 'row' | 'large'; className?: string }) {
  return (
    <span className={className ? `ui-avatar ${className}` : 'ui-avatar'} data-size={size === 'large' ? 'large' : undefined} role="img" aria-label={name} title={name}>
      {src ? <img src={src} alt="" /> : initials(name)}
    </span>
  );
}

/**
 * Status in words: "Connected", "Key saved", "Last synced 2 min ago". Grey text with no dot, because a calm state needs
 * no colour. Only a problem gets a mark: `problem` shows a red dot and ink text, the one plain sentence of what is
 * wrong and what to do.
 */
export function StatusText({ children, problem, className }: { children: ReactNode; problem?: boolean; className?: string }) {
  return (
    <span className={className ? `ui-status ${className}` : 'ui-status'} data-problem={problem || undefined} role={problem ? 'alert' : undefined}>
      {problem && <Dot color="red" />}
      {children}
    </span>
  );
}
