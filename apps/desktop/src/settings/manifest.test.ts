import { describe, expect, it } from 'vitest';
import { SETTINGS, findSection, searchSettings, settingPath } from './manifest';

describe('the settings map', () => {
  it('has the sections in a fixed order, each with at least one subpage', () => {
    expect(SETTINGS.map((s) => s.id)).toEqual(['general', 'appearance', 'notifications', 'keyboard', 'providers', 'model', 'voice', 'usage', 'safety', 'memory', 'privacy', 'browser', 'mail', 'calendar', 'sessions', 'schedules', 'extensions', 'advanced', 'about']);
    // Under headings, as in System Settings.
    expect([...new Set(SETTINGS.map((s) => s.group))]).toEqual(['Mobius', 'Models', 'Safety', 'Apps', 'System']);
    for (const section of SETTINGS) {
      expect(section.label).not.toBe('');
      expect(section.subpages.length).toBeGreaterThan(0);
    }
  });

  it('gives every row a unique path and some words to search by', () => {
    const paths = SETTINGS.flatMap((s) => s.subpages.flatMap((p) => p.rows.map((r) => settingPath(s.id, p.id, r.id))));
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.length).toBeGreaterThanOrEqual(20);
    for (const section of SETTINGS) for (const page of section.subpages) for (const row of page.rows) {
      expect(row.label, settingPath(section.id, page.id, row.id)).not.toBe('');
      expect(row.description, settingPath(section.id, page.id, row.id)).not.toBe('');
    }
  });

  it('finds a section by id and says nothing for an unknown one', () => {
    expect(findSection('model')?.label).toBe('Models');
    expect(findSection('providers')?.label).toBe('Gateways');
    expect(findSection('nope')).toBeUndefined();
  });
});

describe('searching settings', () => {
  const top = (query: string) => searchSettings(query)[0];

  it('finds a setting by its name, wherever it lives', () => {
    expect(top('theme')).toMatchObject({ section: 'appearance', subpage: 'theme', row: 'theme' });
    expect(top('api key')).toMatchObject({ section: 'providers', row: 'api-key' });
    expect(top('shortcuts')).toMatchObject({ section: 'keyboard' });
    expect(top('delete conversation')).toMatchObject({ section: 'sessions' });
    expect(top('gguf')).toMatchObject({ section: 'model', subpage: 'local' });
    expect(top('vram')).toMatchObject({ section: 'model', subpage: 'local', row: 'hardware' });
    expect(top('download model')).toMatchObject({ section: 'model', subpage: 'local' });
    expect(top('llama.cpp')).toMatchObject({ section: 'model', subpage: 'local' });
    expect(top('provider keys')).toMatchObject({ section: 'providers', subpage: 'keys', row: 'provider-keys' });
    expect(top('credentials')).toMatchObject({ section: 'providers' });
    expect(top('ollama')).toMatchObject({ section: 'providers', row: 'provider' });
    expect(top('browsing history')).toMatchObject({ section: 'browser', subpage: 'history' });
    expect(top('serif font')).toMatchObject({ section: 'appearance', row: 'chat-font' });
    expect(top('right to left')).toMatchObject({ section: 'appearance', row: 'text-direction' });
    expect(top('compact')).toMatchObject({ section: 'appearance', row: 'density' });
    expect(top('hide tool steps')).toMatchObject({ section: 'appearance', row: 'tool-steps' });
    expect(top('reopen last conversation')).toMatchObject({ section: 'general', row: 'resume-last' });
    expect(top('whisper')).toMatchObject({ section: 'voice' });
    expect(top('kokoro')).toMatchObject({ section: 'voice', subpage: 'speaking' });
    expect(top('elevenlabs')).toBeDefined();
    // Gateways is still found by its old name.
    expect(searchSettings('providers').some((h) => h.section === 'providers')).toBe(true);
    expect(top('context size')).toMatchObject({ section: 'model', subpage: 'local', row: 'context-size' });
    expect(top('context length')).toMatchObject({ section: 'model', subpage: 'local', row: 'context-size' });
    expect(searchSettings('provider').some((h) => h.section === 'providers' && h.row === 'provider-keys')).toBe(true);
    // A service's name finds Gateways (to connect it) first, then the model picker.
    expect(searchSettings('openrouter').every((h) => h.section === 'providers')).toBe(true);
    expect(top('local network')).toMatchObject({ section: 'browser', subpage: 'network', row: 'private-addresses' });
    expect(top('localhost')).toMatchObject({ section: 'browser', row: 'private-addresses' });
    expect(top('approval mode')).toMatchObject({ section: 'safety', subpage: 'approvals', row: 'approval-mode' });
    expect(top('smart approvals')).toMatchObject({ section: 'safety', row: 'approval-mode' });
    expect(top('yolo')).toMatchObject({ section: 'safety', row: 'approval-mode' });
    expect(top('auto hide')).toMatchObject({ section: 'appearance', subpage: 'layout' });
    expect(top('resize')).toMatchObject({ section: 'appearance', row: 'sidebar-size' });
    expect(top('rebind')).toMatchObject({ section: 'keyboard', row: 'shortcut-list' });
    expect(top('global shortcut')).toMatchObject({ section: 'keyboard', row: 'quick-entry' });
    expect(top('second model')).toMatchObject({ section: 'providers', row: 'fallback' });
    expect(top('fallback')).toMatchObject({ section: 'providers', row: 'fallback' });
    expect(top('notify me')).toMatchObject({ section: 'notifications', subpage: 'alerts' });
    expect(top('do not disturb')).toMatchObject({ section: 'notifications' });
    expect(top('mute sounds')).toMatchObject({ section: 'notifications', subpage: 'sounds' });
    expect(top('keep awake')).toMatchObject({ section: 'general', subpage: 'general', row: 'keep-awake' });
    expect(top('prevent sleep')).toMatchObject({ section: 'general', row: 'keep-awake' });
    expect(top('bookmarks')).toMatchObject({ section: 'browser', subpage: 'bookmarks' });
    expect(top('clear history')).toMatchObject({ section: 'browser', subpage: 'history' });
  });

  it('finds a setting by what it is about, not only by its name', () => {
    expect(top('revoke')).toMatchObject({ section: 'safety', subpage: 'approvals' });
    expect(top('dark')).toMatchObject({ section: 'appearance' });
    expect(top('zoom')).toMatchObject({ section: 'appearance' });
    expect(top('log')).toMatchObject({ section: 'safety', subpage: 'activity' });
  });

  it('wants every word to match, ignores case and extra spaces', () => {
    expect(searchSettings('  THEME   dark ').length).toBeGreaterThan(0);
    expect(searchSettings('theme penguin')).toEqual([]);
  });

  it('shows nothing for an empty or meaningless query', () => {
    expect(searchSettings('')).toEqual([]);
    expect(searchSettings('   ')).toEqual([]);
    expect(searchSettings('qqqzzz')).toEqual([]);
  });

  it('puts a match in the name ahead of one that is only in the description', () => {
    const hits = searchSettings('sites');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.label.toLowerCase()).toContain('sites');
  });

  it('is not fooled by characters that mean something in patterns', () => {
    expect(() => searchSettings('(*[')).not.toThrow();
    expect(searchSettings('(*[')).toEqual([]);
  });
});
