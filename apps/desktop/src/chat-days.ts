/** Chats in the Chats panel by when they were last active, newest first, under the headings a person scans by. */
export interface ChatDay<T> { label: string; rows: T[] }

const DAY = 86_400_000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Today", "Yesterday", then "Earlier". */
export function chatDayLabel(updatedMs: number, nowMs: number): string {
  const days = Math.round((startOfDay(nowMs) - startOfDay(updatedMs)) / DAY);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return 'Earlier';
}

/** Headings only help once the list is long; a short list reads fine in time order alone. */
export const DAY_HEADINGS_FROM = 9;

/** Sorts newest first and splits into day groups; empty groups are left out. */
export function chatsByDay<T extends { updated_ms: number }>(rows: T[], nowMs: number): ChatDay<T>[] {
  const out: ChatDay<T>[] = [];
  for (const row of [...rows].sort((a, b) => b.updated_ms - a.updated_ms)) {
    const label = chatDayLabel(row.updated_ms, nowMs);
    const last = out[out.length - 1];
    if (last && last.label === label) last.rows.push(row);
    else out.push({ label, rows: [row] });
  }
  return out;
}
