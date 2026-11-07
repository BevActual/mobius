/** One line of a comparison: kept, added by the change, or removed by it. */
export interface DiffLine { kind: 'same' | 'added' | 'removed'; text: string }

/**
 * Lines that differ between two texts, by longest common subsequence. Notes are small, so the simple table is fine;
 * past a few thousand lines each side it falls back to showing everything as replaced.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length * b.length > 4_000_000) return [...a.map((text) => ({ kind: 'removed' as const, text })), ...b.map((text) => ({ kind: 'added' as const, text }))];
  const table: Uint32Array[] = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ kind: 'same', text: a[i]! }); i++; j++; }
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) out.push({ kind: 'removed', text: a[i++]! });
    else out.push({ kind: 'added', text: b[j++]! });
  }
  while (i < a.length) out.push({ kind: 'removed', text: a[i++]! });
  while (j < b.length) out.push({ kind: 'added', text: b[j++]! });
  return out;
}

/** How many lines were added and removed. */
export const diffCounts = (lines: readonly DiffLine[]) => ({
  added: lines.filter((l) => l.kind === 'added').length,
  removed: lines.filter((l) => l.kind === 'removed').length,
});

/** Which change each line belongs to: runs of added and removed lines next to each other make one change; kept lines none. */
export function changeGroups(lines: readonly DiffLine[]): (number | null)[] {
  let group = -1;
  let inChange = false;
  return lines.map((line) => {
    if (line.kind === 'same') { inChange = false; return null; }
    if (!inChange) { group++; inChange = true; }
    return group;
  });
}

/** The text with one change put back as it was and every other change kept. */
export function undoGroup(lines: readonly DiffLine[], group: number): string {
  const groups = changeGroups(lines);
  return lines
    .filter((line, i) => line.kind === 'same' || (groups[i] === group ? line.kind === 'removed' : line.kind === 'added'))
    .map((line) => line.text)
    .join('\n');
}
