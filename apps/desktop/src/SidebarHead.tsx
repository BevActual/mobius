import { Reorder } from 'motion/react';
import { useRef, useState, type ReactNode } from 'react';
import type { Favourite } from '@mobius/shared';
import { APP_ICONS } from './Rail';
import { newKeys } from './SideNew';
import { afterPaint } from './ui/frame';

interface Props {
  /** What the sidebar belongs to: the open app's name, or Settings. */
  title: string;
  /** The open app's New; none where there is nothing to make, or the app's own list starts with one. */
  create?: { label: string; run: () => void } | undefined;
  /** Notes, task lists and pages pinned by the person, in their order. */
  favourites?: readonly Favourite[];
  onOpenFavourite?: (favourite: Favourite) => void;
  onUnpin?: (favourite: Favourite) => void;
  /** Pinned items in a new order, after a drag or Alt+Up/Down. */
  onReorderFavourites?: (next: Favourite[]) => void;
  /** The pinned item showing now, as `kind:id`. */
  currentFavourite?: string | null;
  /** The app's own sidebar under the head. */
  children?: ReactNode;
}

/**
 * Zone 2 of the frame (docs/design/panel-layouts.md): the app sidebar's head, the same in every app. The app's name,
 * then New, then what the person pinned, then the app's own places.
 */
export function SidebarHead({ title, create, favourites = [], onOpenFavourite, onUnpin, onReorderFavourites, currentFavourite, children }: Props) {
  // Pinned items being dragged: shown in their new order, saved when the drag ends.
  const [pinDrag, setPinDrag] = useState<Favourite[] | null>(null);
  const pinDragged = useRef(false);
  const latestPinDrag = useRef<Favourite[] | null>(null);
  latestPinDrag.current = pinDrag;
  const pinOrder: Favourite[] = pinDrag ?? [...favourites];
  return (
    <div className="app-side">
      <div className="app-side-head">
        <h2 className="app-side-title">{title}</h2>
      </div>
      {create && (
        <button type="button" className="app-side-new" aria-label="Create" title={create.label} onClick={create.run}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" /></svg>
          <span>{create.label}</span>
          <kbd className="side-keys" aria-hidden="true">{newKeys()}</kbd>
        </button>
      )}
      {favourites.length > 0 && (
        <section className="rail-pinned" aria-label="Pinned">
          <h2 className="rail-pinned-title">Pinned</h2>
          <Reorder.Group as="ul" axis="y" role="list" values={pinOrder} onReorder={(next: Favourite[]) => { if (onReorderFavourites) setPinDrag(next); }}>
            {pinOrder.map((fav, at) => {
              const app = fav.kind === 'note' ? 'notes' : fav.kind === 'list' ? 'tasks' : 'browser';
              return (
                <Reorder.Item as="li" key={`${fav.kind}:${fav.id}`} value={fav} className="rail-pin" drag={onReorderFavourites ? 'y' : false} dragListener={Boolean(onReorderFavourites)}
                  onDragStart={() => { pinDragged.current = true; }}
                  onDragEnd={() => { const next = latestPinDrag.current; if (next) onReorderFavourites?.(next); setPinDrag(null); window.setTimeout(() => { pinDragged.current = false; }, 0); }}>
                  <button type="button" className="rail-pin-open" aria-current={currentFavourite === `${fav.kind}:${fav.id}` ? 'page' : undefined} title={fav.kind === 'page' ? `${fav.title}\n${fav.id}` : fav.title}
                    aria-keyshortcuts={onReorderFavourites ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
                    onClick={() => { if (!pinDragged.current) onOpenFavourite?.(fav); }}
                    onKeyDown={onReorderFavourites ? (event) => {
                      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
                      event.preventDefault();
                      const to = at + (event.key === 'ArrowUp' ? -1 : 1);
                      if (to < 0 || to >= favourites.length) return;
                      const next = [...favourites];
                      next.splice(to, 0, next.splice(at, 1)[0]!);
                      onReorderFavourites(next);
                      const button = event.currentTarget;
                      afterPaint(() => button.focus());
                    } : undefined}>
                    <svg viewBox="0 0 20 20" aria-hidden="true" data-app={app}>{APP_ICONS[app]}</svg>
                    <span className="rail-pin-name">{fav.title}</span>
                  </button>
                  {onUnpin && <button type="button" className="rail-pin-remove" aria-label={`Unpin ${fav.title}`} title="Unpin" onClick={() => onUnpin(fav)}>
                    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg>
                  </button>}
                </Reorder.Item>
              );
            })}
          </Reorder.Group>
        </section>
      )}
      <div className="app-side-body">{children}</div>
    </div>
  );
}
