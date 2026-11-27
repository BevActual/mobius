import type { Lang } from './code-view';

/**
 * Run buttons in the editor's margin, as VS Code's testing view puts them: one beside each test and each group of
 * tests the file holds. A button runs the project's own test command (the one the person chose), narrowed to that
 * test with the arguments its runner takes: Vitest and Jest `<file> -t <name>`, cargo `<name>`, pytest
 * `<file> -k <name>`, go `-run ^<name>$`. A runner it does not know runs the whole command.
 */
export interface TestMark {
  /** The line the test starts on, from 0. */
  line: number;
  name: string;
  /** A group of tests (describe, a Test class) rather than one test. */
  group: boolean;
}

/** Whether a file is one its language's test runner reads tests from. */
export function isTestFile(path: string, lang: Lang): boolean {
  const name = path.split('/').pop() ?? path;
  if (lang === 'ts') return /\.(test|spec)\.[cm]?[jt]sx?$/i.test(name) || /(^|\/)__tests__\//.test(path);
  if (lang === 'py') return /^test_.*\.py$/i.test(name) || /_test\.py$/i.test(name);
  if (lang === 'go') return /_test\.go$/i.test(name);
  return lang === 'rust';
}

const JS_TEST = /^\s*(describe|suite|it|test|bench)((?:\.(?:only|skip|concurrent|sequential|todo|fails|each\s*\(.*?\)))*)\s*\(\s*(['"`])((?:\\.|(?!\3).)*)\3/;

/** The tests a file holds, in order. */
export function testsIn(text: string, lang: Lang, path: string): TestMark[] {
  if (!isTestFile(path, lang)) return [];
  const lines = text.split('\n');
  const out: TestMark[] = [];
  lines.forEach((l, i) => {
    if (lang === 'ts') {
      const m = JS_TEST.exec(l);
      if (m && m[1] !== 'bench' && !/\.todo/.test(m[2] ?? '')) out.push({ line: i, name: (m[4] ?? '').replace(/\\(.)/g, '$1'), group: m[1] === 'describe' || m[1] === 'suite' });
    } else if (lang === 'rust') {
      if (!/^\s*#\[(tokio::)?test\b/.test(l)) return;
      // The fn under the attribute, past any others (#[ignore], #[should_panic]).
      for (let j = i + 1; j < Math.min(lines.length, i + 6); j += 1) {
        const f = /^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/.exec(lines[j] ?? '');
        if (f) { out.push({ line: j, name: f[1] ?? '', group: false }); return; }
        if (!/^\s*(#\[|\/\/)/.test(lines[j] ?? '')) return;
      }
    } else if (lang === 'py') {
      const c = /^\s*class\s+(Test\w*)\b/.exec(l);
      if (c) { out.push({ line: i, name: c[1] ?? '', group: true }); return; }
      const f = /^\s*(?:async\s+)?def\s+(test\w*)\s*\(/.exec(l);
      if (f) out.push({ line: i, name: f[1] ?? '', group: false });
    } else if (lang === 'go') {
      const f = /^func\s+(Test\w+)\s*\(\s*\w+\s+\*testing\.T\s*\)/.exec(l);
      if (f) out.push({ line: i, name: f[1] ?? '', group: false });
    }
  });
  return out;
}

/** A name as a pattern any shell passes through as written: only plain characters kept, the rest match any one. */
function plain(name: string): string {
  return name.replace(/[^\w \-:,/#=']/g, '.').replace(/\s+/g, ' ').trim();
}
const SAFE_PATH = /^[\w\-./ ]+$/;

/**
 * What to add to the test command to run one test (or group) of a file, or null when the command's runner is not
 * one this knows (the whole command runs then).
 */
export function testArgs(command: string, path: string, mark: TestMark, lang: Lang): string | null {
  const c = command.trim();
  const file = SAFE_PATH.test(path) ? ` "${path}"` : '';
  if (lang === 'ts') {
    const direct = /\b(vitest|jest)\b/.test(c);
    const npm = /^(npm|pnpm|yarn|bun)(\s+run)?\s+test\b/.test(c);
    if (!direct && !npm) return null;
    const pass = /^npm\b/.test(c) && !direct && !/\s--(\s|$)/.test(c) ? ' --' : '';
    const name = plain(mark.name);
    return `${pass}${file}${name ? ` -t "${name}"` : ''}`;
  }
  if (lang === 'rust') return /\bcargo\s+(test|nextest)\b/.test(c) && /^\w+$/.test(mark.name) ? ` ${mark.name}` : null;
  if (lang === 'py') return /\bpytest\b/.test(c) && /^\w+$/.test(mark.name) ? `${file} -k "${mark.name}"` : null;
  if (lang === 'go') return /\bgo\s+test\b/.test(c) && /^\w+$/.test(mark.name) ? ` -run "^${mark.name}$"` : null;
  return null;
}

/** The key a test's last result is kept under. */
export const testKey = (path: string, mark: Pick<TestMark, 'name' | 'line'>) => `${path}\u0001${mark.name}`;
