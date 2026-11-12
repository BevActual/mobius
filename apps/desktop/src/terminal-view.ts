/** What the Terminal app works out from a line before running it. */

/** The folder `cd` goes to, `~` for a bare `cd`; null when the line is not a `cd`. */
export function cdTarget(line: string): string | null {
  const m = /^\s*(?:cd|chdir)(?:\s+\/d)?(?:\s+(.*?))?\s*$/i.exec(line);
  if (!m) return null;
  const target = (m[1] ?? '').trim().replace(/^(["'])(.*)\1$/, '$2');
  return target || '~';
}

/** Whether the line clears the screen. */
export const isClear = (line: string): boolean => /^\s*(clear|cls)\s*$/i.test(line);

/** How a folder shows in the prompt: from the workspace, written `~`. */
export const promptPath = (cwd: string): string => (cwd ? `~/${cwd}` : '~');

/** Walking the history with the arrow keys: `at` is how far back (-1 is the line being typed). */
export function historyStep(history: readonly string[], at: number, up: boolean): number {
  if (up) return Math.min(history.length - 1, at + 1);
  return Math.max(-1, at - 1);
}

/** The last lines of a long output, so the screen stays quick; the rest is said to be there. */
export function tail(text: string, lines = 400): { text: string; hidden: number } {
  const all = text.split('\n');
  if (all.length <= lines) return { text, hidden: 0 };
  return { text: all.slice(-lines).join('\n'), hidden: all.length - lines };
}
