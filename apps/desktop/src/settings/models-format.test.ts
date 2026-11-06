import { describe, expect, it } from 'vitest';
import { compactCount, fitText, formatBytes, hardwareSummary, modelTitle, paramsText, percent } from './models-format';

describe('sizes', () => {
  it('use decimal gigabytes like the places models are downloaded from', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1_500)).toBe('1.5 KB');
    expect(formatBytes(2_300_000)).toBe('2.3 MB');
    expect(formatBytes(5_987_654_321)).toBe('6.0 GB');
    expect(formatBytes(17_920_697_312)).toBe('17.9 GB');
    expect(formatBytes(1_200_000_000_000)).toBe('1.2 TB');
  });
  it('do not break on nonsense', () => {
    for (const bad of [Number.NaN, -5, Infinity]) expect(formatBytes(bad)).toBe('');
  });
});

describe('counts', () => {
  it('are shortened', () => {
    expect(compactCount(0)).toBe('0');
    expect(compactCount(950)).toBe('950');
    expect(compactCount(1_200)).toBe('1.2K');
    expect(compactCount(2_130_000)).toBe('2.1M');
    expect(compactCount(Number.NaN)).toBe('');
  });
});

describe('parameter counts', () => {
  it('keep one decimal for small models and none for large ones', () => {
    expect(paramsText(0.27)).toBe('0.3B');
    expect(paramsText(9)).toBe('9.0B');
    expect(paramsText(1.7)).toBe('1.7B');
    expect(paramsText(27)).toBe('27B');
    expect(paramsText(70.4)).toBe('70B');
    expect(paramsText(0.01)).toBe('<0.1B');
    expect(paramsText(Number.NaN)).toBe('');
  });
});

describe('progress', () => {
  it('is a whole percentage that never leaves 0 to 100', () => {
    expect(percent(0, 0)).toBe(0);
    expect(percent(50, 200)).toBe(25);
    expect(percent(999, 1000)).toBe(99);
    expect(percent(5000, 1000)).toBe(100);
    expect(percent(-5, 1000)).toBe(0);
    expect(percent(Number.NaN, 10)).toBe(0);
  });
});

describe('how well a model suits this computer', () => {
  it('is said in plain words', () => {
    expect(fitText('gpu')).toEqual({ label: 'Fits on your GPU', tone: 'good' });
    expect(fitText('split')).toEqual({ label: 'Slower: part runs on the CPU', tone: 'warn' });
    expect(fitText('cpu')).toEqual({ label: 'CPU only: slow', tone: 'warn' });
    expect(fitText('too_big')).toEqual({ label: 'Too big for this computer', tone: 'bad' });
  });
});

describe('the computer', () => {
  const GB = 1_000_000_000;
  it('is described in one line', () => {
    expect(hardwareSummary({ gpu_name: 'NVIDIA GeForce RTX 4080 Laptop GPU', vram_total: 12.9 * GB, vram_free: 11.8 * GB, ram_total: 34.1 * GB, ram_free: 11.1 * GB })).toBe(
      'NVIDIA GeForce RTX 4080 Laptop GPU, 12.9 GB graphics memory (11.8 GB free). 34.1 GB memory (11.1 GB free).',
    );
    expect(hardwareSummary({ gpu_name: null, vram_total: 0, vram_free: 0, ram_total: 16 * GB, ram_free: 9 * GB })).toBe('No dedicated graphics card was found, so models would run on the processor. 16.0 GB memory (9.0 GB free).');
  });
});

describe('model names', () => {
  it('drop the file ending and show the repository when there is one', () => {
    expect(modelTitle({ file: 'Qwen3.5-9B-UD-Q4_K_XL.gguf', repo: 'unsloth/Qwen3.5-9B-GGUF' })).toEqual({ name: 'Qwen3.5-9B-UD-Q4_K_XL', from: 'unsloth/Qwen3.5-9B-GGUF' });
    expect(modelTitle({ file: 'my-model.GGUF', repo: null })).toEqual({ name: 'my-model', from: null });
    expect(modelTitle({ file: 'Q4_K_M/big-00001-of-00002.gguf', repo: null }).name).toBe('big-00001-of-00002');
  });
});
