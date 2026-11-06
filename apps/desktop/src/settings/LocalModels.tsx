import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { CONTEXT_SIZES, type Hardware, type LocalEntry, type ModelsEvent, type Recommendation, type RuntimeSnapshot } from '@mobius/shared';
import { usePreferences } from '../usePreferences';
import { Empty, Row } from './primitives';
import { compactCount, fitText, formatBytes, hardwareSummary, modelTitle, paramsText, percent } from './models-format';

interface DownloadState {
  repo: string;
  file: string;
  done: number;
  total: number;
  error: string | null;
  running: boolean;
}

type Search = { state: 'idle' } | { state: 'searching' } | { state: 'done'; results: Recommendation[]; query: string } | { state: 'failed'; error: string };

function useModels() {
  const [hardware, setHardware] = useState<Hardware | null>(null);
  const [local, setLocal] = useState<LocalEntry[]>([]);
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>({ binary: null, runtime: null });
  const [download, setDownload] = useState<DownloadState | null>(null);
  const [search, setSearch] = useState<Search>({ state: 'idle' });
  const [problem, setProblem] = useState<string | null>(null);
  const live = useRef(true);

  const refreshLocal = useCallback(async () => {
    const entries = await window.mobius.models.local();
    if (live.current) setLocal(entries);
  }, []);

  useEffect(() => {
    live.current = true;
    void window.mobius.models.hardware().then((h) => live.current && setHardware(h));
    void window.mobius.models.status().then((s) => live.current && setSnapshot(s));
    void refreshLocal();
    const off = window.mobius.models.onEvent((event: ModelsEvent) => {
      if (!live.current) return;
      if (event.kind === 'runtime') setSnapshot(event.snapshot);
      else if (event.kind === 'progress') setDownload((d) => (d ? { ...d, done: event.done, total: event.total } : d));
      else if (event.kind === 'download') {
        if (event.state === 'started') setDownload({ repo: event.repo, file: event.file, done: 0, total: 0, error: null, running: true });
        else {
          setDownload((d) => (d ? { ...d, running: false, error: event.state === 'failed' ? (event.error ?? 'It did not work.') : null } : d));
          void refreshLocal();
        }
      }
    });
    return () => {
      live.current = false;
      off();
    };
  }, [refreshLocal]);

  const find = useCallback(async (query: string) => {
    setSearch({ state: 'searching' });
    const result = await window.mobius.models.discover(query);
    if (!live.current) return;
    setSearch(result.ok ? { state: 'done', results: result.results, query } : { state: 'failed', error: result.error });
  }, []);

  const get = useCallback(async (repo: string, file: string) => {
    setProblem(null);
    const result = await window.mobius.models.download(repo, file);
    if (live.current && !result.ok && result.error !== 'cancelled') setProblem(result.error);
  }, []);

  const run = useCallback(async (id: string, context: number) => {
    setProblem(null);
    const result = await window.mobius.models.start(id, context);
    if (live.current && !result.ok) setProblem(result.error);
  }, []);

  const stop = useCallback(async () => {
    const result = await window.mobius.models.stop();
    if (live.current && !result.ok) setProblem(result.error);
  }, []);

  return { hardware, local, snapshot, download, search, problem, find, get, run, stop, cancel: () => void window.mobius.models.cancelDownload() };
}

function FitBadge({ fit }: { fit: Recommendation['assessment']['fit'] }) {
  const { label, tone } = fitText(fit);
  return <span className="badge" data-tone={tone}>{label}</span>;
}

