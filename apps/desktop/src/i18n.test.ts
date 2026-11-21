import { describe, expect, it } from 'vitest';
import { language, setLanguage, t } from './i18n';

describe('Mobius in a language', () => {
  it('starts in English and gives each word from its catalog', () => {
    expect(language()).toBe('en');
    setLanguage('en');
    expect(t('settings.language.title')).toBe('Language');
    // Values fill only the names a word has; a word without any is left as it is.
    expect(t('settings.language.title', { unused: 1 })).toBe('Language');
  });
});
