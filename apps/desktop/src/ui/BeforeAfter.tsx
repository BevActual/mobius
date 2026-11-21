import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { IconButton } from './Button';

/**
 * Before and after: hold a button (or a key, M in Photo) to see the original, let go to see the edit. For Photo's
 * Show original, and for anything else that edits content in place (Video's grade, a sound's before and after).
 *
 * - `useHold(key)`: the held state. It owns the key, so holding the key works even when the button has folded into
 *   the toolbar's ⋯ menu, where a row can't be held. It lets go on key up, pointer up, blur and when the window loses
 *   focus, so the original never sticks.
 * - `HoldButton`: the toolbar's icon button for it, pressed while held.
 * - `BeforeAfter`: shows `before` while held and the content otherwise, with a short fade and an "Original" tag in
 *   the corner so a viewer always knows which one is on screen. With no `before`, it only adds the tag (an app that
 *   redraws one canvas itself).
 */

export interface Hold {
  held: boolean;
  /** The key that holds it, as written on the button's tooltip. */
  keys?: string;
  /** Spread on the control that holds it. */
  props: {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onLostPointerCapture: () => void;
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
    onKeyUp: (e: KeyboardEvent<HTMLElement>) => void;
    onBlur: () => void;
  };
}

const typingIn = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
};

/** Held while the pointer is down on the control, Space or Enter is down on it, or `key` is down anywhere (not while typing). */
/** `key` holds the original while pressed; `also` are more keys that do the same (Photo: \\ as in Lightroom). */
export function useHold(key?: string, enabled = true, also: readonly string[] = []): Hold {
  const [held, setHeld] = useState(false);
  const letGo = useRef(() => setHeld(false));
  useEffect(() => {
    if (!enabled) { setHeld(false); return undefined; }
    const release = () => setHeld(false);
    const hidden = () => { if (document.visibilityState !== 'visible') release(); };
    const k = key?.toLowerCase();
    const ks = k ? [k, ...also.map((a) => a.toLowerCase())] : [];
    const down = (e: globalThis.KeyboardEvent) => {
      if (!k || e.repeat || e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target)) return;
      if (ks.includes(e.key.toLowerCase())) setHeld(true);
    };
    const up = (e: globalThis.KeyboardEvent) => { if (ks.includes(e.key.toLowerCase())) release(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [key, enabled, also.join(' ')]);
  const off = letGo.current;
  return {
    held: enabled && held,
    keys: key?.toUpperCase(),
    props: {
      onPointerDown: (e) => {
        if (!enabled || e.button !== 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setHeld(true);
      },
      onPointerUp: off,
      onPointerCancel: off,
      onLostPointerCapture: off,
      onKeyDown: (e) => {
        if (!enabled || (e.key !== ' ' && e.key !== 'Enter')) return;
        e.preventDefault();
        if (!e.repeat) setHeld(true);
      },
      onKeyUp: (e) => { if (e.key === ' ' || e.key === 'Enter') off(); },
      onBlur: off,
    },
  };
}

const COMPARE_ICON = (
  <svg viewBox="0 0 20 20"><path d="M3.5 4.5h13v11h-13zM10 4.5v11M10 8l6.5-3.5M10 12.5l6.5-3.5" /></svg>
);

/** The toolbar button that holds the original: pressed while held, its key on the tooltip. */
export function HoldButton({ hold, label = 'Show original', icon = COMPARE_ICON, disabled, className }: {
  hold: Hold;
  label?: string;
  icon?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <IconButton
      label={label}
      icon={icon}
      keys={hold.keys}
      title={`${label} (hold)`}
      pressed={hold.held}
      disabled={disabled}
      className={className ? `ui-hold ${className}` : 'ui-hold'}
      {...hold.props}
    />
  );
}

/** The content, or `before` while `showing` is true, tagged so a viewer knows which is on screen. */
export function BeforeAfter({ showing, before, children, label = 'Original', className }: {
  showing: boolean;
  /** What it looked like before. Leave out when the app redraws the same surface itself. */
  before?: ReactNode;
  children: ReactNode;
  /** The tag shown on the original. */
  label?: string;
  className?: string;
}) {
  return (
    <div className={className ? `ui-before-after ${className}` : 'ui-before-after'} data-showing={showing ? 'before' : 'after'}>
      {before !== undefined && <div className="ui-ba-layer" data-layer="before" aria-hidden={!showing}>{before}</div>}
      <div className="ui-ba-layer" data-layer="after" aria-hidden={before !== undefined && showing}>{children}</div>
      <span className="ui-ba-tag" role="status">{showing ? label : ''}</span>
    </div>
  );
}
