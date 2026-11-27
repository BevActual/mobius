import { describe, expect, it } from 'vitest';
import { isTestFile, testArgs, testsIn } from './code-run';

describe('testsIn', () => {
  it('finds describe, it and test calls in a JavaScript test file, with their modifiers', () => {
    const text = [
      "import { describe, it } from 'vitest';",
      "describe('adds', () => {",
      "  it('one and one', () => {});",
      '  test.only("with a \\"quote\\"", () => {});',
      '  it.each([1, 2])(`row %s`, () => {});',
      "  it.todo('later');",
      '});',
    ].join('\n');
    expect(testsIn(text, 'ts', 'src/add.test.ts')).toEqual([
      { line: 1, name: 'adds', group: true },
      { line: 2, name: 'one and one', group: false },
      { line: 3, name: 'with a "quote"', group: false },
      { line: 4, name: 'row %s', group: false },
    ]);
  });

  it('finds nothing in a file that is not a test file', () => {
    expect(testsIn("it('x', () => {})", 'ts', 'src/add.ts')).toEqual([]);
    expect(isTestFile('src/__tests__/add.js', 'ts')).toBe(true);
  });

  it('finds Rust tests by their attribute, past others', () => {
    const text = ['#[cfg(test)]', 'mod tests {', '    #[test]', '    #[should_panic]', '    fn adds() {}', '    #[tokio::test]', '    async fn waits() {}', '    fn helper() {}', '}'].join('\n');
    expect(testsIn(text, 'rust', 'src/lib.rs')).toEqual([{ line: 4, name: 'adds', group: false }, { line: 6, name: 'waits', group: false }]);
  });

  it('finds pytest classes and functions, and Go tests', () => {
    expect(testsIn('class TestAdd:\n    def test_one(self):\n        pass\ndef helper():\n    pass', 'py', 'tests/test_add.py')).toEqual([{ line: 0, name: 'TestAdd', group: true }, { line: 1, name: 'test_one', group: false }]);
    expect(testsIn('func TestAdd(t *testing.T) {}\nfunc helper() {}', 'go', 'add_test.go')).toEqual([{ line: 0, name: 'TestAdd', group: false }]);
  });
});

describe('testArgs', () => {
  const one = { line: 0, name: 'adds two (and more)', group: false };
  it('narrows Vitest and Jest to the file and the test, through npm with --', () => {
    expect(testArgs('npx vitest run', 'src/a.test.ts', one, 'ts')).toBe(' "src/a.test.ts" -t "adds two .and more."');
    expect(testArgs('npm test', 'src/a.test.ts', one, 'ts')).toBe(' -- "src/a.test.ts" -t "adds two .and more."');
    expect(testArgs('npm test -- --silent', 'src/a.test.ts', one, 'ts')).toBe(' "src/a.test.ts" -t "adds two .and more."');
    expect(testArgs('pnpm test', 'src/a.test.ts', one, 'ts')).toBe(' "src/a.test.ts" -t "adds two .and more."');
  });
  it('keeps shell characters out of what it adds', () => {
    expect(testArgs('npx jest', 'src/$x.test.ts', { line: 0, name: 'a "b" $HOME `c` %PATH%', group: false }, 'ts')).toBe(' -t "a .b. .HOME .c. .PATH."');
  });
  it('narrows cargo, pytest and go by name', () => {
    expect(testArgs('cargo test -p core', 'src/lib.rs', { line: 0, name: 'adds', group: false }, 'rust')).toBe(' adds');
    expect(testArgs('python -m pytest', 'tests/test_a.py', { line: 0, name: 'TestA', group: true }, 'py')).toBe(' "tests/test_a.py" -k "TestA"');
    expect(testArgs('go test ./...', 'a_test.go', { line: 0, name: 'TestA', group: false }, 'go')).toBe(' -run "^TestA$"');
  });
  it('gives null for a runner it does not know', () => {
    expect(testArgs('make check', 'src/a.test.ts', one, 'ts')).toBeNull();
    expect(testArgs('python -m unittest', 'tests/test_a.py', { line: 0, name: 'test_a', group: false }, 'py')).toBeNull();
  });
});
