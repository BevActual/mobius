import { MAX_CONTEXT_ITEM_CHARS, type CodeProblem, type ContextItem } from '@mobius/shared';

/**
 * What Code asks Mobius: to fix a problem a language server found (Fix with Mobius, Ctrl+.), and to review what
 * changed since the last commit (Review with Mobius). Each request carries what Mobius needs to start: the problem
 * and its place, or the diff.
 */

/**
 * Fix with Mobius: the problem and where it is. The open file travels with the message as its attachment; Mobius
 * reads any other file itself, so the message stays a few lines the person can read in the chat.
 */
export function fixPrompt(project: string, path: string, problem: CodeProblem): string {
  const what = problem.severity === 'error' ? 'error' : problem.severity === 'warning' ? 'warning' : 'problem';
  const source = problem.source ? ` (${problem.source}${problem.code != null ? ` ${problem.code}` : ''})` : '';
  return [
    `Fix this ${what} in ${path} of the Code project "${project}", line ${problem.line + 1}, column ${problem.character + 1}${source}:`,
    '',
    `> ${problem.message.split('\n').join('\n> ')}`,
    '',
    'Change only what the fix needs, and say in a line what was wrong.',
  ].join('\n');
}

/** Review with Mobius: what to look for, with the diff as the message's attachment. Mobius answers; it changes nothing. */
export function reviewRequest(project: string, branch: string, diff: string, truncated: boolean): { prompt: string; item: ContextItem } {
  const prompt = [
    `Review my changes in the Code project "${project}"${branch ? ` on the branch ${branch}` : ''}: everything since the last commit, attached as a diff.${truncated ? ' The diff was cut for length; read the changed files for the rest.' : ''}`,
    '',
    'Look for bugs first (wrong logic, missed cases, errors not handled), then security, then anything hard to read. For each finding name the file and line, say what goes wrong and when, and suggest the fix. Say plainly if you find nothing worth changing. Do not change any files.',
  ].join('\n');
  return { prompt, item: { kind: 'file', title: 'Changes since the last commit', source: `${project} (git diff)`, text: diff.slice(0, MAX_CONTEXT_ITEM_CHARS) } };
}

/** The problem at a place in a file, or nearest it on the same line: errors before warnings before the rest. */
export function problemAt(problems: readonly CodeProblem[], line: number, character: number): CodeProblem | null {
  const rank = (p: CodeProblem) => ({ error: 0, warning: 1, info: 2, hint: 3 })[p.severity];
  const covers = (p: CodeProblem) => (p.line < line || (p.line === line && p.character <= character)) && (p.endLine > line || (p.endLine === line && p.endCharacter >= character));
  const onLine = problems.filter((p) => p.line <= line && p.endLine >= line);
  const pick = (list: CodeProblem[]) => list.sort((a, b) => rank(a) - rank(b))[0] ?? null;
  return pick(onLine.filter(covers)) ?? pick([...onLine]);
}
