import { describe, expect, it } from 'vitest';
import { readableSource } from './RichText';

describe('claim sources', () => {
  it('shows where a fact came from, but never a bare id from a tool', () => {
    expect(readableSource('Mail · Priya Shah · Brake kit')).toBe('Mail · Priya Shah · Brake kit');
    expect(readableSource('Calendar · Offsite crew')).toBe('Calendar · Offsite crew');
    for (const id of ['id 1', 'ID 12', '#3', '7', 'work/inbox/7', 'local/sent/2']) expect(readableSource(id)).toBe('');
  });
});