export function LocalModelsSection({ subpage, highlight }: { subpage: string; highlight: string | null }) {
  const models = useModels();
  const preferences = usePreferences();
  const [query, setQuery] = useState('');
  const path = (row: string) => `model.${subpage}.${row}`;
  const { snapshot, download } = models;
  const runtime = snapshot.runtime;
  const downloaded = new Set(models.local.map((entry) => `${entry.model.repo ?? ''}/${entry.model.file}`));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void models.find(query);
  };

  return (
    <>
      <Row path={path('hardware')} title="Your computer" description="The graphics card and memory models have to fit in." highlight={highlight === 'hardware'}>
        <p className="srow-text">{models.hardware ? hardwareSummary(models.hardware) : 'Looking…'}</p>
      </Row>

      <Row path={path('running')} title="Running now" description="The model Mobius is running for the agent." highlight={highlight === 'running'}>
        {snapshot.binary === null && runtime === null ? (
          <Empty>llama.cpp (llama-server) was not found on this computer, so models cannot be run here yet. If it is installed somewhere unusual, set MOBIUS_LLAMA_SERVER to its path.</Empty>
        ) : runtime === null ? (
          <Empty>Nothing is running.</Empty>
        ) : (
          <div className="running" role="status">
            <div className="running-head">
              <strong>{runtime.model}</strong>
              <span className="badge" data-tone={runtime.state === 'ready' ? 'good' : runtime.state === 'failed' ? 'bad' : 'warn'}>
                {{ starting: 'Loading…', ready: 'Ready', failed: 'Stopped with a problem', stopped: 'Stopped' }[runtime.state]}
              </span>
              <button type="button" className="btn" onClick={() => void models.stop()}>Stop</button>
            </div>
            {runtime.state === 'ready' && runtime.usingForAssistant && <p className="srow-text">The agent is using this model.</p>}
            {runtime.reason && <p className="field-error" role="alert">{runtime.reason}</p>}
            {runtime.log.length > 0 && (
              <details>
                <summary>Details</summary>
                <pre className="mono log">{runtime.log.join('\n')}</pre>
              </details>
            )}
          </div>
        )}
        {models.problem && <p className="field-error" role="alert">{models.problem}</p>}
      </Row>

      <Row path={path('context-size')} title="Context size" description="How much text a model keeps in view. A larger size remembers more of a long conversation but uses more graphics memory. It applies the next time you run a model." highlight={highlight === 'context-size'}>
        <label className="field compact">
          <span>Context size</span>
          <select value={preferences.value.localContext} onChange={(event) => void preferences.set({ localContext: Number(event.target.value) })}>
            {CONTEXT_SIZES.map((size) => <option key={size} value={size}>{size.toLocaleString('en-US')} tokens</option>)}
          </select>
        </label>
      </Row>

      <Row path={path('local-models')} title="On this computer" description="Models you have downloaded. Run one to use it for the agent." highlight={highlight === 'local-models'}>
        {models.local.length === 0 ? (
          <Empty>No models yet. Find one below and download it.</Empty>
        ) : (
          <ul className="slist" aria-label="Models on this computer">
            {models.local.map(({ model, assessment }) => {
              const { name, from } = modelTitle(model);
              const running = runtime?.modelId === model.id && runtime.state !== 'stopped' && runtime.state !== 'failed';
              return (
                <li key={model.id} className="slist-item">
                  <div className="slist-main">
                    <span>{name}</span>
                    <span className="slist-sub">{[from, model.quant, formatBytes(model.size)].filter(Boolean).join(' · ')}</span>
                  </div>
                  <FitBadge fit={assessment.fit} />
                  {running ? (
                    <button type="button" className="btn" aria-label={`Stop ${name}`} onClick={() => void models.stop()}>Stop</button>
                  ) : (
                    <button type="button" className="btn primary" aria-label={`Run ${name}`} disabled={assessment.fit === 'too_big' || snapshot.binary === null} onClick={() => void models.run(model.id, preferences.value.localContext)}>Run</button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Row>

      <Row path={path('find-models')} title="Find models" description="Search Hugging Face, or let Mobius suggest what will run well here, and download one." highlight={highlight === 'find-models'}>
        <form className="inline-form" onSubmit={submit}>
          <label className="field compact wide">
            <span>Search Hugging Face</span>
            <input type="search" value={query} maxLength={100} placeholder="For example: qwen coder" onChange={(event) => setQuery(event.target.value)} />
          </label>
          <button type="submit" className="btn" disabled={models.search.state === 'searching' || query.trim() === ''}>Search</button>
          <button type="button" className="btn primary" disabled={models.search.state === 'searching'} onClick={() => void models.find('')}>Suggest for this computer</button>
        </form>
        <p className="srow-note">Searching sends your words to huggingface.co. Nothing else leaves this computer.</p>

        {download && (
          <div className="download" role="group" aria-label="Download">
            <span className="slist-sub">{download.running ? 'Downloading' : download.error ? 'Download stopped' : 'Downloaded'} {download.file}</span>
            {download.running && (
              <>
                <progress aria-label="Download progress" max={100} value={percent(download.done, download.total)} />
                <span className="slist-sub size">{formatBytes(download.done)} of {formatBytes(download.total)}</span>
                <button type="button" className="btn" onClick={models.cancel}>Cancel</button>
              </>
            )}
            {download.error && download.error !== 'cancelled' && <span className="field-error" role="alert">{download.error}</span>}
            {download.error === 'cancelled' && <span className="slist-sub">Cancelled. Starting it again carries on where it stopped.</span>}
          </div>
        )}

        {models.search.state === 'searching' && <p className="srow-text" role="status">Looking…</p>}
        {models.search.state === 'failed' && <p className="field-error" role="alert">{models.search.error}</p>}
        {models.search.state === 'done' && models.search.results.length === 0 && <Empty>Nothing found that would run on this computer.</Empty>}
        {models.search.state === 'done' && models.search.results.length > 0 && (
          <ul className="slist" aria-label="Model results">
            {models.search.results.map((result) => {
              const { candidate } = result;
              const already = downloaded.has(`${candidate.repo}/${candidate.file}`);
              const name = modelTitle({ file: candidate.file, repo: null }).name;
              return (
                <li key={`${candidate.repo}/${candidate.file}`} className="slist-item">
                  <div className="slist-main">
                    <span>{candidate.repo}</span>
                    <span className="slist-sub">{[paramsText(result.params_b), candidate.quant || 'unlabelled', formatBytes(candidate.size), `${compactCount(candidate.downloads)} downloads`].join(' · ')}</span>
                  </div>
                  <FitBadge fit={result.assessment.fit} />
                  {already ? (
                    <span className="slist-sub">Downloaded</span>
                  ) : (
                    <button type="button" className="btn" aria-label={`Download ${name}`} disabled={download?.running === true} onClick={() => void models.get(candidate.repo, candidate.file)}>Download</button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Row>
    </>
  );
}
