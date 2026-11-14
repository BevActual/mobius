import type { AppAccess, ModelCatalog, ScheduleInfo } from '@mobius/shared';

const APP_NAMES: Record<string, string> = {
  browser: 'Browser', notes: 'Notes', docs: 'Docs', sheets: 'Sheets', slides: 'Slides', tasks: 'Tasks', calendar: 'Calendar', mail: 'Mail',
  research: 'Research', reader: 'Reader', code: 'Code', database: 'Database', design: 'Design', canvas: 'Canvas', photo: 'Photo',
  studio: 'Music', video: 'Video', skills: 'Skills',
};

/**
 * What a bot may touch, in words, from Settings › Safety: a bot works under the same per-app settings and mode as
 * Mobius. "Off: Mail. Always asks: Browser. Everything else follows your mode, Propose."
 */
export function mayTouch(access: AppAccess, mode: string): string {
  const level = (app: string) => (access as Record<string, string | undefined>)[app] ?? 'follow';
  const named = (wanted: string) => Object.keys(APP_NAMES).filter((app) => level(app) === wanted).map((app) => APP_NAMES[app]!);
  const off = named('off');
  const always = named('always');
  const parts = [
    off.length > 0 ? `Off: ${off.join(', ')}.` : '',
    always.length > 0 ? `Always asks: ${always.join(', ')}.` : '',
    off.length + always.length > 0 ? `Everything else follows your mode, ${mode}.` : `Every app follows your mode, ${mode}.`,
  ];
  return parts.filter(Boolean).join(' ');
}

/** A bot made from a conversation: its name from the title, its instructions from the first thing asked. */
export function botFromConversation(title: string, firstAsk: string | null): { name: string; instructions: string; model: string } {
  const name = title.trim().slice(0, 40) || 'New agent';
  const ask = (firstAsk ?? '').trim();
  return { name, instructions: ask ? `Do this, as in the conversation “${name}”: ${ask}` : '', model: '' };
}

/** Every model id in the catalog, once each, in the order shown: the Model field's suggestions. */
export function modelChoices(catalog: ModelCatalog | null): string[] {
  const seen = new Set<string>();
  for (const group of catalog?.groups ?? []) for (const model of group.models) if (model.id) seen.add(model.id);
  return [...seen];
}

/**
 * The schedules that run as an agent. Schedules made before they could name their agent are matched by title, as the
 * New agent form named them after the agent.
 */
export function agentSchedules(bot: { id: string; name: string }, schedules: readonly ScheduleInfo[]): ScheduleInfo[] {
  const wanted = bot.name.trim().toLowerCase();
  return schedules.filter((s) => (s.bot ? s.bot === bot.id : wanted !== '' && s.title.trim().toLowerCase() === wanted));
}
