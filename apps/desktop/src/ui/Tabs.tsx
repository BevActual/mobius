import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { afterPaint } from './frame';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
  /** Shown with a small dot instead of the close until it is saved. */
  unsaved?: boolean;
  /** Mobius changed it and it isn't kept yet: a dashed underline. */
  byMobius?: boolean;
}

/**
 * Content tabs (Instrument, "More elements"), for apps that open several things at once: Browser, Code, Files. Plain
 * text tabs above the content; the open one is ink with a 2px ink underline, the rest grey. Each has a close on hover
 * (and always on the open one). Arrow keys move between tabs, Home and End go to the ends, Delete or Ctrl+W closes the
 * focused tab. Give the content under it `role="tabpanel"` and `aria-labelledby={tabId(id)}`.
 */
export function ContentTabs<T extends string>({ label, tabs, value, onChange, onClose, idPrefix = 'tab', trailing, className }: {
  label: string;
  tabs: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  onClose?: (id: T) => void;
  /** Used for the tabs' element ids, so the content can name its tab. */
  idPrefix?: string;
  /** Controls after the tabs, such as a New tab button. */
  trailing?: ReactNode;
  className?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const focus = (id: T) => afterPaint(() => list.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(id)}"]`)?.focus());
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.findIndex((t) => t.id === value);
    const go = (i: number) => { const next = tabs[(i + tabs.length) % tabs.length]; if (next) { event.preventDefault(); onChange(next.id); focus(next.id); } };
    if (event.key === 'ArrowRight') go(at + 1);
    else if (event.key === 'ArrowLeft') go(at - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(tabs.length - 1);
    else if (onClose && (event.key === 'Delete' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w'))) {
      event.preventDefault();
      onClose(value);
    }
  };
  return (
    <div className={className ? `ui-tabs ${className}` : 'ui-tabs'}>
      <div ref={list} className="ui-tabs-list" role="tablist" aria-label={label} onKeyDown={key}>
        {tabs.map((t) => {
          const on = t.id === value;
          return (
            <div key={t.id} className="ui-tab" data-current={on || undefined} data-by-mobius={t.byMobius || undefined}>
              <button
                type="button"
                role="tab"
                id={`${idPrefix}-${t.id}`}
                data-tab={t.id}
                className="ui-tab-button"
                aria-selected={on}
                tabIndex={on ? 0 : -1}
                title={t.label}
                onClick={() => onChange(t.id)}
                onAuxClick={(e) => { if (e.button === 1 && onClose) { e.preventDefault(); onClose(t.id); } }}
              >
                {t.icon && <span className="ui-tab-icon" aria-hidden="true">{t.icon}</span>}
                <span className="ui-tab-label">{t.label}</span>
              </button>
              {onClose && (
                <button type="button" className="ui-tab-close" tabIndex={-1} aria-label={`Close ${t.label}`} title={`Close ${t.label} (Ctrl+W)`} data-unsaved={t.unsaved || undefined} onClick={() => onClose(t.id)}>
                  <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 3.5l5 5M8.5 3.5l-5 5" /></svg>
                </button>
              )}
            </div>
          );
        })}
      </div>
      {trailing && <div className="ui-tabs-trailing">{trailing}</div>}
    </div>
  );
}

/** The id of a tab's button, for the content's `aria-labelledby`. */
export const tabId = (id: string, idPrefix = 'tab') => `${idPrefix}-${id}`;
