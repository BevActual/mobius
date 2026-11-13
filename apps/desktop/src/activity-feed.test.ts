import { describe, expect, it } from 'vitest';
import type { ActivityEntry } from '@mobius/shared';
import { appOfCapability, appsIn, byDay, byWho, dayLabel, feedOf, inPlace, isFinal, matches } from './activity-feed';

const at = new Date(2026, 10, 12, 18, 0).getTime();
let seq = 0;
const entry = (kind: string, capability: string | null, resource: string | null = null, who: string | null = 'agent', tsMs = at): ActivityEntry => ({ seq: ++seq, tsMs, kind, capability, resource, tool: null, who });

describe('the Activity feed', () => {
  it('says what a finished tool did, in the app it belongs to', () => {
    const [item] = feedOf([entry('tool.completed', 'browser.navigate', 'axion.example')]);
    expect(item).toMatchObject({ text: 'Opened axion.example', app: 'browser', by: 'mobius', final: false, warn: false });
  });

  it('leaves out starts, already-given approvals and answered questions', () => {
    const items = feedOf([
      entry('permission.asked', 'mail.send'),
      entry('permission.approved', 'mail.send', 'sam@northway.example', 'person'),
      entry('permission.allowed', 'mail.send'),
      entry('tool.started', 'mail.send'),
      entry('tool.completed', 'mail.send', 'Sam Okafor'),
    ]);
    expect(items.map((i) => i.text)).toEqual(['Sent an email to Sam Okafor', 'You let Mobius send email (sam@northway.example)']);
    expect(items[1]!.by).toBe('you');
  });

  it('marks only failures as gone wrong; a refusal is the rules working', () => {
    const items = feedOf([entry('tool.failed', 'net.http_get', 'veltro.example'), entry('permission.denied', 'files.delete', 'Old quotes')]);
    expect(items.find((i) => i.text.startsWith('Couldn’t'))!.warn).toBe(true);
    expect(items.find((i) => i.text.startsWith('Your rules'))!.warn).toBe(false);
  });

  it('falls back to the tool’s name for a capability it does not know', () => {
    expect(feedOf([{ ...entry('tool.completed', 'demo.echo'), tool: 'echo' }])[0]!.text).toBe('Used echo');
  });

  it('puts a changed file in the app it belongs to, by its name there', () => {
    const [sheet, note, plain] = feedOf([
      entry('tool.completed', 'files.write', 'sheets/P2 budget/Sheet 1.csv', 'agent', at),
      entry('tool.completed', 'files.write', 'notes/P2 build/Supplier notes.md', 'agent', at - 1),
      entry('tool.completed', 'files.write', 'Downloads/quote.pdf', 'agent', at - 2),
    ]);
    expect(sheet).toMatchObject({ app: 'sheets', text: 'Changed P2 budget / Sheet 1' });
    expect(note).toMatchObject({ app: 'notes', text: 'Changed P2 build / Supplier notes' });
    expect(plain).toMatchObject({ app: 'files', text: 'Changed Downloads/quote.pdf' });
  });

  it('lists newest first', () => {
    const items = feedOf([entry('tool.completed', 'mail.read', null, 'agent', at - 1000), entry('tool.completed', 'calendar.read', null, 'agent', at)]);
    expect(items.map((i) => i.app)).toEqual(['calendar', 'mail']);
  });
});

describe('what cannot be undone', () => {
  it('is sending, paying, deleting and running commands', () => {
    for (const c of ['mail.send', 'payments.pay', 'files.delete', 'fs.delete', 'code.run', 'code.push', 'terminal.exec']) expect(isFinal(c)).toBe(true);
    for (const c of ['mail.draft', 'files.write', 'browser.navigate', null]) expect(isFinal(c)).toBe(false);
  });
});

describe('filters', () => {
  const items = feedOf([
    entry('tool.completed', 'mail.send', 'Sam'),
    entry('permission.approved', 'mail.send', null, 'person'),
    entry('tool.completed', 'browser.read', 'a page'),
    entry('tool.completed', 'clock.read'),
  ]);
  it('narrow by who, by app, and to what cannot be undone', () => {
    expect(items.filter((i) => matches(i, 'mobius'))).toHaveLength(3);
    expect(items.filter((i) => matches(i, 'you'))).toHaveLength(1);
    expect(items.filter((i) => matches(i, 'final'))).toHaveLength(2);
    expect(items.filter((i) => matches(i, 'app:browser'))).toHaveLength(1);
    expect(items.filter((i) => matches(i, 'needs'))).toHaveLength(0);
  });
  it('count apps, most first, and leave Mobius’s own steps out of By app', () => {
    expect(appsIn(items)).toEqual([{ app: 'mail', count: 2 }, { app: 'browser', count: 1 }]);
    expect(appOfCapability('clock.read')).toBeNull();
  });
});

describe('days', () => {
  const now = new Date(2026, 10, 12, 18, 0);
  it('read Today, Yesterday, a weekday, then a date', () => {
    expect(dayLabel(now.getTime(), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 10, 11, 23, 0).getTime(), now)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 10, 9, 9, 0).getTime(), now)).toBe('Monday');
    expect(dayLabel(new Date(2026, 9, 1).getTime(), now)).toBe('October 1');
    expect(dayLabel(new Date(2025, 9, 1).getTime(), now)).toBe('October 1, 2025');
  });
  it('group the feed a day at a time', () => {
    const items = feedOf([entry('tool.completed', 'mail.read', null, 'agent', now.getTime()), entry('tool.completed', 'mail.read', null, 'agent', now.getTime() - 86_400_000)]);
    expect(byDay(items, now).map((d) => [d.label, d.items.length])).toEqual([['Today', 1], ['Yesterday', 1]]);
  });
});

describe('places and who', () => {
  const now = new Date(2026, 10, 12, 18, 0);
  const at = (days: number) => now.getTime() - days * 86_400_000;
  const items = feedOf([
    { ...entry('tool.completed', 'mail.send', 'Sam'), tsMs: at(0) },
    { ...entry('permission.approved', 'mail.send', null, 'person'), tsMs: at(0) },
    { ...entry('tool.completed', 'browser.read', 'a page'), tsMs: at(3) },
    { ...entry('tool.completed', 'calendar.read'), tsMs: at(10) },
  ]);
  it('narrow to today, the last seven days, everything or one app', () => {
    expect(items.filter((i) => inPlace(i, 'today', now))).toHaveLength(2);
    expect(items.filter((i) => inPlace(i, 'week', now))).toHaveLength(3);
    expect(items.filter((i) => inPlace(i, 'all', now))).toHaveLength(4);
    expect(items.filter((i) => inPlace(i, 'app:browser', now))).toHaveLength(1);
    expect(items.filter((i) => inPlace(i, 'needs', now))).toHaveLength(0);
  });
  it('narrow by who on top of the place', () => {
    expect(items.filter((i) => byWho(i, 'everything'))).toHaveLength(4);
    expect(items.filter((i) => byWho(i, 'you'))).toHaveLength(1);
    expect(items.filter((i) => byWho(i, 'final'))).toHaveLength(2);
  });
});
