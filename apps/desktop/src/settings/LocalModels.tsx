import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { CONTEXT_SIZES, type EngineStatus, type Hardware, type LocalEntry, type ModelsEvent, type Recommendation, type RuntimeSnapshot } from '@mobius/shared';
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

interface EngineProgress { done: number; total: number }

/** The engine models run on: what is there, and installing or updating Mobius's own. */
function useEngine(onInstalled: () => void) {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [progress, setProgress] = useState<EngineProgress | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const live = useRef(true);
  // Right after Mobius starts, the core may not be ready to answer yet: ask again for a little while.
  const refresh = useCallback(() => {
    const ask = (tries: number) =>
      void window.mobius.models.engine().then((s) => {
        if (!live.current) return;
        if (s !== null) setStatus(s);
        else if (tries > 0) setTimeout(() => ask(tries - 1), 1000);
      });
    ask(20);
  }, []);
  useEffect(() => {
    live.current = true;
    refresh();
    const off = window.mobius.models.onEvent((event: ModelsEvent) => {
      if (!live.current || event.kind !== 'engine') return;
      if (event.state === 'started') setProgress({ done: 0, total: 0 });
      else if (event.state === 'progress') setProgress({ done: event.done ?? 0, total: event.total ?? 0 });
      else setProgress(null);
    });
    return () => {
      live.current = false;
      off();
    };
  }, [refresh]);
  const install = useCallback(async () => {
    setProblem(null);
    setNote(null);
    setProgress({ done: 0, total: 0 });
    const result = await window.mobius.models.installEngine();
    if (!live.current) return;
    setProgress(null);
    if (result.ok) setNote(result.upToDate ? 'Up to date.' : null);
    else if (result.error !== 'cancelled') setProblem(result.error);
    refresh();
    onInstalled();
  }, [refresh, onInstalled]);
  return { status, progress, note, problem, install, refresh, cancel: () => void window.mobius.models.cancelEngine() };
}

/** "CUDA0: NVIDIA GeForce RTX 4080 Laptop GPU (12281 MiB, 11000 MiB free)" -> "NVIDIA GeForce RTX 4080 Laptop GPU". */
const deviceName = (device: string) => device.replace(/^[A-Za-z]+\d*:\s*/, '').replace(/\s*\(.*\)\s*$/, '');

