import { useCallback, useEffect, useRef, useState } from 'react';
import type { CodeAnswer, CodeCompletion, CodeLanguage, CodePlace, CodeProblem, CodeTextEdit } from '@mobius/shared';
import type { CodeState } from './useCode';

/**
 * Language smarts for the Code app, from a language server on this computer (crates/mobius-host/src/code_lsp.rs):
 * the open file's text is sent as it changes, problems come back for every file, and the editor asks about a place
 * (completions, hover, go to definition, rename, format). Places are lines and UTF-16 columns, which is how
 * JavaScript counts a string, so an offset is the line's start plus the column.
 */

const FORMAT_KEY = 'mobius.code.formatOnSave';
const SYNC_DELAY = 250;

export function offsetOf(starts: readonly number[], textLength: number, line: number, character: number): number {
  const s = starts[Math.max(0, Math.min(line, starts.length - 1))] ?? 0;
  const end = line + 1 < starts.length ? starts[line + 1]! - 1 : textLength;
  if (line >= starts.length) return textLength;
  return Math.min(s + character, end);
}

/** Edits given as lines and columns, as offsets into the text, in order. */
export function spansOf(text: string, starts: readonly number[], edits: readonly CodeTextEdit[]): { from: number; to: number; insert: string }[] {
  return edits
    .map((e) => ({ from: offsetOf(starts, text.length, e.line, e.character), to: offsetOf(starts, text.length, e.endLine, e.endCharacter), insert: e.text }))
    .filter((e) => e.from <= e.to)
    .sort((a, b) => a.from - b.from);
}

/** The text after edits. */
export function applyTextEdits(text: string, starts: readonly number[], edits: readonly CodeTextEdit[]): string {
  let out = text;
  for (const e of spansOf(text, starts, edits).reverse()) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return out;
}

/** The completions that fit what was typed so far: those starting with it first, then those holding its letters in order. */
export function fitting(items: readonly CodeCompletion[], typed: string): CodeCompletion[] {
  if (!typed) return [...items];
  const t = typed.toLowerCase();
  const starts: CodeCompletion[] = [];
  const holds: CodeCompletion[] = [];
  for (const item of items) {
    const f = item.filter.toLowerCase();
    if (f.startsWith(t)) starts.push(item);
    else {
      let at = 0;
      for (const ch of f) if (ch === t[at]) at += 1;
      if (at === t.length) holds.push(item);
    }
  }
  return [...starts, ...holds];
}

export type LanguageStatus = { kind: 'none' } | { kind: 'server'; server: string } | { kind: 'missing'; language: string; program: string | null };

const statusOf = (answer: CodeLanguage): LanguageStatus => {
  if (answer.ok) return { kind: 'server', server: answer.server };
  if ('missing' in answer) return { kind: 'missing', language: answer.language, program: answer.program };
  return { kind: 'none' };
};

