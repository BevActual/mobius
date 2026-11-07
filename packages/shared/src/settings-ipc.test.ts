import { DEFAULT_KEYBINDINGS } from './keys';
import { describe, expect, it } from 'vitest';
import { CONTEXT_SIZES, DEFAULT_APPEARANCE, DEFAULT_PREFERENCES, parseContextSize, parsePreferencesPatch, parseActivityLimit, parseAppearancePatch, parseConfigureRequest, parseGrantId } from './ipc';

describe('appearance changes', () => {
  it('accepts any of the three settings alone or together, and drops anything else', () => {
    expect(parseAppearancePatch({ theme: 'dark' })).toEqual({ theme: 'dark' });
    expect(parseAppearancePatch({ zoom: 1.25, chatTextScale: 1.1 })).toEqual({ zoom: 1.25, chatTextScale: 1.1 });
    expect(parseAppearancePatch({ theme: 'light', evil: 1 })).toEqual({ theme: 'light' });
  });
  it('refuses unknown themes, out of range sizes and values that are not numbers', () => {
    for (const bad of [null, 'dark', [], {}, { evil: 1 }, { theme: 'purple' }, { theme: 3 }, { zoom: 0.5 }, { zoom: 2 }, { zoom: NaN }, { zoom: Infinity }, { zoom: '1' }, { chatTextScale: 0.2 }, { chatTextScale: 3 }, { theme: 'dark', zoom: 9 }]) {
      expect(parseAppearancePatch(bad), JSON.stringify(bad)).toBeNull();
    }
  });
  it('has sensible defaults', () => {
    expect(DEFAULT_APPEARANCE).toEqual({ theme: 'system', zoom: 1, chatTextScale: 1, chatFont: 'system', textDirection: 'auto', density: 'comfortable', toolSteps: 'show', sidebarAtStart: true, resumeLast: true, leftSidebar: 'attached', navigation: 'sidebar', rightSidebar: 'attached', leftWidth: 248, rightWidth: 380 });
  });
});

