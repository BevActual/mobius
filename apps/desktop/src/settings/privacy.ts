import type { ActivityEntry } from '@mobius/shared';

export interface PrivacyRow { area: string; read: number; changed: number; blocked: number }

/** The area a capability belongs to, in the person's words. */
function areaOf(capability: string, resource: string | null): string {
  if (capability.startsWith('browser.')) return 'Browser';
  if (capability.startsWith('tasks.')) return 'Tasks';
  if (capability.startsWith('calendar.')) return 'Calendar';
  if (capability.startsWith('files.')) return resource?.startsWith('notes/') ? 'Notes' : resource?.startsWith('docs/') ? 'Docs' : resource?.startsWith('tasks/') ? 'Tasks' : resource?.startsWith('calendar/') ? 'Calendar' : 'Files';
  if (capability.startsWith('memory.')) return 'Memory';
  if (capability.startsWith('sessions.')) return 'Past conversations';
  if (capability.startsWith('schedules.')) return 'Schedules';
  if (capability.startsWith('mcp.')) return 'Connected apps';
  return 'Other';
}
const CHANGES = /\.(write|navigate|interact|add|update|delete|exec)$/;

/**
 * What Mobius did in each area since `sinceMs`, from the activity log: how often it read, how often it changed
 * something, and how often it was blocked. Only what ran is counted (a question you declined is not "read").
 */
export function privacyReport(entries: readonly ActivityEntry[], sinceMs: number): PrivacyRow[] {
  const rows = new Map<string, PrivacyRow>();
  const row = (area: string) => rows.get(area) ?? rows.set(area, { area, read: 0, changed: 0, blocked: 0 }).get(area)!;
  for (const e of entries) {
    if (e.tsMs < sinceMs || !e.capability || e.who === 'person') continue;
    const r = row(areaOf(e.capability, e.resource));
    if (e.kind === 'tool.started') {
      if (CHANGES.test(e.capability)) r.changed += 1; else r.read += 1;
    } else if (e.kind === 'permission.denied' || e.kind === 'permission.rejected') {
      r.blocked += 1;
    }
  }
  return [...rows.values()].filter((r) => r.read + r.changed + r.blocked > 0).sort((a, b) => b.read + b.changed - (a.read + a.changed) || a.area.localeCompare(b.area));
}

/** Where requests go: this computer, or the named server. */
export function whereItRuns(baseUrl: string): string {
  try {
    const host = new URL(baseUrl).hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return 'On this computer';
    return host;
  } catch {
    return baseUrl ? baseUrl : 'Not set up';
  }
}
