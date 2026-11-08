import type { AppAccess, ApprovalModeChoice } from '@mobius/shared';

/** The app a plan step names, if it names one: "Compare hotels in Browser", "Add a task to Inbox". */
export function appOfStep(text: string): keyof AppAccess | null {
  const t = text.toLowerCase();
  // Named apps first, so "the budget page in Notes" is Notes.
  if (/\bdocs?\b|\bdocuments?\b/.test(t)) return 'docs';
  if (/\bmail\b|\bemails?\b|\binbox\b|\brepl(y|ies)\b/.test(t)) return 'mail';
  if (/\bsheets?\b|\bspreadsheets?\b|\bworkbooks?\b/.test(t)) return 'sheets';
  if (/\bnotes?\b|\bnotebook\b/.test(t)) return 'notes';
  if (/\bcalendars?\b|\bevents?\b|\bmeetings?\b|\bappointments?\b|\bschedule (?:it|a|an|the)\b/.test(t)) return 'calendar';
  if (/\btasks?\b|\bto-?dos?\b|\breminders?\b|\bchecklist\b/.test(t)) return 'tasks';
  if (/\bbrowser\b|\bweb\b|\bwebsites?\b|\bsites?\b|\bpages?\b|\btabs?\b|\bonline\b/.test(t)) return 'browser';
  return null;
}

/**
 * What Mobius will do about asking in that step's app, from your settings: shown on a proposed plan as the design's
 * "Asks first" tags. It describes the settings, not the step: risky actions (clicking, typing, deleting) ask anyway.
 */
export function stepTag(text: string, access: AppAccess, mode: ApprovalModeChoice): { app: string; tag: string } | null {
  const app = appOfStep(text);
  if (!app) return null;
  const name = app === 'browser' ? 'Browser' : app === 'notes' ? 'Notes' : app === 'docs' ? 'Docs' : app === 'mail' ? 'Mail' : app === 'sheets' ? 'Sheets' : app === 'calendar' ? 'Calendar' : 'Tasks';
  const level = access[app] ?? 'ask';
  if (level === 'off') return { app: name, tag: 'Off' };
  if (level === 'act') return { app: name, tag: 'Acts' };
  if (mode === 'off') return { app: name, tag: 'Acts' };
  if (level === 'read') return { app: name, tag: 'Reads freely' };
  return { app: name, tag: mode === 'smart' ? 'Asks if unsure' : 'Asks first' };
}
