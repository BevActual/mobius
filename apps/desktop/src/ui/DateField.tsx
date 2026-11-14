import { Popover as BasePopover } from '@base-ui/react/popover';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { dayLabel, longDateLabel, monthLabel, timeLabel, weekdayLabel, weekStart } from '../dates';
import { growFrom } from '../motion';
import { IconButton } from './Button';
import { KeyCaps } from './Tooltip';
import {
  DAY_MINUTES, addDays, addMonths, atTime, lengthLabel, minutesOf, monthGrid, nextWeek, parseDate, parseTime, sameDay, startOfDay,
} from './dateText';

/**
 * Date and time fields (Instrument, "Controls"). The date field shows its day in words ("Thu 20 Nov") and opens a
 * 280px popover downward: a line to type into ("tomorrow", "fri 3pm"), quick picks with their keys and the day each
 * means in grey, then the month. Today is an ink badge, the chosen day a grey fill. Arrows move by day, Page Up and
 * Down by month, T goes to today. The time field takes typing ("9:30", "3pm") and lists quarter hours scrolled to the
 * time (or now); as an end time it shows each time's length from the start in grey. Week start, day and month order
 * and the 12 or 24 hour clock come from the shared date helpers (dates.ts). A day or time Mobius proposed has the
 * dashed edge.
 */

const CHEVRON_LEFT = <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>;
const CHEVRON_RIGHT = <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>;
const CALENDAR = (
  <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></svg>
);
const CLOCK = <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3.25l2 1.25" /></svg>;

const useGrow = () => useCallback((node: HTMLElement | null) => { if (node) growFrom(node, 'left'); }, []);

export interface QuickPick {
  label: string;
  /** The single key that picks it while the month has focus. */
  keys: string;
  day: (now: Date) => Date | null;
}

const QUICK: readonly QuickPick[] = [
  { label: 'Today', keys: 'T', day: (now) => startOfDay(now) },
  { label: 'Tomorrow', keys: 'M', day: (now) => addDays(startOfDay(now), 1) },
  { label: 'Next week', keys: 'W', day: (now) => nextWeek(now) },
  { label: 'No date', keys: 'Backspace', day: () => null },
];

/** "Thu 20 Nov", or "Thu 20 Nov, 15:00" with a time. */
export function dateWords(day: Date, time: number | null = null, now: Date = new Date()): string {
  const words = dayLabel(day, { weekday: 'short', now });
  return time === null ? words : `${words}, ${timeLabel(atTime(day, time))}`;
}

/**
 * A month to pick a day from: the month name with previous and next, grey weekday letters, then six weeks of days.
 * Used inside the date field; a sidebar can show it on its own.
 */