describe('more appearance choices', () => {
  it('accept each of the named choices and the two switches', () => {
    expect(parseAppearancePatch({ chatFont: 'serif', textDirection: 'rtl', density: 'compact', toolSteps: 'hide-finished', sidebarAtStart: false, resumeLast: false })).toEqual({ chatFont: 'serif', textDirection: 'rtl', density: 'compact', toolSteps: 'hide-finished', sidebarAtStart: false, resumeLast: false });
  });
  it('refuse anything that is not one of the choices', () => {
    for (const bad of [{ chatFont: 'comic' }, { chatFont: 3 }, { textDirection: 'up' }, { density: 'tiny' }, { toolSteps: 'all' }, { sidebarAtStart: 'yes' }, { resumeLast: 1 }, { chatFont: 'mono', density: 'x' }]) {
      expect(parseAppearancePatch(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('grant ids and activity limits', () => {
  it('want whole positive numbers', () => {
    expect(parseGrantId(7)).toBe(7);
    for (const bad of [0, -1, 1.5, '7', null, undefined, NaN, Number.MAX_SAFE_INTEGER + 1]) expect(parseGrantId(bad)).toBeNull();
  });
  it('keep the number of activity entries within bounds', () => {
    expect(parseActivityLimit(undefined)).toBe(50);
    expect(parseActivityLimit(10)).toBe(10);
    expect(parseActivityLimit(1000)).toBe(200);
    expect(parseActivityLimit(0)).toBe(1);
    expect(parseActivityLimit('x')).toBe(50);
    expect(parseActivityLimit(2.7)).toBe(2);
  });
});

describe('the step limit', () => {
  const base = { baseUrl: 'https://x.example/v1', model: 'm' };
  it('is a whole number from 1 to 100', () => {
    expect(parseConfigureRequest({ ...base, maxSteps: 40 })).toEqual({ ...base, maxSteps: 40 });
    for (const bad of [0, 101, 1.5, '5', -3, NaN]) expect(parseConfigureRequest({ ...base, maxSteps: bad }), String(bad)).toBeNull();
    expect(parseConfigureRequest({ ...base, maxSteps: undefined })).toEqual(base);
  });
});

describe('context sizes for local models', () => {
  it('are a short list, and 16384 is among them', () => {
    expect(CONTEXT_SIZES).toEqual([4096, 8192, 16384, 32768, 65536]);
  });
  it('accept a listed size and nothing else; no size means the default', () => {
    expect(parseContextSize(32768)).toBe(32768);
    expect(parseContextSize(undefined)).toBeUndefined();
    for (const bad of [0, 1, 5000, 131072, -4096, 4096.5, NaN, Infinity, '8192', null, {}]) expect(parseContextSize(bad), String(bad)).toBeNull();
  });
  it('can be chosen as a preference, but only from the list', () => {
    expect(parsePreferencesPatch({ localContext: 8192 })).toEqual({ localContext: 8192 });
    for (const bad of [{ localContext: 5000 }, { localContext: '8192' }, { localContext: 0 }]) expect(parsePreferencesPatch(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe('where the sidebars sit', () => {
  it('start attached, and each can be set to floating or back, and nothing else', () => {
    expect(DEFAULT_APPEARANCE).toMatchObject({ leftSidebar: 'attached', rightSidebar: 'attached', leftWidth: 248, rightWidth: 380 });
    expect(parseAppearancePatch({ leftSidebar: 'floating' })).toEqual({ leftSidebar: 'floating' });
    expect(parseAppearancePatch({ navigation: 'rail' })).toEqual({ navigation: 'rail' });
    for (const bad of ['tabs', true, null]) expect(parseAppearancePatch({ navigation: bad }), String(bad)).toBeNull();
    expect(parseAppearancePatch({ rightSidebar: 'floating', leftSidebar: 'attached' })).toEqual({ rightSidebar: 'floating', leftSidebar: 'attached' });
    for (const bad of ['hidden', 'pinned', '', 'Floating', 1, null, true]) {
      expect(parseAppearancePatch({ leftSidebar: bad }), String(bad)).toBeNull();
      expect(parseAppearancePatch({ rightSidebar: bad }), String(bad)).toBeNull();
    }
  });
});

describe('how wide the sidebars are', () => {
  it('start at the usual widths and accept only widths inside each side\'s range', () => {
    expect(DEFAULT_APPEARANCE).toMatchObject({ leftWidth: 248, rightWidth: 380 });
    expect(parseAppearancePatch({ leftWidth: 300, rightWidth: 500 })).toEqual({ leftWidth: 300, rightWidth: 500 });
    expect(parseAppearancePatch({ leftWidth: 200 })).toEqual({ leftWidth: 200 });
    expect(parseAppearancePatch({ leftWidth: 420 })).toEqual({ leftWidth: 420 });
    for (const bad of [199, 421, 0, -5, Number.NaN, Infinity, '300', null]) expect(parseAppearancePatch({ leftWidth: bad }), String(bad)).toBeNull();
    for (const bad of [299, 641, 100, Number.NaN, '400']) expect(parseAppearancePatch({ rightWidth: bad }), String(bad)).toBeNull();
    expect(parseAppearancePatch({ rightWidth: 250 }), 'a width fine for the left is too small for the right').toBeNull();
  });
});

describe('keyboard shortcuts in preferences', () => {
  it('start as the usual ones with quick entry off, and are replaced whole or not at all', () => {
    expect(DEFAULT_PREFERENCES.keybindings).toEqual(DEFAULT_KEYBINDINGS);
    const changed = { ...DEFAULT_KEYBINDINGS, launcher: 'mod+j', quickEntry: 'mod+alt+space' };
    expect(parsePreferencesPatch({ keybindings: changed })).toEqual({ keybindings: changed });
    expect(parsePreferencesPatch({ keybindings: { ...DEFAULT_KEYBINDINGS, launcher: 'mod+l' } }), 'two on one combination').toBeNull();
    expect(parsePreferencesPatch({ keybindings: { ...DEFAULT_KEYBINDINGS, launcher: 'k' } })).toBeNull();
    expect(parsePreferencesPatch({ keybindings: { launcher: 'mod+j' } }), 'a partial set').toBeNull();
    expect(parsePreferencesPatch({ keybindings: 'mod+k' })).toBeNull();
  });
});

describe('effort and dictation in preferences', () => {
  it('start at the model\'s own way and a usual speech model, and accept only known values', () => {
    expect(DEFAULT_PREFERENCES).toMatchObject({ reasoningEffort: '', dictationModel: 'whisper-1' });
    for (const effort of ['', 'none', 'low', 'medium', 'high']) expect(parsePreferencesPatch({ reasoningEffort: effort })).toEqual({ reasoningEffort: effort });
    for (const bad of ['extreme', 'HIGH', 'None', ' low', 3, null, true]) expect(parsePreferencesPatch({ reasoningEffort: bad }), String(bad)).toBeNull();
    expect(parsePreferencesPatch({ dictationModel: 'distil-whisper-large-v3-en' })).toEqual({ dictationModel: 'distil-whisper-large-v3-en' });
    for (const bad of ['', 'a\nb', 'x'.repeat(201), 5]) expect(parsePreferencesPatch({ dictationModel: bad }), String(bad)).toBeNull();
  });
});

describe('approval mode', () => {
  it('is manual unless the person chooses, and only manual, smart or off is accepted', () => {
    expect(DEFAULT_PREFERENCES.approvalMode).toBe('manual');
    for (const mode of ['manual', 'smart', 'off']) expect(parsePreferencesPatch({ approvalMode: mode })).toEqual({ approvalMode: mode });
    for (const bad of ['auto', 'yolo', 'never', '', 'Off', 'careful', 'standard', 'relaxed', 3, null, true]) expect(parsePreferencesPatch({ approvalMode: bad }), String(bad)).toBeNull();
  });
});

describe('preferences changes', () => {
  it('start with alerts on, sounds on and nothing kept awake', () => {
    expect(DEFAULT_PREFERENCES).toEqual({ notifyNeedsYou: true, notifyFinished: true, notifyDownloads: true, muteSounds: false, keepAwake: false, localContext: 16384, agentPrivateUrls: false, approvalMode: 'manual', keybindings: DEFAULT_KEYBINDINGS, reasoningEffort: '', dictationModel: 'whisper-1' });
  });
  it('keep the agent out of local addresses until the person says otherwise', () => {
    expect(DEFAULT_PREFERENCES.agentPrivateUrls).toBe(false);
    expect(parsePreferencesPatch({ agentPrivateUrls: true })).toEqual({ agentPrivateUrls: true });
    expect(parsePreferencesPatch({ agentPrivateUrls: 'yes' })).toBeNull();
  });
  it('accept any of the switches alone or together and drop unknown keys', () => {
    expect(parsePreferencesPatch({ muteSounds: true })).toEqual({ muteSounds: true });
    expect(parsePreferencesPatch({ notifyNeedsYou: false, keepAwake: true, evil: 1 })).toEqual({ notifyNeedsYou: false, keepAwake: true });
  });
  it('refuse anything that is not a plain true or false', () => {
    for (const bad of [null, 'x', [], {}, { evil: 1 }, { muteSounds: 'yes' }, { keepAwake: 1 }, { notifyFinished: null }, { notifyDownloads: true, muteSounds: 0 }]) {
      expect(parsePreferencesPatch(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('a second model in a configure request', () => {
  const base = { baseUrl: 'https://a.example/v1', model: 'm' };
  it('is accepted with an address and a model, and optionally a key', () => {
    expect(parseConfigureRequest({ ...base, fallback: { baseUrl: ' https://b.example/v1 ', model: ' n ' } })).toEqual({ ...base, fallback: { baseUrl: 'https://b.example/v1', model: 'n' } });
    expect(parseConfigureRequest({ ...base, fallback: { baseUrl: 'https://b.example/v1', model: 'n', apiKey: 'k', clearKey: true } })).toEqual({ ...base, fallback: { baseUrl: 'https://b.example/v1', model: 'n', apiKey: 'k', clearKey: true } });
  });
  it('can be left out, or empty, which means none', () => {
    expect(parseConfigureRequest({ ...base })).toEqual(base);
    expect(parseConfigureRequest({ ...base, fallback: null })).toEqual(base);
    expect(parseConfigureRequest({ ...base, fallback: undefined })).toEqual(base);
  });
  it('is refused when it is half given or oversize or the wrong type', () => {
    for (const bad of [{ baseUrl: 'https://b.example/v1' }, { model: 'n' }, { baseUrl: '', model: 'n' }, { baseUrl: 'https://b.example/v1', model: '' }, { baseUrl: 'x'.repeat(3000), model: 'n' }, { baseUrl: 'https://b.example/v1', model: 'n'.repeat(300) }, { baseUrl: 'https://b.example/v1', model: 'n', apiKey: 'k'.repeat(5000) }, { baseUrl: 'https://b.example/v1', model: 'n', clearKey: 'yes' }, 'text', 5, []]) {
      expect(parseConfigureRequest({ ...base, fallback: bad }), JSON.stringify(bad)).toBeNull();
    }
  });
  it('drops unknown fields inside it', () => {
    expect(parseConfigureRequest({ ...base, fallback: { baseUrl: 'https://b.example/v1', model: 'n', evil: 1 } })).toEqual({ ...base, fallback: { baseUrl: 'https://b.example/v1', model: 'n' } });
  });
});
