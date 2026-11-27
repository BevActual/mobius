import { useCallback, useEffect, useRef, useState } from 'react';
import { isNotesFailure, type BrowserEmulation, type CodePreviewReport } from '@mobius/shared';
import { besideUrlOk, openBeside } from './beside';
import type { CodeState } from './useCode';

/**
 * Code's preview: the project's folder served on this computer (crates/mobius-host, `code.preview`) and shown in the
 * Browser beside the editor. Saving reloads it; the page's errors come back here with a way to Mobius; Pick lets the
 * person click an element on the page and go to its code.
 */
export type PreviewError = Extract<CodePreviewReport, { kind: 'error' }>;
export type PreviewPick = Extract<CodePreviewReport, { kind: 'pick' }>;

const MAX_ERRORS = 20;

/** The screens a preview can be shown on, as browsers' device bars offer them: a width in CSS pixels, or the tab's own. */
export const SCREENS: readonly { name: string; width: number | null }[] = [
  { name: 'Full width', width: null },
  { name: 'Laptop', width: 1280 },
  { name: 'Tablet', width: 820 },
  { name: 'Phone', width: 390 },
];

/** The Browser tab showing the preview: the first whose page is on the preview's server. */
export function previewTab(tabs: readonly { id: string; url: string }[], base: string | null): string | null {
  if (!base) return null;
  try {
    const origin = new URL(base).origin;
    return tabs.find((t) => { try { return new URL(t.url).origin === origin; } catch { return false; } })?.id ?? null;
  } catch {
    return null;
  }
}