export function MonthPicker({ value, onPick, now = new Date(), month: shown, onMonthChange, label = 'Choose a day', autoFocus }: {
  value: Date | null;
  onPick: (day: Date) => void;
  now?: Date;
  /** The month on show (controlled). */
  month?: Date;
  onMonthChange?: (month: Date) => void;
  label?: string;
  autoFocus?: boolean;
}) {
  const first = useMemo(() => weekStart(), []);
  const [ownMonth, setOwnMonth] = useState(() => startOfDay(value ?? now));
  const month = shown ?? ownMonth;
  const setMonth = (next: Date) => { setOwnMonth(next); onMonthChange?.(next); };
  const [active, setActive] = useState<Date>(() => startOfDay(value ?? now));
  const grid = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const days = monthGrid(month, first);
  const heading = useId();

  useEffect(() => {
    if (!moved.current && !autoFocus) return;
    moved.current = false;
    grid.current?.querySelector<HTMLButtonElement>('[data-active]')?.focus();
  }, [active, autoFocus]);

  const go = (day: Date) => {
    moved.current = true;
    setActive(day);
    if (day.getMonth() !== month.getMonth() || day.getFullYear() !== month.getFullYear()) setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
  };

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const by = step[e.key];
    if (by !== undefined) go(addDays(active, by));
    else if (e.key === 'PageUp' || e.key === 'PageDown') {
      const target = addMonths(active, e.key === 'PageUp' ? -1 : 1);
      const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      go(new Date(target.getFullYear(), target.getMonth(), Math.min(active.getDate(), last)));
    } else if (e.key === 'Home') go(addDays(active, -((active.getDay() - first + 7) % 7)));
    else if (e.key === 'End') go(addDays(active, 6 - ((active.getDay() - first + 7) % 7)));
    else if (e.key.toLowerCase() === 't' && !e.ctrlKey && !e.metaKey && !e.altKey) go(startOfDay(now));
    else if (e.key === 'Enter' || e.key === ' ') onPick(active);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="ui-month" role="group" aria-labelledby={heading}>
      <div className="ui-month-head">
        <span id={heading} className="ui-month-name" aria-live="polite">{monthLabel(month)}</span>
        <IconButton label="Previous month" keys="Page Up" icon={CHEVRON_LEFT} onClick={() => setMonth(addMonths(month, -1))} />
        <IconButton label="Next month" keys="Page Down" icon={CHEVRON_RIGHT} onClick={() => setMonth(addMonths(month, 1))} />
      </div>
      <div ref={grid} className="ui-month-grid" role="grid" aria-label={label} onKeyDown={key}>
        <div className="ui-month-row" role="row">
          {days.slice(0, 7).map((d) => (
            <span key={d.getDay()} className="ui-month-weekday" role="columnheader" aria-label={weekdayLabel(d, 'long')}>
              {weekdayLabel(d, 'narrow')}
            </span>
          ))}
        </div>
        {[0, 1, 2, 3, 4, 5].map((week) => (
          <div key={week} className="ui-month-row" role="row">
            {days.slice(week * 7, week * 7 + 7).map((d) => {
              const isActive = sameDay(d, active);
              const chosen = value !== null && sameDay(d, value);
              return (
                <span key={d.getTime()} role="gridcell" aria-selected={chosen}>
                  <button
                    type="button"
                    className="ui-day"
                    tabIndex={isActive ? 0 : -1}
                    data-active={isActive || undefined}
                    data-chosen={chosen || undefined}
                    data-today={sameDay(d, now) || undefined}
                    data-outside={d.getMonth() !== month.getMonth() || undefined}
                    aria-current={sameDay(d, now) ? 'date' : undefined}
                    aria-label={longDateLabel(d)}
                    onClick={() => { setActive(d); onPick(d); }}
                  >
                    {d.getDate()}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface DateFieldProps {
  label: string;
  hideLabel?: boolean;
  /** The day (its time of day is kept), or null for no date. */
  value: Date | null;
  /** The new day, and the time when one was typed ("fri 3pm"). */
  onChange: (day: Date | null, time: number | null) => void;
  /** Also show the time of `value` in the field. */
  showTime?: boolean;
  /** Mobius proposed this date: the dashed edge until it is kept. */
  proposed?: boolean;
  placeholder?: string;
  disabled?: boolean;
  /** For tests and the reference sheet: what "today" is. */
  now?: Date;
  /** Quick picks in place of Today, Tomorrow, Next week and No date. */
  quick?: readonly QuickPick[];
  className?: string;
}

export function DateField({ label, hideLabel, value, onChange, showTime, proposed, placeholder = 'No date', disabled, now: given, quick = QUICK, className }: DateFieldProps) {
  const now = useMemo(() => given ?? new Date(), [given]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const typed = useRef<HTMLInputElement>(null);
  const grow = useGrow();
  const popup = useRef<HTMLDivElement | null>(null);
  const setPopup = useCallback((node: HTMLDivElement | null) => { popup.current = node; grow(node); }, [grow]);
  const labelId = useId();
  const read = text.trim() === '' ? null : parseDate(text, now);

  const pick = (day: Date | null, time: number | null = null) => {
    const kept = day && value && time === null ? atTime(day, minutesOf(value)) : day && time !== null ? atTime(day, time) : day;
    onChange(kept, time);
    setOpen(false);
  };

  const quickKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target === typed.current || e.ctrlKey || e.metaKey || e.altKey) return;
    const hit = quick.find((q) => q.keys.toLowerCase() === e.key.toLowerCase());
    if (hit) { e.preventDefault(); pick(hit.day(now)); return; }
    if (e.key === 'Delete') { e.preventDefault(); pick(null); return; }
    // Any other letter or figure starts typing a date.
    if (e.key.length === 1 && /[\p{L}\p{N}]/u.test(e.key) ) {
      e.preventDefault();
      setText(e.key);
      typed.current?.focus();
    }
  };

  return (
    <div className={className ? `ui-field ui-date-field ${className}` : 'ui-field ui-date-field'}>
      <span id={labelId} className="ui-field-label" data-hidden={hideLabel || undefined}>{label}</span>
      <BasePopover.Root open={open} onOpenChange={(next) => { setOpen(next); if (next) setText(''); }}>
        <BasePopover.Trigger
          className="ui-field-box ui-date-trigger"
          disabled={disabled}
          aria-labelledby={labelId}
          data-proposed={proposed || undefined}
          data-empty={value === null || undefined}
        >
          <span className="ui-date-value">{value ? dateWords(value, showTime ? minutesOf(value) : null, now) : placeholder}</span>
          <span className="ui-date-icon" aria-hidden="true">{CALENDAR}</span>
        </BasePopover.Trigger>
        <BasePopover.Portal>
          <BasePopover.Positioner className="ui-menu-positioner" side="bottom" align="start" sideOffset={4} collisionPadding={8}>
            <BasePopover.Popup ref={setPopup} className="ui-popover ui-date-popover glass" aria-label={label} onKeyDown={quickKey} initialFocus={() => popup.current?.querySelector<HTMLElement>('.ui-day[data-active]') ?? true}>
              <div className="ui-date-type">
                <input
                  ref={typed}
                  className="ui-field-input"
                  aria-label="Type a date"
                  placeholder="Type a date: fri 3pm"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && read) { e.preventDefault(); pick(read.date, read.time); }
                    if (e.key === 'ArrowDown') { e.preventDefault(); typed.current?.closest('.ui-date-popover')?.querySelector<HTMLButtonElement>('.ui-day[data-active]')?.focus(); }
                  }}
                />
                {text.trim() !== '' && (
                  <span className="ui-date-read" aria-live="polite">
                    {read ? (read.date ? dateWords(read.date, read.time, now) : 'No date') : 'Not a date yet'}
                  </span>
                )}
              </div>
              <div className="ui-date-quick" role="group" aria-label="Quick picks">
                {quick.map((q) => {
                  const day = q.day(now);
                  return (
                    <button key={q.label} type="button" className="ui-date-pick" onClick={() => pick(day)}>
                      <span className="ui-date-pick-label">{q.label}</span>
                      <span className="ui-date-pick-day">{day ? dayLabel(day, { weekday: 'short', now }) : ''}</span>
                      <KeyCaps className="ui-menu-keys" keys={q.keys} />
                    </button>
                  );
                })}
              </div>
              <MonthPicker value={value} now={now} onPick={(d) => pick(d)} />
            </BasePopover.Popup>
          </BasePopover.Positioner>
        </BasePopover.Portal>
      </BasePopover.Root>
    </div>
  );
}

export interface TimeFieldProps {
  label: string;
  hideLabel?: boolean;
  /** Minutes since midnight, or null for no time. */
  value: number | null;
  onChange: (minutes: number | null) => void;
  /** For an end time: the start, so each listed time shows its length ("1 hr") and the list begins there. */
  from?: number | null;
  proposed?: boolean;
  placeholder?: string;
  disabled?: boolean;
  /** For tests and the reference sheet: what "now" is, which the list scrolls to when there is no time. */
  now?: Date;
  className?: string;
}

const QUARTERS = Array.from({ length: DAY_MINUTES / 15 }, (_, i) => i * 15);
const clockWords = (minutes: number): string => timeLabel(atTime(new Date(2026, 0, 1), ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES));

export function TimeField({ label, hideLabel, value, onChange, from = null, proposed, placeholder = 'No time', disabled, now: given, className }: TimeFieldProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const grow = useGrow();
  const choices = from === null ? QUARTERS : QUARTERS.map((q) => from + 15 + q).filter((m) => m <= from + DAY_MINUTES - 15);
  const shown = text ?? (value === null ? '' : clockWords(value));
  const nowMinutes = minutesOf(given ?? new Date());

  // Scroll the list to the time (or the quarter hour after now) as it opens.
  useEffect(() => {
    if (!open) return;
    const target = highlight ?? value ?? choices.find((m) => m % DAY_MINUTES >= nowMinutes) ?? choices[0];
    const frame = requestAnimationFrame(() => {
      const row = list.current?.querySelector<HTMLElement>(`[data-minutes="${target}"]`);
      if (row && list.current) list.current.scrollTop = row.offsetTop - list.current.clientHeight / 2 + row.offsetHeight / 2;
    });
    return () => cancelAnimationFrame(frame);
    // Only on opening, and when the highlight moves by key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, highlight]);

  const commit = (minutes: number | null) => {
    onChange(minutes === null ? null : ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES);
    setText(null);
    setHighlight(null);
    setOpen(false);
  };

  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      const at = choices.indexOf(highlight ?? value ?? -1);
      const next = at < 0 ? (choices.find((m) => m % DAY_MINUTES >= nowMinutes) ?? choices[0]) : choices[Math.max(0, Math.min(choices.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
      setHighlight(next ?? null);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && highlight !== null) commit(highlight);
      else if (text !== null) {
        if (text.trim() === '') commit(null);
        else {
          const read = parseTime(text);
          if (read !== null) commit(from !== null && read < from ? read + DAY_MINUTES : read);
        }
      }
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
      setHighlight(null);
    }
  };

  const typedRead = text === null || text.trim() === '' ? null : parseTime(text);

  return (
    <div className={className ? `ui-field ui-time-field ${className}` : 'ui-field ui-time-field'} data-invalid={text !== null && text.trim() !== '' && typedRead === null ? true : undefined}>
      <label className="ui-field-label" htmlFor={id} data-hidden={hideLabel || undefined}>{label}</label>
      <div ref={box} className="ui-field-box" data-proposed={proposed || undefined}>
        <input
          ref={input}
          id={id}
          className="ui-field-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-activedescendant={open && highlight !== null ? `${id}-${highlight}` : undefined}
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          value={shown}
          onChange={(e) => { setText(e.target.value); setOpen(true); const read = parseTime(e.target.value); setHighlight(read === null ? null : choices.find((m) => m % DAY_MINUTES >= read) ?? null); }}
          onFocus={(e) => e.currentTarget.select()}
          onClick={() => setOpen(true)}
          onKeyDown={key}
          onBlur={() => {
            if (text === null) return;
            if (text.trim() === '') commit(null);
            else if (typedRead !== null) commit(from !== null && typedRead < from ? typedRead + DAY_MINUTES : typedRead);
          }}
        />
        {from !== null && value !== null && <span className="ui-field-unit">{lengthLabel(((value - from) % DAY_MINUTES + DAY_MINUTES) % DAY_MINUTES)}</span>}
        <span className="ui-date-icon" aria-hidden="true">{CLOCK}</span>
      </div>
      <BasePopover.Root open={open && !disabled} onOpenChange={(next, details) => { if (!next && details.event?.target !== input.current) { setOpen(false); setHighlight(null); } }}>
        <BasePopover.Portal>
          <BasePopover.Positioner className="ui-menu-positioner" anchor={box} side="bottom" align="start" sideOffset={4} collisionPadding={8}>
            <BasePopover.Popup ref={grow} className="ui-menu ui-time-menu glass" initialFocus={false} finalFocus={false}>
              <div ref={list} id={`${id}-list`} role="listbox" aria-label={label} className="ui-time-list">
                {choices.map((m) => (
                  <div
                    key={m}
                    id={`${id}-${m}`}
                    role="option"
                    aria-selected={value !== null && m % DAY_MINUTES === value}
                    data-minutes={m}
                    data-highlighted={highlight === m || undefined}
                    className="ui-menu-item ui-time-option"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => commit(m)}
                  >
                    <span className="ui-menu-label">{clockWords(m)}</span>
                    {from !== null && <span className="ui-time-length">{lengthLabel(m - from)}</span>}
                  </div>
                ))}
              </div>
            </BasePopover.Popup>
          </BasePopover.Positioner>
        </BasePopover.Portal>
      </BasePopover.Root>
    </div>
  );
}

/**
 * A start and an end time side by side. Moving the start moves the end with it, keeping the length; the end shows the
 * length in grey.
 */
export function TimeRange({ label = 'Time', start, end, onChange, proposed, disabled, now }: {
  label?: string;
  start: number | null;
  end: number | null;
  onChange: (start: number | null, end: number | null) => void;
  proposed?: boolean;
  disabled?: boolean;
  now?: Date;
}) {
  const length = start !== null && end !== null ? ((end - start) % DAY_MINUTES + DAY_MINUTES) % DAY_MINUTES : 60;
  return (
    <div className="ui-time-range" role="group" aria-label={label}>
      <TimeField
        label="Starts"
        hideLabel
        value={start}
        proposed={proposed}
        disabled={disabled}
        now={now}
        onChange={(next) => onChange(next, next === null ? end : (next + length) % DAY_MINUTES)}
      />
      <span className="ui-time-to" aria-hidden="true">–</span>
      <TimeField label="Ends" hideLabel value={end} from={start} proposed={proposed} disabled={disabled} now={now} onChange={(next) => onChange(start, next)} />
    </div>
  );
}
