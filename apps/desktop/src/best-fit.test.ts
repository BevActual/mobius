import { describe, expect, it } from 'vitest';
import { BEST_FIT_SHORT, bestFitQuick } from './chat-mode';

describe('Best fit', () => {
  it('sends a short one-line question to the quick model', () => {
    expect(bestFitQuick('what time is it in Tokyo?', 0, 'agent')).toBe(true);
    expect(bestFitQuick('what does this mean', 0, 'ask')).toBe(true);
  });
  it('keeps long, attached, multi-line or planned work on the chat model', () => {
    expect(bestFitQuick('x'.repeat(BEST_FIT_SHORT + 1), 0, 'agent')).toBe(false);
    expect(bestFitQuick('summarise this', 1, 'agent')).toBe(false);
    expect(bestFitQuick('first\nsecond', 0, 'agent')).toBe(false);
    expect(bestFitQuick('plan my week', 0, 'plan')).toBe(false);
    expect(bestFitQuick('   ', 0, 'agent')).toBe(false);
  });
});
