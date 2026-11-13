import { describe, expect, it } from 'vitest';
import { splitContext, splitSteps, withContext, withSteps } from './context';

describe('a suggestion sent with its steps', () => {
  it('shows its words and keeps the steps for Details, even with attachments after it', () => {
    const text = withContext(withSteps('Take care of this', 'Add the to-dos with tasks.add.\nThen draft a reply.'), [{ kind: 'page', title: 'Mail', source: 'mail', text: 'Hi' }]);
    const { text: typed } = splitContext(text);
    expect(splitSteps(typed)).toEqual({ shown: 'Take care of this', steps: 'Add the to-dos with tasks.add.\nThen draft a reply.' });
  });
  it('leaves a typed message as it is', () => {
    expect(splitSteps('What is on today?')).toEqual({ shown: 'What is on today?', steps: null });
  });
});
