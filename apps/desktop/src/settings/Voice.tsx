import { useCallback, useEffect, useState } from 'react';
import { KOKORO_VOICES, isVoiceUrl, type DeviceModel, type DeviceVoiceStatus, type ListenModel, type ListenWith, type PreferencesSettings, type SpeakWith } from '@mobius/shared';
import { deviceText, localStatusText, megabytes } from './voice-status';
import { settingPath } from './manifest';
import { Row } from './primitives';
import { Select } from '../ui';
import { AdvancedSection, AppearanceSection, RemoveDataRow, SafetySection, Toggle, type SectionProps } from './sections';

const LISTEN: ReadonlyArray<{ id: ListenWith; label: string }> = [
  { id: 'device', label: 'This computer (free)' },
  { id: 'chat', label: 'Chat server' },
  { id: 'local', label: 'Speech server on this computer' },
  { id: 'elevenlabs', label: 'ElevenLabs' },
  { id: 'off', label: 'Off' },
];
const SPEAK: ReadonlyArray<{ id: SpeakWith; label: string }> = [
  { id: 'device', label: 'This computer (free)' },
  { id: 'local', label: 'Speech server on this computer' },
  { id: 'elevenlabs', label: 'ElevenLabs' },
  { id: 'off', label: 'Off' },
];

/** Servers the chat model can run on that do not turn speech into text, so dictation through them cannot work. */
export function chatCannotListen(baseUrl: string): string | null {
  const url = baseUrl.trim().toLowerCase();
  if (!url) return 'No chat model is set up yet.';
  if (url.includes('anthropic.com')) return 'Anthropic does not turn speech into text.';
  if (url.startsWith('claude-code://') || url.startsWith('chatgpt://')) return 'A plan you sign in to does not turn speech into text here.';
  if (/^https?:\/\/(127\.0\.0\.1|localhost):8080\b/.test(url)) return 'A llama.cpp server does not turn speech into text.';
  return null;
}

const MODELS: ReadonlyArray<{ id: ListenModel; label: string }> = [
  { id: 'base.en', label: 'Quick' },
  { id: 'small.en', label: 'More accurate' },
  { id: 'parakeet-v3', label: 'Most accurate (Parakeet)' },
];

/** The listener's own name, as Settings shows it. */
export const listenerName = (model: ListenModel): string => (model === 'parakeet-v3' ? 'Parakeet' : 'Whisper');

/** Kokoro's voice for a saved name: the name itself when it is one of Kokoro's, otherwise Heart, the default. */
export const kokoroVoice = (saved: string): string => (KOKORO_VOICES.some((v) => v.id === saved) ? saved : 'af_heart');

/** A model on this computer (Whisper to listen, Kokoro to speak): set up (a one-time download), its progress, and Remove. */
function DeviceModelSetup({ model, name }: { model: DeviceModel; name: string }) {
  const [status, setStatus] = useState<DeviceVoiceStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const fetch = () => void window.mobius.voice?.deviceStatus?.(model).then((r) => { if (live && r && 'state' in r) setStatus(r); }).catch(() => undefined);
    fetch();
    // Another model set up or removed can bring or take the program, which changes what this one would download.
    const stop = window.mobius.voice?.onDevice?.((next) => { if (next.model === model) setStatus(next); else if (next.state === 'ready' || next.state === 'absent') fetch(); });
    return () => { live = false; stop?.(); };
  }, [model]);
  if (!status) return null;
  const answer = (r: { ok: false; error: string } | DeviceVoiceStatus | { ok: true } | undefined | null) => {
    if (r && 'state' in r) setStatus(r);
    else if (r && 'error' in r) setProblem(r.error);
  };
  const setUp = async () => { setProblem(null); answer(await window.mobius.voice?.deviceSetup?.(model).catch(() => null)); };
  const remove = async () => {
    setProblem(null);
    const r = await window.mobius.voice?.deviceRemove?.(model).catch(() => null);
    if (r?.ok) setStatus({ ...status, state: 'absent' });
    else answer(r);
  };
  const failed = status.state === 'failed';
  return (
    <div className="inline-form device-voice">
      {status.state === 'downloading' && <progress max={status.total || 1} value={status.done ?? 0} aria-label={`Downloading ${name}`} />}
      <p className={failed ? 'field-error' : 'srow-text'} role={failed ? 'alert' : 'status'} data-testid={model === 'kokoro' ? 'voice-device-speak' : model === 'speakers' ? 'voice-device-speakers' : 'voice-device'}>{deviceText(status)}</p>
      {problem && <p className="field-error" role="alert">{problem}</p>}
      {status.available && (status.state === 'absent' || failed) && (
        <button type="button" className="btn" onClick={() => void setUp()}>{failed ? 'Try again' : `Set up (${megabytes(status.bytes)})`}</button>
      )}
      {status.state === 'ready' && <button type="button" className="link-btn" onClick={() => void remove()}>Remove from this computer</button>}
    </div>
  );
}

