import { describe, expect, it } from 'vitest';
import { expandSlash, parseSkill, writeSkill } from './skill-format';

const SKILL = `---
name: compare-stays
description: When choosing where to stay, compare places side by side
license: MIT
---

1. List the places with price and distance to the venue
2) Check each cancellation policy
3. Put them in a table in Sheets

Prefer places under 10 minutes' walk.
`;

describe('skills', () => {
  it('read the front matter, the steps and the notes, and write them back', () => {
    const s = parseSkill(SKILL);
    expect(s).toEqual({ name: 'compare-stays', description: 'When choosing where to stay, compare places side by side', steps: ['List the places with price and distance to the venue', 'Check each cancellation policy', 'Put them in a table in Sheets'], notes: "Prefer places under 10 minutes' walk.", extra: ['license: MIT'] });
    expect(parseSkill(writeSkill(s))).toEqual(s);
    expect(writeSkill(s)).toContain('2. Check each cancellation policy\n');
  });
  it('a message starting /name asks for that skill', () => {
    expect(expandSlash('/compare-stays Lisbon, 12 to 14 March', ['compare-stays'])).toBe('Use the skill "compare-stays" (read it with skills.read and follow its steps) for: Lisbon, 12 to 14 March');
    expect(expandSlash('/compare-stays', ['compare-stays'])).toBe('Use the skill "compare-stays" (read it with skills.read and follow its steps).');
    expect(expandSlash('/nope hi', ['compare-stays'])).toBe('/nope hi');
    expect(expandSlash('hello /compare-stays', ['compare-stays'])).toBe('hello /compare-stays');
  });
});
