import type { CodeProblem } from '@mobius/shared';
import { langName } from './code-edit';

/**
 * What Code asks Mobius: to fix a problem a language server found (Fix with Mobius, Ctrl+.), and to review what
 * changed since the last commit (Review with Mobius). Each request carries what Mobius needs to start: the problem
 * with the lines around it, or the diff.
 */

const AROUND = 6;

/** A fence longer than any run of backticks in the text, so the text cannot close it. */
function fence(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  return '`'.repeat(longest + 1);
}

/** The lines around a problem, numbered as the editor numbers them, the problem's own line marked with ›. */
export function around(text: string, line: number, span = AROUND): string {
  const lines = text.split('\n');
  const from = Math.max(0, line - span);
  const to = Math.min(lines.length - 1, line + span);
  const width = String(to + 1).length;
  const out: string[] = [];
  for (let i = from; i <= to; i += 1) out.push(`${i === line ? '›' : ' '} ${String(i + 1).padStart(width)} | ${lines[i] ?? ''}`);
  return out.join('\n');
}

/** Fix with Mobius: the problem, where it is, and the code around it. */
export function fixPrompt(project: string, path: string, text: string, problem: CodeProblem): string {
  const what = problem.severity === 'error' ? 'error' : problem.severity === 'warning' ? 'warning' : 'problem';
  const source = problem.source ? ` (${problem.source}${problem.code != null ? ` ${problem.code}` : ''})` : '';
  const code = around(text, problem.line);
  const f = fence(code);
  return [
    `Fix this ${what} in ${path} of the Code project "${project}", line ${problem.line + 1}, column ${problem.character + 1}${source}:`,
    '',
    `> ${problem.message.split('\n').join('\n> ')}`,
    '',
    `The ${langName(path)} around it (› marks the line):`,
    '',
    `${f}\n${code}\n${f}`,
    '',
    'Read the file first. Change only what the fix needs, and say in a line what was wrong.',
  ].join('\n');
}

/** Review with Mobius: the diff, and what a review should look for. Mobius answers; it does not change files. */
export function reviewPrompt(project: string, branch: string, diff: string, truncated: boolean): string {
  const f = fence(diff);
  return [
    `Review my changes in the Code project "${project}"${branch ? ` on the branch ${branch}` : ''}, everything since the last commit:`,
    '',
    `${f}diff\n${diff.trimEnd()}\n${f}`,
    ...(truncated ? ['', 'The diff was cut for length; read the changed files for the rest.'] : []),
    '',
    'Look for bugs first (wrong logic, missed cases, errors not handled), then security, then anything hard to read. For each finding name the file and line, say what goes wrong and when, and suggest the fix. Say plainly if you find nothing worth changing. Do not change any files.',
  ].join('\n');
}

/** The problem at a place in a file, or nearest it on the same line: errors before warnings before the rest. */
export function problemAt(problems: readonly CodeProblem[], line: number, character: number): CodeProblem | null {
  const rank = (p: CodeProblem) => ({ error: 0, warning: 1, info: 2, hint: 3 })[p.severity];
  const covers = (p: CodeProblem) => (p.line < line || (p.line === line && p.character <= character)) && (p.endLine > line || (p.endLine === line && p.endCharacter >= character));
  const onLine = problems.filter((p) => p.line <= line && p.endLine >= line);
  const pick = (list: CodeProblem[]) => list.sort((a, b) => rank(a) - rank(b))[0] ?? null;
  return pick(onLine.filter(covers)) ?? pick([...onLine]);
}
