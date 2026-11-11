import { useEffect, useState } from 'react';
import { isVoiceUrl, type ListenWith, type PreferencesSettings, type SpeakWith } from '@mobius/shared';
import { settingPath } from './manifest';
import { Row } from './primitives';
import { AdvancedSection, AppearanceSection, SafetySection, Toggle, type SectionProps } from './sections';

const LISTEN: ReadonlyArray<{ id: ListenWith; label: string }> = [
  { id: 'chat', label: 'Chat server' },
  { id: 'local', label: 'This computer' },
  { id: 'elevenlabs', label: 'ElevenLabs' },
  { id: 'off', label: 'Off' },
];
const SPEAK: ReadonlyArray<{ id: SpeakWith; label: string }> = [
  { id: 'local', label: 'This computer' },
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

/** A choice of several, as a pop-up. */
function PopUp<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: ReadonlyArray<{ id: T; label: string }>; onChange: (value: T) => void }) {
  return (
    <select className="popup" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
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

/** Who listens when you dictate, and who speaks answers aloud: each with its own service and a fallback. */
export function VoiceSection({ subpage, highlight, settings, preferences, onPreferences }: SectionProps) {
  const path = (row: string) => settingPath('voice', subpage, row);
  const set = (change: Partial<PreferencesSettings>) => void onPreferences(change);
  const urlProblem = 'Use an address starting with http:// or https://, with no spaces.';
  if (subpage === 'speaking') {
    const local = preferences.speakWith === 'local' || preferences.speakFallback === 'local';
    return (
      <>
        <Row path={path('speak-with')} title="Speak with" description="Text to speech: a speech server on this computer, ElevenLabs, or off." highlight={highlight === 'speak-with'}>
          <PopUp label="Speak with" value={preferences.speakWith} options={SPEAK} onChange={(speakWith) => set({ speakWith })} />
          {(preferences.speakWith === 'elevenlabs' || preferences.speakFallback === 'elevenlabs') && <p className="srow-text">ElevenLabs needs its key, added in Gateways.</p>}
        </Row>
        <Row path={path('speak-model')} title="Voice model" description="The model asked for when speaking." highlight={highlight === 'speak-model'}>
          <TextField label="Voice model" value={preferences.speakModel} valid={(v) => v.length >= 1 && v.length <= 200 && !/\n/.test(v)} problem="Use a model name of 1 to 200 characters." onSave={(speakModel) => set({ speakModel })} />
        </Row>
        <Row path={path('speak-voice')} title="Voice" description="The voice to speak with. Empty uses the server's own." highlight={highlight === 'speak-voice'}>
          <TextField label="Voice" value={preferences.speakVoice} valid={(v) => v.length <= 100 && !/\n/.test(v)} problem="Up to 100 characters." placeholder="The server's own" onSave={(speakVoice) => set({ speakVoice })} />
        </Row>
        {local && (
          <Row path={path('speak-url')} title="Speech server on this computer" description="Its address, in OpenAI's audio format, as Kokoro serves it." highlight={highlight === 'speak-url'}>
            <TextField label="Speaking server address" value={preferences.speakUrl} valid={isVoiceUrl} problem={urlProblem} onSave={(speakUrl) => set({ speakUrl })} />
          </Row>
        )}
        <Row path={path('speak-fallback')} title="If that cannot speak" description="What to try next." highlight={highlight === 'speak-fallback'}>
          <PopUp label="If that cannot speak" value={preferences.speakFallback} options={SPEAK} onChange={(speakFallback) => set({ speakFallback })} />
        </Row>
        <Row path={path('read-aloud')} title="Read replies aloud" description="Each new reply is read as it arrives. Esc, or a new message, stops it. Every reply also has Speak." highlight={highlight === 'read-aloud'}>
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
  return (
    <>
      <Row path={path('listen-with')} title="Listen with" description="Speech to text: the chat model's server, a speech server on this computer, or ElevenLabs." highlight={highlight === 'listen-with'}>
        <PopUp label="Listen with" value={preferences.listenWith} options={LISTEN} onChange={(listenWith) => set({ listenWith })} />
        {cannot && <p className="srow-note" role="note">{cannot} Dictation will not work this way: choose This computer or ElevenLabs.</p>}
        {(preferences.listenWith === 'elevenlabs' || preferences.listenFallback === 'elevenlabs') && <p className="srow-text">ElevenLabs needs its key, added in Gateways.</p>}
      </Row>
      <Row path={path('listen-model')} title="Speech model" description="The model asked for when you dictate." highlight={highlight === 'listen-model'}>
        <TextField label="Speech model" value={preferences.dictationModel} valid={(v) => v.length >= 1 && v.length <= 200 && !/\n/.test(v)} problem="Use a model name of 1 to 200 characters." onSave={(dictationModel) => set({ dictationModel })} />
      </Row>
      {local && (
        <Row path={path('listen-url')} title="Speech server on this computer" description="Its address, in OpenAI's audio format, as faster-whisper serves it." highlight={highlight === 'listen-url'}>
          <TextField label="Listening server address" value={preferences.listenUrl} valid={isVoiceUrl} problem={urlProblem} onSave={(listenUrl) => set({ listenUrl })} />
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
export const PrivacySection = (props: SectionProps) => <SafetySection {...props} subpage="privacy" />;

/** Extensions has an app of its own: Settings opens it rather than repeating its pages. */
export function ExtensionsSettings({ highlight, onOpenApp }: SectionProps) {
  return (
    <Row path={settingPath('extensions', 'open', 'extensions-app')} title="Open Extensions" description="Install, update and turn off skills, connectors and plugins." highlight={highlight === 'extensions-app'}>
      <button type="button" className="btn" disabled={!onOpenApp} onClick={() => onOpenApp?.('skills')}>Open Extensions</button>
    </Row>
  );
}