export function useLanguage(code: CodeState) {
  const api = window.mobius.code;
  const project = code.project;
  const path = code.open?.text != null ? code.open.path : null;
  const [status, setStatus] = useState<LanguageStatus>({ kind: 'none' });
  const [problems, setProblems] = useState<ReadonlyMap<string, CodeProblem[]>>(new Map());
  const [formatOnSave, setFormatOnSaveState] = useState<boolean>(() => { try { return window.localStorage.getItem(FORMAT_KEY) === '1'; } catch { return false; } });
  const setFormatOnSave = (on: boolean) => { setFormatOnSaveState(on); try { window.localStorage.setItem(FORMAT_KEY, on ? '1' : '0'); } catch { /* Not kept. */ } };
  /** A place to go to once its file is open (go to definition in another file, a problem in the list). */
  const pending = useRef<CodePlace | null>(null);
  const [pendingVersion, setPendingVersion] = useState(0);
  const sent = useRef<{ key: string; text: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const live = useRef({ project, path, draft: code.draft });
  live.current = { project, path, draft: code.draft };

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const now = live.current;
    if (!api || !now.project || !now.path) return;
    const key = `${now.project}\u0001${now.path}`;
    if (sent.current?.key === key && sent.current.text === now.draft) return;
    sent.current = { key, text: now.draft };
    const answer = await api.lspSync(now.project, now.path, now.draft).catch(() => null);
    if (answer && live.current.path === now.path) setStatus(statusOf(answer));
  }, [api]);

  // The open file is sent when it opens and a moment after each change; closed when another one opens.
  useEffect(() => {
    if (!project || !path) { setStatus({ kind: 'none' }); return undefined; }
    void flush();
    return () => {
      sent.current = null;
      if (api) void api.lspClose(project, path).catch(() => null);
    };
  }, [api, project, path, flush]);
  useEffect(() => {
    if (!path) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SYNC_DELAY);
  }, [code.draft, path, flush]);

  useEffect(() => {
    setProblems(new Map());
    if (!api || !project) return undefined;
    let on = true;
    void api.lspProblems(project).then((all) => { if (on) setProblems(new Map(all.map((f) => [f.path, f.items]))); }).catch(() => null);
    const off = api.onProblems((event) => {
      if (event.project !== live.current.project) return;
      setProblems((was) => { const next = new Map(was); if (event.items.length) next.set(event.path, event.items); else next.delete(event.path); return next; });
    });
    return () => { on = false; off(); };
  }, [api, project]);

  /** A question about a place in the open file, asked once the server has its latest text. */
  const ask = useCallback(async (kind: 'complete' | 'hover' | 'definition' | 'rename' | 'format', line: number, character: number, extra?: string): Promise<CodeAnswer> => {
    const now = live.current;
    if (!api || !now.project || !now.path) return { ok: false };
    await flush();
    return api.lspAsk(now.project, now.path, kind, line, character, extra).catch(() => ({ ok: false as const }));
  }, [api, flush]);

  /** Opens a place: in the open file at once, else once its file has opened. */
  const goTo = useCallback(async (place: CodePlace) => {
    pending.current = place;
    setPendingVersion((v) => v + 1);
    if (place.path !== live.current.path) await code.openFile(place.path);
  }, [code]);
  const takePending = useCallback((forPath: string): CodePlace | null => {
    const p = pending.current;
    if (!p || p.path !== forPath) return null;
    pending.current = null;
    return p;
  }, []);

  /** Other files' parts of a rename, written on disk. */
  const applyElsewhere = useCallback(async (files: { path: string; edits: CodeTextEdit[] }[]) => {
    const now = live.current;
    if (!api || !now.project || files.length === 0) return;
    const done = await api.applyEdits(now.project, files).catch(() => null);
    if (done && !done.ok) code.setMessage(done.message);
  }, [api, code]);

  /** Save, formatted first when Format on save is on and a server can format. */
  const save = useCallback(async () => {
    const now = live.current;
    if (formatOnSave && status.kind === 'server' && now.path) {
      const answer = await ask('format', 0, 0);
      if (answer.ok && answer.edits && answer.edits.length > 0) {
        const text = live.current.draft;
        const starts = [0];
        for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) starts.push(i + 1);
        const formatted = applyTextEdits(text, starts, answer.edits);
        if (formatted !== text) { code.setDraft(formatted); return code.save(formatted); }
      }
    }
    return code.save();
  }, [ask, code, formatOnSave, status.kind]);

  const counts = { errors: 0, warnings: 0 };
  for (const items of problems.values()) for (const p of items) { if (p.severity === 'error') counts.errors += 1; else if (p.severity === 'warning') counts.warnings += 1; }

  return { status, problems, counts, ask, goTo, takePending, pendingVersion, applyElsewhere, save, formatOnSave, setFormatOnSave };
}
export type LanguageState = ReturnType<typeof useLanguage>;
