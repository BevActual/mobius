/**
 * A task starts its branch (Tasks' "Start a branch in Code"): the task's words as a branch name, kept here until
 * Code's Changes picks it up and offers it in New branch, for the person to start or change.
 */
export const START_BRANCH_EVENT = 'mobius:start-branch';

let pending: string | null = null;

/** A task's words as a branch name: lower case, words joined by dashes, nothing git would refuse, at most 48. */
export function branchName(text: string): string {
  const words = text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const cut = words.length > 48 ? words.slice(0, 48).replace(/-[^-]*$/, '') : words;
  return cut || 'new-branch';
}

/** Tasks asks for a branch: Code opens (the shell listens) and its Changes offers the name. */
export function startBranch(text: string): void {
  pending = branchName(text);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(START_BRANCH_EVENT));
}

/** The name waiting for Code, taken once. */
export function takeBranchName(): string | null {
  const name = pending;
  pending = null;
  return name;
}
