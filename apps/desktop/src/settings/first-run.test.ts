import { describe, expect, it } from 'vitest';
import { chatModels } from './first-run';

describe('a first model to choose', () => {
  it('leaves out models that do not chat', () => {
    expect(chatModels(['dall-e-3', 'gpt-5.5', 'gpt-5.5-mini', 'gpt-4o-transcribe', 'text-embedding-3-large', 'tts-1', 'whisper-1', 'omni-moderation-latest', 'gpt-image-1', 'gpt-realtime']))
      .toEqual(['gpt-5.5', 'gpt-5.5-mini']);
    expect(chatModels(['mistral-embed', 'mistral-large-latest', 'rerank-v3.5', 'command-a-03-2025'])).toEqual(['mistral-large-latest', 'command-a-03-2025']);
  });

  it('keeps every model when none look like chat ones, so there is always something to choose', () => {
    expect(chatModels(['text-embedding-3-small'])).toEqual(['text-embedding-3-small']);
    expect(chatModels([])).toEqual([]);
  });

  it('does not mistake a chat model whose name only contains those letters', () => {
    expect(chatModels(['imagine-chat', 'speechless-7b', 'llama-3.3-70b'])).toEqual(['imagine-chat', 'speechless-7b', 'llama-3.3-70b']);
  });
});
