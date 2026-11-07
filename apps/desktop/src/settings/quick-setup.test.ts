import { describe, expect, it } from 'vitest';
import type { LocalEntry, Recommendation } from '@mobius/shared';
import { pickModel } from './LocalModels';

const local = (id: string, fit: LocalEntry['assessment']['fit']) => ({ model: { id, repo: 'r', file: `${id}.gguf`, path: '', quant: null, size: 1, projector: null }, assessment: { fit } }) as unknown as LocalEntry;
const found = (file: string, fit: Recommendation['assessment']['fit']) => ({ candidate: { repo: 'r', file }, assessment: { fit } }) as unknown as Recommendation;

describe('choosing a model for quick setup', () => {
  it('prefers a model already here that runs on the graphics card', () => {
    expect(pickModel([local('cpu', 'cpu'), local('gpu', 'gpu')], [found('new', 'gpu')])).toEqual({ local: local('gpu', 'gpu') });
  });
  it('downloads the best suggestion when nothing here fits the graphics card', () => {
    expect(pickModel([local('cpu', 'cpu')], [found('big', 'too_big'), found('half', 'split'), found('fits', 'gpu')])).toEqual({ download: found('fits', 'gpu') });
    expect(pickModel([], [found('half', 'split')])).toEqual({ download: found('half', 'split') });
  });
  it('picks nothing that would only run on the processor or not at all', () => {
    expect(pickModel([local('cpu', 'cpu')], [found('big', 'too_big'), found('slow', 'cpu')])).toBeNull();
  });
});
