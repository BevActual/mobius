import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { APPS, appName, isAvailable, type AppId } from './apps';
import { MAX_SHARE, MIN_SHARE, clampShare } from './split';
import { APP_ICONS } from './Rail';

/** The apps that can sit in a pane of split view. */
export const PANE_APPS: readonly AppId[] = APPS.filter((info) => info.available).map((info) => info.id);

interface PaneProps {
  index: 0 | 1;
  app: AppId;
  /** True when the window has two panes. A lone pane has no header. */
  split: boolean;
  focused: boolean;
  onFocus: () => void;
  onChoose: (app: AppId) => void;
  onSwap: () => void;
  onClose: () => void;
  children: ReactNode;
}

/** One side of the work area. In split view it has a small header of its own, so the page view never sits under a control. */
export function Pane({ index, app, split, focused, onFocus, onChoose, onSwap, onClose, children }: PaneProps) {
  const name = appName(app);
  return (
    <section className="pane" data-pane={index} data-focused={(split && focused) || undefined} aria-label={split ? `${index === 0 ? 'Left' : 'Right'} pane: ${name}` : undefined} onPointerDownCapture={onFocus} onFocusCapture={onFocus}>
      {split && (
        <header className="pane-head">
          <div className="pane-apps" role="group" aria-label={`App in the ${index === 0 ? 'left' : 'right'} pane`}>
            {PANE_APPS.filter(isAvailable).map((id) => (
              <button key={id} type="button" className="pane-app" aria-pressed={id === app} aria-label={appName(id)} title={appName(id)} onClick={() => onChoose(id)}>
                <svg viewBox="0 0 20 20" aria-hidden="true" data-app={id}>{APP_ICONS[id]}</svg>
              </button>
            ))}
          </div>
          <span className="pane-name">{name}</span>
          <button type="button" className="pane-btn" aria-label="Swap panes" title="Swap the two panes" onClick={onSwap}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 7h11l-3-3M16 13H5l3 3" /></svg>
          </button>
          <button type="button" className="pane-btn" aria-label={`Close ${name} pane`} title="Close this pane" onClick={onClose}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg>
          </button>
        </header>
      )}
      <div className="pane-body">{children}</div>
    </section>
  );
}

interface DividerProps {
  share: number;
  onDrag: (share: number | null) => void;
  onCommit: (share: number) => void;
}

/** The line between the two panes. Drag it, or focus it and use the arrow keys; double-click puts it back in the middle. */
export function SplitDivider({ share, onDrag, onCommit }: DividerProps) {
  const last = useRef(share);
  const shareAt = (event: PointerEvent<HTMLDivElement>) => {
    const stage = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!stage || stage.width === 0) return share;
    return clampShare((event.clientX - stage.left) / stage.width);
  };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    last.current = share;
    onDrag(share);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    last.current = shareAt(event);
    onDrag(last.current);
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onDrag(null);
    onCommit(last.current);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.05;
    const next = event.key === 'ArrowLeft' ? share - step : event.key === 'ArrowRight' ? share + step : event.key === 'Home' ? MIN_SHARE : event.key === 'End' ? MAX_SHARE : null;
    if (next === null) return;
    event.preventDefault();
    onCommit(clampShare(next));
  };
  return (
    <div
      className="split-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the panes"
      aria-valuemin={MIN_SHARE * 100}
      aria-valuemax={MAX_SHARE * 100}
      aria-valuenow={Math.round(share * 100)}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => onCommit(0.5)}
      onKeyDown={key}
    />
  );
}
