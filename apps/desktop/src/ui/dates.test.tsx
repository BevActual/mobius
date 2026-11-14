import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { dayMonthOrder, setLocaleForTests, uses12Hour, weekStart } from '../dates';
import { DateField, MonthPicker, TimeField, dateWords } from './DateField';
import { lengthLabel, monthGrid, nextWeek, parseDate, parseTime } from './dateText';

// Saturday 14 November 2026, 10:05.
const NOW = new Date(2026, 10, 14, 10, 5);
const day = (d: Date | null | undefined) => (d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : String(d));
const read = (text: string, order: 'dm' | 'md' = 'dm') => {
  const r = parseDate(text, NOW, { order, weekStart: 1 });
  return r ? `${day(r.date)}${r.time === null ? '' : ` ${r.time}`}` : null;
};

afterEach(() => setLocaleForTests(null));

describe('reading typed times', () => {
  it('takes the ways people write a time', () => {
    expect(parseTime('9')).toBe(540);
    expect(parseTime('9:30')).toBe(570);
    expect(parseTime('0930')).toBe(570);
    expect(parseTime('3pm')).toBe(900);
    expect(parseTime('3.15 PM')).toBe(915);
    expect(parseTime('12am')).toBe(0);
    expect(parseTime('12pm')).toBe(720);
    expect(parseTime('15:30')).toBe(930);
    expect(parseTime('noon')).toBe(720);
  });
  it('refuses what is not a time', () => {
    for (const bad of ['', '25', '9:75', '13pm', 'soon']) expect(parseTime(bad)).toBeNull();
  });
});

describe('reading typed dates', () => {
  it('reads words for nearby days', () => {
    expect(read('today')).toBe('2026-11-14');
    expect(read('tomorrow')).toBe('2026-11-15');
    expect(read('next week')).toBe('2026-11-16');
    expect(read('in 3 days')).toBe('2026-11-17');
    expect(read('2w')).toBe('2026-11-28');
    expect(read('none')).toBe('null');
  });
  it('reads a weekday as the next one, today counting, and "next" skipping today', () => {
    expect(read('fri')).toBe('2026-11-20');
    expect(read('sat')).toBe('2026-11-14');
    expect(read('next sat')).toBe('2026-11-21');
    expect(read('mon')).toBe('2026-11-16');
  });
  it('reads a time at the end', () => {
    expect(read('fri 3pm')).toBe('2026-11-20 900');
    expect(read('tomorrow at 9:30')).toBe('2026-11-15 570');
    expect(read('20 nov 14:00')).toBe('2026-11-20 840');
    expect(read('3pm')).toBe('2026-11-14 900');
  });
  it('reads written and numeric dates, the next time a day comes round, in the computer’s order', () => {
    expect(read('20 nov')).toBe('2026-11-20');
    expect(read('nov 20')).toBe('2026-11-20');
    expect(read('3 jan')).toBe('2027-1-3');
    expect(read('20 november 2027')).toBe('2027-11-20');
    expect(read('2026-12-01')).toBe('2026-12-1');
    expect(read('5/12')).toBe('2026-12-5');
    expect(read('5/12', 'md')).toBe('2027-5-12');
    expect(read('31 feb')).toBeNull();
    expect(read('banana')).toBeNull();
  });
});

describe('the month grid', () => {
  it('shows six weeks from the week start', () => {
    const monday = monthGrid(new Date(2026, 10, 1), 1);
    expect(monday).toHaveLength(42);
    expect(day(monday[0])).toBe('2026-10-26');
    const sunday = monthGrid(new Date(2026, 10, 1), 0);
    expect(day(sunday[0])).toBe('2026-11-1');
    expect(day(nextWeek(NOW, 0))).toBe('2026-11-15');
  });
  it('marks today with an ink badge and the chosen day, and labels each day in full', () => {
    setLocaleForTests('en-GB');
    const html = renderToStaticMarkup(<MonthPicker value={new Date(2026, 10, 20)} onPick={() => {}} now={NOW} />);
    expect(html).toContain('November 2026');
    expect(html).toMatch(/data-chosen="true"[^>]*aria-label="Friday,? 20 November 2026"/);
    expect(html).toMatch(/data-today="true"[^>]*aria-current="date"[^>]*aria-label="Saturday,? 14 November 2026"/);
    expect(html.match(/role="gridcell"/g)).toHaveLength(42);
    expect(html).toMatch(/tabindex="0"[^>]*aria-label="Friday,? 20 November 2026"/);
  });
});

describe('date and time fields', () => {
  it('writes the day in words, with the dashed edge when Mobius proposed it', () => {
    setLocaleForTests('en-GB');
    expect(dateWords(new Date(2026, 10, 20), null, NOW)).toBe('Fri 20 Nov');
    expect(dateWords(new Date(2026, 10, 20), 900, NOW)).toBe('Fri 20 Nov, 15:00');
    const html = renderToStaticMarkup(<DateField label="Due" value={new Date(2026, 10, 20)} onChange={() => {}} proposed now={NOW} />);
    expect(html).toContain('Fri 20 Nov');
    expect(html).toContain('data-proposed="true"');
    expect(renderToStaticMarkup(<DateField label="Due" value={null} onChange={() => {}} now={NOW} />)).toContain('No date');
  });
  it('shows an end time’s length beside it', () => {
    setLocaleForTests('en-GB');
    const html = renderToStaticMarkup(<TimeField label="Ends" value={870} from={780} onChange={() => {}} />);
    expect(html).toContain('value="14:30"');
    expect(html).toContain('1 hr 30 min');
    expect(html).toContain('role="combobox"');
    expect(lengthLabel(45)).toBe('45 min');
    expect(lengthLabel(120)).toBe('2 hr');
  });
  it('takes the week start, day order and clock from the computer', () => {
    setLocaleForTests('en-US');
    expect(weekStart()).toBe(0);
    expect(dayMonthOrder()).toBe('md');
    expect(uses12Hour()).toBe(true);
    setLocaleForTests('en-GB');
    expect(weekStart()).toBe(1);
    expect(dayMonthOrder()).toBe('dm');
    expect(uses12Hour()).toBe(false);
  });
});