function EngineRow({ engine }: { engine: ReturnType<typeof useEngine> }) {
  const { status, progress } = engine;
  if (status === null) return <p className="srow-text">Looking…</p>;
  const mine = status.installed;
  const usingOther = status.using && status.using.source !== 'mobius' ? status.using : null;
  return (
    <div className="engine">
      {mine ? (
        <p className="srow-text">
          <strong>llama.cpp {mine.tag}</strong> · {mine.label}
          <br />
          {mine.devices.length > 0 ? `Runs on ${mine.devices.map(deviceName).join(', ')}.` : 'It found no graphics card it can use, so models run on the processor.'}
        </p>
      ) : (
        <p className="srow-text">Not installed.{usingOther ? ` Mobius is using the llama-server at ${usingOther.path}.` : ''}</p>
      )}
      {progress ? (
        <div className="engine-progress">
          <progress aria-label="Engine download" max={100} value={percent(progress.done, progress.total)} />
          <span className="srow-text">{progress.total > 0 ? `${formatBytes(progress.done)} of ${formatBytes(progress.total)}` : 'Finding the build for this computer…'}</span>
          <button type="button" className="btn" onClick={engine.cancel}>Cancel</button>
        </div>
      ) : !status.supported ? (
        <p className="srow-text">Mobius can install its engine on 64-bit Windows for now. Elsewhere, install llama.cpp and Mobius will find llama-server.</p>
      ) : mine ? (
        <button type="button" className="btn" onClick={() => void engine.install()}>Check for an update</button>
      ) : (
        <button type="button" className="btn primary" onClick={() => void engine.install()}>Install llama.cpp for {status.recommended}</button>
      )}
      {engine.note && <p className="srow-text" role="status">{engine.note}</p>}
      {engine.problem && <p className="field-error" role="alert">{engine.problem}</p>}
    </div>
  );
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
    // Only a list is a list: a failure or a late answer leaves none, never a page that cannot draw.
    if (live.current) setLocal(Array.isArray(entries) ? entries : []);
  }, []);

  useEffect(() => {
    live.current = true;
    void window.mobius.models.hardware().then((h) => live.current && setHardware(h));
    void window.mobius.models.status().then((s) => live.current && setSnapshot(s && typeof s === 'object' && 'runtime' in s ? s : { binary: null, runtime: null }));
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

  const refreshStatus = useCallback(() => void window.mobius.models.status().then((s) => live.current && setSnapshot(s)), []);
  return { hardware, local, snapshot, download, search, problem, find, get, run, stop, refreshStatus, refreshLocal, cancel: () => void window.mobius.models.cancelDownload() };
}

/** The best model for this computer: one already here that runs on the graphics card, else the top suggestion. */
export function pickModel(local: LocalEntry[], suggestions: Recommendation[]): { local: LocalEntry } | { download: Recommendation } | null {
  const order: Array<Recommendation['assessment']['fit']> = ['gpu', 'split'];
  for (const fit of order) {
    const here = local.find((entry) => entry.assessment.fit === fit);
    if (here) return { local: here };
  }
  for (const fit of order) {
    const found = suggestions.find((r) => r.assessment.fit === fit);
    if (found) return { download: found };
  }
  return null;
}

type SetupStep = 'engine' | 'choosing' | 'downloading' | 'starting' | 'done';
const SETUP_TEXT: Record<SetupStep, string> = {
  engine: 'Installing the engine…',
  choosing: 'Choosing a model that suits this computer…',
  downloading: 'Downloading the model…',
  starting: 'Starting the model…',
  done: 'Ready. The agent is using it.',
};

/** One button that does it all: the engine, a model that fits, the download, and running it for the agent. */
function useQuickSetup(models: ReturnType<typeof useModels>, engine: ReturnType<typeof useEngine>, context: number) {
  const [step, setStep] = useState<SetupStep | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const run = useCallback(async () => {
    setProblem(null);
    const fail = (message: string) => { setStep(null); setProblem(message); };
    if (engine.status?.supported && !engine.status.installed && !engine.status.using) {
      setStep('engine');
      const installed = await window.mobius.models.installEngine();
      engine.refresh();
      if (!installed.ok) return fail(installed.error === 'cancelled' ? 'Cancelled.' : installed.error);
    }
    setStep('choosing');
    const listed = await window.mobius.models.local();
    const local = Array.isArray(listed) ? listed : [];
    let choice = pickModel(local, []);
    if (!choice) {
      const found = await window.mobius.models.discover('');
      if (!found.ok) return fail(found.error);
      choice = pickModel([], found.results);
    }
    if (!choice) return fail('Nothing Mobius found would run well on this computer.');
    let id: string;
    if ('download' in choice) {
      setStep('downloading');
      const { repo, file } = choice.download.candidate;
      const got = await window.mobius.models.download(repo, file);
      if (!got.ok) return fail(got.error === 'cancelled' ? 'Cancelled. Starting again carries on where it stopped.' : got.error);
      const after = await window.mobius.models.local();
      const entry = (Array.isArray(after) ? after : []).find((e) => e.model.repo === repo && e.model.file === file);
      if (!entry) return fail('The download finished but the model was not found.');
      id = entry.model.id;
    } else id = choice.local.model.id;
    setStep('starting');
    const started = await window.mobius.models.start(id, context);
    if (!started.ok) return fail(started.error);
    void models.refreshLocal();
    setStep('done');
  }, [engine, models, context]);
  return { step, problem, run, busy: step !== null && step !== 'done' };
}

function FitBadge({ fit }: { fit: Recommendation['assessment']['fit'] }) {
  const { label, tone } = fitText(fit);
  return <span className="badge" data-tone={tone}>{label}</span>;
}

export function LocalModelsSection({ subpage, highlight }: { subpage: string; highlight: string | null }) {
  const models = useModels();
  const engine = useEngine(models.refreshStatus);
  const preferences = usePreferences();
  const setup = useQuickSetup(models, engine, preferences.value.localContext);
  const [autostart, setAutostart] = useState(false);
  useEffect(() => void window.mobius.models.autostart().then((a) => setAutostart(a.enabled)), []);
  const changeAutostart = async (on: boolean) => {
    setAutostart(on);
    const r = await window.mobius.models.setAutostart(on);
    if (!r.ok) setAutostart(!on);
  };
  const [query, setQuery] = useState('');
  const path = (row: string) => `model.${subpage}.${row}`;
  const { snapshot, download } = models;
  const runtime = snapshot.runtime;
  const downloaded = new Set(models.local.map((entry) => `${entry.model.repo ?? ''}/${entry.model.file}`));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void models.find(query);
  };

  const running = snapshot.runtime !== null && snapshot.runtime.state !== 'stopped' && snapshot.runtime.state !== 'failed';
  return (
    <>
      {(!running || setup.step !== null) && (
        <Row path={path('quick-setup')} title="Set up a local model" description="Mobius installs the engine if needed, picks a model that runs well on your graphics card, downloads it and starts it for the agent. Nothing you type leaves this computer once it runs." highlight={highlight === 'quick-setup'}>
          <div className="quick-setup">
            {setup.step === null ? (
              <button type="button" className="btn primary" disabled={engine.status === null || models.download?.running === true} onClick={() => void setup.run()}>Set it up for me</button>
            ) : (
              <p className="srow-text" role="status" aria-label="Setup progress">{SETUP_TEXT[setup.step]}</p>
            )}
            {setup.step === 'downloading' && models.download?.running && (
              <button type="button" className="btn" onClick={models.cancel}>Cancel</button>
            )}
            {setup.problem && <p className="field-error" role="alert">{setup.problem}</p>}
          </div>
        </Row>
      )}

      <Row path={path('hardware')} title="Your computer" description="The graphics card and memory models have to fit in." highlight={highlight === 'hardware'}>
        <p className="srow-text">{models.hardware ? hardwareSummary(models.hardware) : 'Looking…'}</p>
      </Row>

      <Row path={path('engine')} title="Engine" description="The program that runs models: llama.cpp, from its official releases, in the build for your graphics card. Mobius checks every file before using it." highlight={highlight === 'engine'}>
        <EngineRow engine={engine} />
      </Row>

      <Row path={path('running')} title="Running now" description="The model Mobius is running for the agent." highlight={highlight === 'running'}>
        {snapshot.binary === null && runtime === null ? (
          <Empty>No engine yet, so models cannot be run here. Install llama.cpp under Engine above.</Empty>
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
            <label className="switch-line">
              <input type="checkbox" role="switch" aria-label="Start it when Mobius opens" checked={autostart} onChange={(event) => void changeAutostart(event.target.checked)} />
              <span>Start it when Mobius opens</span>
            </label>
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
