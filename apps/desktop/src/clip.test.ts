import { describe, expect, it } from 'vitest';
import { withClipping } from './clip';

describe('web clippings', () => {
  it('quotes the selection and links back to the page', () => {
    const item = { kind: 'page' as const, title: 'Selected on Rust [async] book', source: 'https://rust.example/a', text: 'Futures are lazy.\nThey wait.' };
    expect(withClipping('# Clippings\n\n', item, new Date('2026-11-07T12:00:00Z'))).toBe(
      '# Clippings\n\n> Futures are lazy.\n> They wait.\n\n— [Rust async book](https://rust.example/a), 2026-11-07\n',
    );
  });
});
