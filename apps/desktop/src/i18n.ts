import { DEFAULT_LANGUAGE, type LanguageId } from '@mobius/shared';

/**
 * Mobius's own words, by language. English is the source every other catalog follows; a word a catalog lacks falls
 * back to English. Words move here as they are translated: until then they stay where they are written.
 */
const en = {
  'settings.language.title': 'Language',
  'settings.language.description': 'The language Mobius shows its own words in. More languages are coming.',
} as const;

export type MessageKey = keyof typeof en;
type Catalog = Partial<Record<MessageKey, string>>;

const CATALOGS: Record<LanguageId, Catalog> = { en };

let current: LanguageId = DEFAULT_LANGUAGE;

/** Shows Mobius in `language` from now on, and tells the page (spelling, hyphenation, screen readers). */
export function setLanguage(language: LanguageId): void {
  current = language;
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}

export function language(): LanguageId {
  return current;
}

/** A word in the language chosen, with `{name}` filled from `values`; English where it is not translated yet. */
export function t(key: MessageKey, values?: Record<string, string | number>): string {
  const text = CATALOGS[current]?.[key] ?? en[key];
  return values ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole)) : text;
}
