/**
 * The languages Mobius's own words can be shown in. English only for now: the plumbing is here so more can be added
 * as catalogs (apps/desktop/src/i18n.ts) without touching settings again.
 */
export const LANGUAGES = [{ id: 'en', label: 'English' }] as const;
export type LanguageId = (typeof LANGUAGES)[number]['id'];
export const DEFAULT_LANGUAGE: LanguageId = 'en';

export function isLanguage(v: unknown): v is LanguageId {
  return typeof v === 'string' && LANGUAGES.some((l) => l.id === v);
}
