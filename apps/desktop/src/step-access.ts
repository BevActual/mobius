import type { AppAccess, ApprovalModeChoice } from '@mobius/shared';

const NAMES: [keyof AppAccess, RegExp][] = [
  ['docs', /\b(?:docs?|documents?)\b/g],
  ['mail', /\b(?:mail|emails?|inbox|repl(?:y|ies))\b/g],
  ['slides', /\b(?:slides?|decks?|presentations?)\b/g],
  ['sheets', /\b(?:sheets?|spreadsheets?|workbooks?)\b/g],
  ['notes', /\b(?:notes?|notebook)\b/g],
  ['calendar', /\b(?:calendars?|events?|meetings?|appointments?|schedule (?:it|a|an|the))\b/g],
  ['tasks', /\b(?:tasks?|to-?dos?|reminders?|checklist)\b/g],
  ['browser', /\b(?:browser|web|websites?|sites?|pages?|tabs?|online)\b/g],
];

/**
 * The app a plan step names, if it names one: "Compare hotels in Browser", "Add a task to Inbox". When it names more
 * than one, the one the work happens in ("in my calendar", "to Tasks") wins, then the one named first.
 */
export function appOfStep(text: string): keyof AppAccess | null {
  const t = text.toLowerCase();
  const found: { app: keyof AppAccess; at: number; place: boolean }[] = [];
  for (const [app, pattern] of NAMES) {
    for (const m of t.matchAll(pattern)) {
      const before = t.slice(0, m.index);
      found.push({ app, at: m.index, place: /\b(?:in|into|to|on)\s+(?:my\s+|the\s+|your\s+)?$/.test(before) });
    }
  }
  found.sort((a, b) => Number(b.place) - Number(a.place) || a.at - b.at);
  return found[0]?.app ?? null;
}

/**
 * What Mobius will do about asking in that step's app, from your settings: shown on a proposed plan as the design's
 * "Asks first" tags. It describes the settings, not the step: risky actions (clicking, typing, deleting) ask anyway.
 */
export function stepTag(text: string, access: AppAccess, mode: ApprovalModeChoice): { app: string; tag: string } | null {
  const app = appOfStep(text);
  if (!app) return null;
  const name = app === 'browser' ? 'Browser' : app === 'notes' ? 'Notes' : app === 'docs' ? 'Docs' : app === 'mail' ? 'Mail' : app === 'sheets' ? 'Sheets' : app === 'slides' ? 'Slides' : app === 'calendar' ? 'Calendar' : 'Tasks';
  const level = access[app] ?? 'ask';
  if (level === 'off') return { app: name, tag: 'Off' };
  if (level === 'act') return { app: name, tag: 'Acts' };
  if (mode === 'off') return { app: name, tag: 'Acts' };
  if (level === 'read') return { app: name, tag: 'Reads freely' };
  // Propose changes the workspace without asking; the browser and mail are not the workspace, so they still ask.
  if (mode === 'propose' && app !== 'browser' && app !== 'mail') return { app: name, tag: 'Proposes' };
  return { app: name, tag: mode === 'smart' ? 'Asks if unsure' : 'Asks first' };
}