/** A page's own path (`/`, `/about.html`, `/src/app.js?x`) as a file in the project; `/` is its index.html. */
export function pagePath(path: string | undefined): string {
  const p = decodeURIComponent((path ?? '/').split(/[?#]/)[0] ?? '/').replace(/^\/+/, '');
  return p === '' || p.endsWith('/') ? `${p}index.html` : p;
}

/** Where an error's source is in the project, when it is one of the preview's own files. */
export function sourcePath(source: string | undefined, base: string | null): string | null {
  if (!source) return null;
  try {
    const u = new URL(source, base ?? undefined);
    if (base && u.origin !== new URL(base).origin) return null;
    return pagePath(u.pathname);
  } catch {
    return null;
  }
}

/**
 * The line an element picked on a page starts on in its file: by its id, then by its opening tag as written, then
 * by its text. -1 when none is found.
 */
export function pickedLine(fileText: string, pick: Pick<PreviewPick, 'selector' | 'html' | 'text' | 'tag'>): number {
  const lines = fileText.split('\n');
  const find = (needle: string) => (needle ? lines.findIndex((l) => l.includes(needle)) : -1);
  const id = /#([\w-]+)/.exec(pick.selector ?? '')?.[1];
  if (id) {
    const at = lines.findIndex((l) => new RegExp(`\\bid\\s*=\\s*["']${id}["']`).test(l));
    if (at >= 0) return at;
  }
  const open = /^<[^>]*>/.exec((pick.html ?? '').trim())?.[0];
  if (open) {
    const at = find(open);
    if (at >= 0) return at;
    // As written it may differ (attributes on more lines): the tag and its first attribute.
    const tag = /^<([\w-]+)/.exec(open)?.[1];
    const attr = /^<[\w-]+\s+([\w-]+(=("[^"]*"|'[^']*'|[^\s>]+))?)/.exec(open)?.[1];
    if (tag) {
      const opens = new RegExp(`<${tag}(\\s|>|$)`);
      const near = lines.findIndex((l, i) => opens.test(l) && (!attr || lines.slice(i, i + 5).join(' ').includes(attr)));
      if (near >= 0) return near;
    }
  }
  const words = (pick.text ?? '').trim().split('\n')[0]?.trim().slice(0, 60) ?? '';
  return words.length >= 3 ? find(words) : -1;
}

export function useCodePreview(code: CodeState) {
  const api = window.mobius.code;
  const project = code.project;
  const [url, setUrl] = useState<string | null>(null);
  const [errors, setErrors] = useState<PreviewError[]>([]);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<PreviewPick | null>(null);
  const [message, setMessage] = useState('');
  /** The Browser tab showing it, and the screen that tab gives the page (null: its own). */
  const [tab, setTab] = useState<{ id: string; emulation: BrowserEmulation | null } | null>(null);
  const live = useRef({ project, url });
  live.current = { project, url };
  useEffect(() => {
    const browser = window.mobius.browser;
    if (!url || !browser?.onState) { setTab(null); return undefined; }
    const read = (tabs: readonly { id: string; url: string; emulation?: BrowserEmulation | null }[]) => {
      const id = previewTab(tabs, url);
      const found = id ? tabs.find((t) => t.id === id) : undefined;
      setTab(found ? { id: found.id, emulation: found.emulation ?? null } : null);
    };
    void browser.getState?.().then((s) => read(s.tabs)).catch(() => null);
    return browser.onState((s) => read(s.tabs));
  }, [url]);
  /** Shows the preview on another screen: a width, light or dark; what is not given stays as it is. */
  const screen = useCallback((change: BrowserEmulation) => {
    if (!tab || !window.mobius.browser?.emulate) return;
    const next = { ...(tab.emulation ?? {}), ...change };
    const clean: BrowserEmulation = {};
    if (next.width) clean.width = next.width;
    if (next.colorScheme) clean.colorScheme = next.colorScheme;
    window.mobius.browser.emulate(tab.id, clean);
    setTab({ id: tab.id, emulation: Object.keys(clean).length > 0 ? clean : null });
  }, [tab]);

  // Another project: its preview stops, and nothing of the last one shows.
  useEffect(() => {
    setUrl(null); setErrors([]); setPicking(false); setPicked(null); setMessage('');
    return () => { if (project) void api?.stopPreview?.(project).catch(() => null); };
  }, [api, project]);

  useEffect(() => {
    if (!api?.onPreview) return undefined;
    return api.onPreview((report) => {
      if (report.project !== live.current.project) return;
      if (report.kind === 'error') setErrors((was) => [...was, report].slice(-MAX_ERRORS));
      else if (report.kind === 'pick') { setPicking(false); setPicked(report); }
      else if (report.kind === 'pickCancelled') setPicking(false);
    });
  }, [api]);

  /** Shows the preview beside Code: the open page when it is one, else the project's index. */
  const open = useCallback(async () => {
    if (!api?.preview || !project) return;
    const got = await api.preview(project).catch(() => null);
    if (!got || isNotesFailure(got)) { setMessage(got?.message ?? 'The preview could not start.'); return; }
    const page = code.open && /\.html?$/i.test(code.open.path) ? code.open.path.split('/').map(encodeURIComponent).join('/') : '';
    const target = new URL(page, got.url).toString();
    if (!besideUrlOk(target)) return;
    setUrl(got.url);
    setMessage('');
    openBeside({ app: 'browser', url: target });
  }, [api, project, code.open]);

  const say = useCallback(async (what: 'reload' | 'pick' | 'stopPick') => {
    const now = live.current;
    if (!api?.previewSay || !now.project || !now.url) return 0;
    // A page loaded again starts with no errors; those it still has come back as it runs.
    if (what === 'reload') setErrors([]);
    const done = await api.previewSay(now.project, what).catch(() => null);
    return done && !isNotesFailure(done) ? done.pages : 0;
  }, [api]);

  // Live refresh: each save of a file, the person's or Mobius's, reloads the pages showing.
  const saved = code.open?.modified;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (live.current.url) void say('reload');
  }, [saved, say]);
  useEffect(() => {
    if (!api) return undefined;
    return api.onChanged((change) => { if (live.current.url && (!change.project || change.project === live.current.project)) void say('reload'); });
  }, [api, say]);

  const pick = useCallback(async () => {
    if (picking) { setPicking(false); await say('stopPick'); return; }
    if (!live.current.url) await open();
    setPicked(null);
    const pages = await say('pick');
    if (pages > 0) setPicking(true);
    else setMessage('Open the preview first, then pick.');
  }, [open, picking, say]);

  return { url, tab, screen, errors, clearErrors: () => setErrors([]), picking, picked, clearPicked: () => setPicked(null), message, open, reload: () => say('reload'), pick };
}
export type PreviewState = ReturnType<typeof useCodePreview>;
