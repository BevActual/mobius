import { describe, expect, it } from 'vitest';
import { MAIN_BOT_ID, MAX_BOT_INSTRUCTIONS, MAX_BOT_NAME, botOfConversation, conversationIdFor, isBotId, parseBotDraft, parseBotRequest } from './bots';

const draft = { name: 'Researcher', instructions: 'Cite sources.', model: '' };

describe('a bot as described by the person', () => {
  it('has a plain name, bounded instructions and optionally a model, all tidied', () => {
    expect(parseBotDraft(draft)).toEqual(draft);
    expect(parseBotDraft({ name: '  Spaced  ', instructions: '  keep it short \n', model: ' big-model ' })).toEqual({ name: 'Spaced', instructions: 'keep it short', model: 'big-model' });
    expect(parseBotDraft({ ...draft, name: 'x'.repeat(MAX_BOT_NAME) })).not.toBeNull();
    expect(parseBotDraft({ ...draft, instructions: 'x'.repeat(MAX_BOT_INSTRUCTIONS) })).not.toBeNull();
    expect(parseBotDraft({ ...draft, instructions: 'line one\nline two' })?.instructions).toBe('line one\nline two');
  });

  it('is refused when the name is empty, long or has line breaks, the instructions are huge, or the model is odd', () => {
    for (const bad of [{ ...draft, name: '' }, { ...draft, name: '   ' }, { ...draft, name: 'x'.repeat(MAX_BOT_NAME + 1) }, { ...draft, name: 'a\nb' }, { ...draft, name: 'a\u0000b' },
      { ...draft, instructions: 'x'.repeat(MAX_BOT_INSTRUCTIONS + 1) }, { ...draft, instructions: 'a\u0000b' }, { ...draft, model: 'x'.repeat(201) }, { ...draft, model: 'a\nb' },
      { ...draft, name: 3 }, { ...draft, instructions: null }, { name: 'n', instructions: '' }, null, 'bot', [], undefined]) {
      expect(parseBotDraft(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('bot ids and conversations', () => {
  it('are main or six lowercase letters and digits', () => {
    for (const ok of [MAIN_BOT_ID, 'a1b2c3', '000000', 'zzzzzz']) expect(isBotId(ok), ok).toBe(true);
    for (const bad of ['', 'Main', 'a1b2c', 'a1b2c34', 'A1B2C3', 'a1b-c3', 'a1b2c ', 3, null, undefined]) expect(isBotId(bad), String(bad)).toBe(false);
  });

  it('tell which bot a conversation belongs to, and treat anything unknown as Mobius', () => {
    const known = [MAIN_BOT_ID, 'abc123', 'def456'];
    expect(botOfConversation('c-abc123-5f2a1c4e-0000-4000-8000-000000000000', known)).toBe('abc123');
    expect(botOfConversation('c-def456-x', known)).toBe('def456');
    expect(botOfConversation('c-5f2a1c4e-0000-4000-8000-000000000000', known), 'a plain id has eight characters before its first hyphen').toBe(MAIN_BOT_ID);
    expect(botOfConversation('c-zzz999-x', known), 'a bot that was deleted').toBe(MAIN_BOT_ID);
    expect(botOfConversation('main', known)).toBe(MAIN_BOT_ID);
    expect(botOfConversation('', known)).toBe(MAIN_BOT_ID);
  });

  it('are named so that the bot can be found again, and Mobius keeps the plain form', () => {
    expect(conversationIdFor(MAIN_BOT_ID, 'r-1')).toBe('c-r-1');
    expect(conversationIdFor('abc123', 'r-1')).toBe('c-abc123-r-1');
    const uuid = '5f2a1c4e-0000-4000-8000-000000000000';
    const id = conversationIdFor('abc123', uuid);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(botOfConversation(id, ['abc123'])).toBe('abc123');
    expect(botOfConversation(conversationIdFor(MAIN_BOT_ID, uuid), ['abc123'])).toBe(MAIN_BOT_ID);
  });

  it('are asked for by the window with an id and a draft, both checked', () => {
    expect(parseBotRequest({ id: 'abc123', draft })).toEqual({ id: 'abc123', draft });
    for (const bad of [{ id: 'nope', draft }, { id: 'abc123', draft: { ...draft, name: '' } }, { draft }, null, 'x']) expect(parseBotRequest(bad)).toBeNull();
  });
});