/** A choice of several, as a pop-up. */
function PopUp<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: ReadonlyArray<{ id: T; label: string }>; onChange: (value: T) => void }) {
  return (
    <Select label={label} hideLabel value={value} onChange={onChange} choices={options.map((o) => ({ value: o.id, label: o.label }))} />
  );
}

/** A text setting that saves itself when you press Return or leave it, once it is valid; it says what is wrong. */
function TextField({ label, value, valid, problem, onSave, placeholder }: { label: string; value: string; valid: (v: string) => boolean; problem: string; onSave: (v: string) => void; placeholder?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const ok = valid(text);
  return (
    <form className="inline-form" onSubmit={(e) => { e.preventDefault(); if (ok && text !== value) onSave(text); }}>
      <input type="text" aria-label={label} value={text} placeholder={placeholder} spellCheck={false} autoComplete="off" onChange={(e) => setText(e.target.value)} onBlur={() => { if (ok && text !== value) onSave(text); }} />
      {!ok && <span className="field-error" role="alert">{problem}</span>}
    </form>
  );
}

function TestButton({ job, label }: { job: 'listen' | 'speak'; label: string }) {
  const [state, setState] = useState<{ ok: boolean; text: string } | 'trying' | null>(null);
  const run = async () => {
    setState('trying');
    const r = await window.mobius.voice?.test(job).catch(() => null);
    setState(!r ? { ok: false, text: 'Voice is not available here.' } : r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
  };
  return (
    <div className="inline-form">
      <button type="button" className="btn" disabled={state === 'trying'} onClick={() => void run()}>{label}</button>
      {state === 'trying' && <span className="srow-text" role="status">Trying…</span>}
      {state && state !== 'trying' && <span className={state.ok ? 'field-ok' : 'field-error'} role={state.ok ? 'status' : 'alert'}>{state.text}</span>}
    </div>
  );
}

/** One line under the address: Ready, or Not running with how to start one. Checked when the address changes, and on asking. */
function LocalStatus({ job, url }: { job: 'listen' | 'speak'; url: string }) {
  const [status, setStatus] = useState<{ ready: boolean; url: string } | 'checking' | null>(null);
  const check = useCallback(async () => {
    setStatus('checking');
    const r = await window.mobius.voice?.local?.(job).catch(() => null);
    setStatus(r && r.ok ? { ready: r.ready, url: r.url } : null);
  }, [job]);
  useEffect(() => { void check(); }, [check, url]);
  if (status === null) return null;
  return (
    <div className="inline-form">
      {status === 'checking'
        ? <span className="srow-text" role="status">Checking…</span>
        : <span className={status.ready ? 'field-ok' : 'field-error'} role="status" data-testid={`voice-local-${job}`}>{localStatusText(job, status.ready, status.url)}</span>}
      {status !== 'checking' && !status.ready && <button type="button" className="link-btn" onClick={() => void check()}>Check again</button>}
    </div>
  );
}

/**
 * Models by task, for voice: who listens and who speaks, beside the chat and quick models. The servers, voices and
 * fallbacks stay in Voice; these are the same choices.
 */
export function VoiceModelRows({ subpage, highlight, settings, preferences, onPreferences }: SectionProps) {
  const path = (row: string) => settingPath('model', subpage, row);
  const cannot = preferences.listenWith === 'chat' ? chatCannotListen(settings?.baseUrl ?? '') : null;
  const listening = preferences.listenWith === 'off' ? null : preferences.listenWith === 'elevenlabs' ? 'ElevenLabs Scribe' : preferences.listenWith === 'device' ? `${listenerName(preferences.listenModel)}${preferences.listenModel === 'parakeet-v3' ? '' : ` ${preferences.listenModel}`}, on this computer` : preferences.dictationModel;
  const kokoro = KOKORO_VOICES.find((v) => v.id === kokoroVoice(preferences.speakVoice))?.label ?? '';
  const speaking = preferences.speakWith === 'off' ? null : preferences.speakWith === 'elevenlabs' ? 'ElevenLabs' : preferences.speakWith === 'device' ? `Kokoro, ${kokoro}, on this computer` : `${preferences.speakModel}${preferences.speakVoice ? `, ${preferences.speakVoice}` : ''}`;
  return (
    <>
      <Row path={path('listen')} title="Listen" description="Turns your speech into text when you dictate and in meetings. Its server, model and fallback are under Listening." highlight={highlight === 'listen'}>
        <PopUp label="Listen runs on" value={preferences.listenWith} options={LISTEN} onChange={(listenWith) => void onPreferences({ listenWith })} />
        {listening && <p className="srow-text">Model: {listening}</p>}
        {cannot && <p className="srow-note" role="note">{cannot} Choose This computer or ElevenLabs.</p>}
      </Row>
      <Row path={path('speak')} title="Speak" description="Reads replies and pages aloud when you press Listen. Its voice and fallback are under Speaking." highlight={highlight === 'speak'}>
        <PopUp label="Speak runs on" value={preferences.speakWith} options={SPEAK} onChange={(speakWith) => void onPreferences({ speakWith })} />
        {speaking && <p className="srow-text">Voice: {speaking}</p>}
      </Row>
    </>
  );
}

/** Who listens when you dictate, and who speaks answers aloud: each with its own service and a fallback. */
export function VoiceSection({ subpage, highlight, settings, preferences, onPreferences }: SectionProps) {
  const path = (row: string) => settingPath('model', subpage, row);
  const set = (change: Partial<PreferencesSettings>) => void onPreferences(change);
  const urlProblem = 'Use an address starting with http:// or https://, with no spaces.';
  if (subpage === 'speaking') {
    const local = preferences.speakWith === 'local' || preferences.speakFallback === 'local';
    const device = preferences.speakWith === 'device' || preferences.speakFallback === 'device';
    const served = [preferences.speakWith, preferences.speakFallback].some((w) => w === 'local' || w === 'elevenlabs');
    return (
      <>
        <Row path={path('speak-with')} title="Speak with" description="Text to speech: Kokoro on this computer for free, a speech server you run, ElevenLabs, or off." highlight={highlight === 'speak-with'}>
          <PopUp label="Speak with" value={preferences.speakWith} options={SPEAK} onChange={(speakWith) => set({ speakWith })} />
          {(preferences.speakWith === 'elevenlabs' || preferences.speakFallback === 'elevenlabs') && <p className="srow-text">ElevenLabs needs its key, added in Gateways.</p>}
        </Row>
        {device && (
          <Row path={path('speak-device')} title="Kokoro on this computer" description="Free and private: a one-time download, then nothing read aloud leaves this computer." highlight={highlight === 'speak-device'}>
            <DeviceModelSetup model="kokoro" name="Kokoro" />
          </Row>
        )}
        {served && (
          <Row path={path('speak-model')} title="Voice model" description="The model asked for when speaking." highlight={highlight === 'speak-model'}>
            <TextField label="Voice model" value={preferences.speakModel} valid={(v) => v.length >= 1 && v.length <= 200 && !/\n/.test(v)} problem="Use a model name of 1 to 200 characters." onSave={(speakModel) => set({ speakModel })} />
          </Row>
        )}
        <Row path={path('speak-voice')} title="Voice" description={preferences.speakWith === 'device' ? "One of Kokoro's voices on this computer." : "The voice to speak with. Empty uses the server's own."} highlight={highlight === 'speak-voice'}>
          {preferences.speakWith === 'device'
            ? <PopUp label="Voice" value={kokoroVoice(preferences.speakVoice)} options={KOKORO_VOICES} onChange={(speakVoice) => set({ speakVoice })} />
            : <TextField label="Voice" value={preferences.speakVoice} valid={(v) => v.length <= 100 && !/\n/.test(v)} problem="Up to 100 characters." placeholder="The server's own" onSave={(speakVoice) => set({ speakVoice })} />}
        </Row>
        {local && (
          <Row path={path('speak-url')} title="Speech server on this computer" description="Its address, in OpenAI's audio format, as Kokoro serves it." highlight={highlight === 'speak-url'}>
            <TextField label="Speaking server address" value={preferences.speakUrl} valid={isVoiceUrl} problem={urlProblem} onSave={(speakUrl) => set({ speakUrl })} />
            <LocalStatus job="speak" url={preferences.speakUrl} />
          </Row>
        )}
        <Row path={path('speak-fallback')} title="If that cannot speak" description="What to try next." highlight={highlight === 'speak-fallback'}>
          <PopUp label="If that cannot speak" value={preferences.speakFallback} options={SPEAK} onChange={(speakFallback) => set({ speakFallback })} />
        </Row>
        <Row path={path('read-aloud')} title="Read replies aloud" description="Each new reply is read as it arrives. Esc, or a new message, stops it. Off, nothing is read until you press Read aloud or Listen." highlight={highlight === 'read-aloud'}>
          <Toggle label="Read replies aloud" checked={preferences.readAloud} onChange={(readAloud) => set({ readAloud })} />
        </Row>
        <Row path={path('speak-test')} title="Try speaking" description="Ask the chosen server whether it answers." highlight={highlight === 'speak-test'}>
          <TestButton job="speak" label="Try speaking" />
        </Row>
      </>
    );
  }
  const cannot = preferences.listenWith === 'chat' ? chatCannotListen(settings?.baseUrl ?? '') : null;
  const local = preferences.listenWith === 'local' || preferences.listenFallback === 'local';
  const device = preferences.listenWith === 'device' || preferences.listenFallback === 'device';
  const served = [preferences.listenWith, preferences.listenFallback].some((w) => w === 'chat' || w === 'local');
  return (
    <>
      <Row path={path('listen-with')} title="Listen with" description="Speech to text: Whisper on this computer for free, the chat model's server, a speech server you run, or ElevenLabs." highlight={highlight === 'listen-with'}>
        <PopUp label="Listen with" value={preferences.listenWith} options={LISTEN} onChange={(listenWith) => set({ listenWith })} />
        {cannot && <p className="srow-note" role="note">{cannot} Dictation will not work this way: choose This computer or ElevenLabs.</p>}
        {(preferences.listenWith === 'elevenlabs' || preferences.listenFallback === 'elevenlabs') && <p className="srow-text">ElevenLabs needs its key, added in Gateways.</p>}
      </Row>
      {device && (
        <Row path={path('listen-device')} title={`${listenerName(preferences.listenModel)} on this computer`} description="Free and private: a one-time download, then nothing you say leaves this computer." highlight={highlight === 'listen-device'}>
          <DeviceModelSetup model={preferences.listenModel} name={listenerName(preferences.listenModel)} />
          {preferences.listenModel === 'parakeet-v3' && <p className="srow-text">Parakeet TDT 0.6B v3 by NVIDIA, under CC-BY-4.0. It hears 25 European languages and finds the language itself.</p>}
        </Row>
      )}
      {device && (
        <Row path={path('listen-accuracy')} title="Accuracy" description="Quick suits dictation. More accurate is slower and a larger download, and suits meetings. Most accurate is Parakeet, about 670 MB." highlight={highlight === 'listen-accuracy'}>
          <PopUp label="Accuracy" value={preferences.listenModel} options={MODELS} onChange={(listenModel) => set({ listenModel })} />
        </Row>
      )}
      {device && (
        <Row path={path('listen-speakers')} title="Who spoke, in meeting notes" description="A meeting's transcript reads in turns, Speaker 1, Speaker 2 and on, the same names all through the meeting. Set up to turn it on; remove to turn it off." highlight={highlight === 'listen-speakers'}>
          <DeviceModelSetup model="speakers" name="Speaker labels" />
        </Row>
      )}
      {served && (
        <Row path={path('listen-model')} title="Speech model" description="The model asked for when you dictate." highlight={highlight === 'listen-model'}>
          <TextField label="Speech model" value={preferences.dictationModel} valid={(v) => v.length >= 1 && v.length <= 200 && !/\n/.test(v)} problem="Use a model name of 1 to 200 characters." onSave={(dictationModel) => set({ dictationModel })} />
        </Row>
      )}
      {local && (
        <Row path={path('listen-url')} title="Speech server on this computer" description="Its address, in OpenAI's audio format, as faster-whisper serves it." highlight={highlight === 'listen-url'}>
          <TextField label="Listening server address" value={preferences.listenUrl} valid={isVoiceUrl} problem={urlProblem} onSave={(listenUrl) => set({ listenUrl })} />
          <LocalStatus job="listen" url={preferences.listenUrl} />
        </Row>
      )}
      <Row path={path('listen-fallback')} title="If that cannot listen" description="What to try next." highlight={highlight === 'listen-fallback'}>
        <PopUp label="If that cannot listen" value={preferences.listenFallback} options={LISTEN} onChange={(listenFallback) => set({ listenFallback })} />
      </Row>
      <Row path={path('listen-test')} title="Try listening" description="Ask the chosen server whether it answers." highlight={highlight === 'listen-test'}>
        <TestButton job="listen" label="Try listening" />
      </Row>
    </>
  );
}

/** General: how Mobius starts, and the computer while it works. */
export function GeneralSection(props: SectionProps) {
  return (
    <>
      <AppearanceSection {...props} subpage="general" />
      <AdvancedSection {...props} subpage="desktop" />
    </>
  );
}

export const MemorySection = (props: SectionProps) => <SafetySection {...props} subpage="memory" />;
export const PrivacySection = (props: SectionProps) => <><SafetySection {...props} subpage="privacy" /><RemoveDataRow subpage="privacy" highlight={props.highlight} /></>;

/** Extensions has an app of its own: Settings opens it rather than repeating its pages. */
export function ExtensionsSettings({ highlight, onOpenApp }: SectionProps) {
  return (
    <Row path={settingPath('extensions', 'open', 'extensions-app')} title="Open Store" description="Add and remove apps, and install, update and turn off skills, connectors and plugins." highlight={highlight === 'extensions-app'}>
      <button type="button" className="btn" disabled={!onOpenApp} onClick={() => onOpenApp?.('skills')}>Open Store</button>
    </Row>
  );
}
