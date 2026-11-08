import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MobiusMark } from '../MobiusMark';
import {
  type SavedServer,
  CHAT_TEXT_RANGE,
  SIDEBAR_WIDTH,
  SIDEBAR_APPS,
  type SidebarApp,
  DEFAULT_KEYBINDINGS,
  SHORTCUT_ACTIONS,
  isModelName,
  SHORTCUT_INFO,
  ZOOM_RANGE,
  comboOfPress,
  comboProblem,
  conflictFor,
  describeCombo,
  formatCombo,
  type AboutInfo,
  type ActivityEntry,
  type AgentConfigureRequest,
  type AgentGrant,
  type AgentResult,
  type AgentSettings,
  type AppearanceSettings,
  type BookmarkEntry,
  type ApprovalModeChoice,
  type ChatFont,
  type ConversationInfo,
  type EffortChoice,
  type Density,
  type CoreStatus,
  type HistoryView,
  type KeyBindings,
  type PreferencesSettings,
  type ShareStatus,
  type ShortcutAction,
  type SidebarMode,
  type TextDirection,
  type ThemeChoice,
  type ToolSteps,
  type AccessLevel,
  type AppAccess,
} from '@mobius/shared';
import { APP_ICONS } from '../Rail';
import { appName } from '../apps';
import { relativeTime } from '../relative-time';
import { describeActivity } from './activity';
import { privacyReport, whereItRuns } from './privacy';
import { ProfilesPane } from './Profiles';
import { LocalModelsSection } from './LocalModels';
import { SettingsForm } from './ModelForm';
import { Empty, Row } from './primitives';
import { settingPath, type SectionId } from './manifest';

export interface SectionProps {
  subpage: string;
  highlight: string | null;
  settings: AgentSettings | null;
  onSaveSettings: (request: AgentConfigureRequest) => Promise<AgentResult>;
  appearance: AppearanceSettings;
  preferences: PreferencesSettings;
  onPreferences: (change: Partial<PreferencesSettings>) => Promise<void>;
  onAppearance: (change: Partial<AppearanceSettings>) => Promise<void>;
  conversations: ConversationInfo[];
  activeConversation: string;
  onOpenConversation: (id: string) => void;
  onDeleteConversation: (id: string) => Promise<string | null>;
  onRefreshConversations: () => Promise<void>;
  coreStatus: CoreStatus;
}

const rowPath = (section: SectionId, subpage: string, row: string) => settingPath(section, subpage, row);

function useLoaded<T>(load: () => Promise<T>, empty: T): { value: T; reload: () => Promise<void>; loaded: boolean } {
  const [value, setValue] = useState<T>(empty);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    setValue(await load());
    setLoaded(true);
  }, [load]);
  useEffect(() => {
    let live = true;
    void load().then((next) => {
      if (live) {
        setValue(next);
        setLoaded(true);
      }
    });
    return () => {
      live = false;
    };
  }, [load]);
  return { value, reload, loaded };
}

// ---- Appearance ----------------------------------------------------------------------------------------------

const THEMES: Array<{ id: ThemeChoice; label: string }> = [{ id: 'system', label: 'System' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }];

function Slider({ label, value, range, step, onCommit, format }: { label: string; value: number; range: { min: number; max: number }; step: number; onCommit: (value: number) => void; format: (value: number) => string }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  // What has been chosen but not yet sent, so closing the page right after a change does not lose it.
  const pending = useRef<{ local: number; value: number; commit: (value: number) => void }>({ local, value, commit: onCommit });
  pending.current = { local, value, commit: onCommit };
  useEffect(() => () => {
    const { local: chosen, value: saved, commit } = pending.current;
    if (chosen !== saved) commit(chosen);
  }, []);
  // Dragging should feel immediate, but each step does not need to reach the main process.
  useEffect(() => {
    if (local === value) return;
    const timer = setTimeout(() => onCommit(local), 150);
    return () => clearTimeout(timer);
  }, [local, value, onCommit]);
  return (
    <div className="slider">
      <input type="range" aria-label={label} min={range.min} max={range.max} step={step} value={local} onChange={(event) => setLocal(Number(event.target.value))} />
      <output>{format(local)}</output>
      <button type="button" className="btn" disabled={local === 1} onClick={() => setLocal(1)}>Reset</button>
    </div>
  );
}

function Choice<T extends string>({ label, name, value, options, onChange }: { label: string; name: string; value: T; options: ReadonlyArray<{ id: T; label: string }>; onChange: (value: T) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label key={option.id} className="segment" data-checked={value === option.id}>
          <input type="radio" name={name} value={option.id} checked={value === option.id} onChange={() => onChange(option.id)} />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="switch-line">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{checked ? 'On' : 'Off'}</span>
    </label>
  );
}

const FONTS: Array<{ id: ChatFont; label: string }> = [{ id: 'system', label: 'System' }, { id: 'serif', label: 'Serif' }, { id: 'mono', label: 'Monospace' }];
const DIRECTIONS: Array<{ id: TextDirection; label: string }> = [{ id: 'auto', label: 'Automatic' }, { id: 'ltr', label: 'Left to right' }, { id: 'rtl', label: 'Right to left' }];
const DENSITIES: Array<{ id: Density; label: string }> = [{ id: 'comfortable', label: 'Comfortable' }, { id: 'compact', label: 'Compact' }];
const APPROVAL_MODES: Array<{ id: ApprovalModeChoice; label: string }> = [{ id: 'manual', label: 'Manual' }, { id: 'smart', label: 'Smart' }, { id: 'off', label: 'Off' }];
const APPROVAL_HELP: Record<ApprovalModeChoice, string> = {
  manual: 'The first use is asked about and you can choose to always allow it. Running commands, deleting files, reading secrets and clicking or typing on a web page are asked about every time.',
  smart: 'Your model reviews each question first. It approves only what is clearly safe, for that one time. If it thinks something is dangerous you are asked and can allow it once; if it is unsure, or cannot answer, you are asked as usual. What the reviewer sees is the tool and its arguments.',
  off: 'The agent acts without asking, including running commands and deleting files. Sites and actions you have blocked stay blocked.',
};
const SIDEBAR_MODES: Array<{ id: SidebarMode; label: string }> = [{ id: 'attached', label: 'Attached' }, { id: 'floating', label: 'Floating' }];
const EFFORT_OPTIONS: Array<{ id: EffortChoice; label: string }> = [{ id: '', label: 'Default' }, { id: 'none', label: 'Off' }, { id: 'low', label: 'Low' }, { id: 'medium', label: 'Medium' }, { id: 'high', label: 'High' }];
const TOOL_STEPS: Array<{ id: ToolSteps; label: string }> = [{ id: 'show', label: 'Show all' }, { id: 'hide-finished', label: 'Hide finished' }];

export function AppearanceSection({ subpage, highlight, appearance, onAppearance }: SectionProps) {
  const path = (row: string) => rowPath('appearance', subpage, row);
  const percent = (v: number) => `${Math.round(v * 100)}%`;
  const set = (change: Partial<AppearanceSettings>) => void onAppearance(change);
  if (subpage === 'general') {
    return (
      <Row path={path('resume-last')} title="Reopen the last conversation" description="When Mobius starts, open the conversation you were in instead of a blank one." highlight={highlight === 'resume-last'}>
        <Toggle label="Reopen the last conversation" checked={appearance.resumeLast} onChange={(resumeLast) => set({ resumeLast })} />
      </Row>
    );
  }
  if (subpage === 'typography') {
    return (
      <>
        <Row path={path('ui-zoom')} title="Interface zoom" description="Make everything in the window larger or smaller." highlight={highlight === 'ui-zoom'}>
          <Slider label="Interface zoom" value={appearance.zoom} range={ZOOM_RANGE} step={0.05} format={percent} onCommit={(zoom) => set({ zoom })} />
        </Row>
        <Row path={path('chat-text')} title="Conversation text size" description="The size of text in the agent panel." highlight={highlight === 'chat-text'}>
          <Slider label="Conversation text size" value={appearance.chatTextScale} range={CHAT_TEXT_RANGE} step={0.05} format={percent} onCommit={(chatTextScale) => set({ chatTextScale })} />
        </Row>
        <Row path={path('chat-font')} title="Conversation font" description="The typeface used for messages." highlight={highlight === 'chat-font'}>
          <Choice label="Conversation font" name="chat-font" value={appearance.chatFont} options={FONTS} onChange={(chatFont) => set({ chatFont })} />
        </Row>
      </>
    );
  }
  if (subpage === 'layout') {
    return (
      <>
        <Row path={path('sidebar-apps')} title="Apps in the sidebar" description="Choose which apps the sidebar lists, and their order. The others stay in All apps." highlight={highlight === 'sidebar-apps'}>
          <SidebarAppsEditor value={appearance.sidebarApps} onChange={(sidebarApps) => set({ sidebarApps })} />
        </Row>
        <Row path={path('sidebar-at-start')} title="Show the tab list at start" description="Whether the browser's list of tabs is open when Mobius starts." highlight={highlight === 'sidebar-at-start'}>
          <Toggle label="Show the tab list at start" checked={appearance.sidebarAtStart} onChange={(sidebarAtStart) => set({ sidebarAtStart })} />
        </Row>
        <Row path={path('left-sidebar')} title="Tab and conversation list" description="Attached keeps it beside the page. Floating shows it over the page when you move to the edge, and hides it again." highlight={highlight === 'left-sidebar'}>
          <Choice label="Tab and conversation list" name="left-sidebar" value={appearance.leftSidebar} options={SIDEBAR_MODES} onChange={(leftSidebar) => set({ leftSidebar })} />
        </Row>
        <Row path={path('right-sidebar')} title="Agent panel" description="Attached keeps it beside the page. Floating shows it over the page when you move to the edge, and hides it again." highlight={highlight === 'right-sidebar'}>
          <Choice label="Agent panel" name="right-sidebar" value={appearance.rightSidebar} options={SIDEBAR_MODES} onChange={(rightSidebar) => set({ rightSidebar })} />
        </Row>
        <Row path={path('sidebar-size')} title="Sidebar sizes" description="Drag the edge of a sidebar to resize it, or focus the edge and use the arrow keys. Double-click puts the usual width back." highlight={highlight === 'sidebar-size'}>
          <p className="srow-text">Now: list {appearance.leftWidth} px, agent panel {appearance.rightWidth} px.</p>
          <button type="button" className="btn" disabled={appearance.leftWidth === SIDEBAR_WIDTH.left.default && appearance.rightWidth === SIDEBAR_WIDTH.right.default} onClick={() => set({ leftWidth: SIDEBAR_WIDTH.left.default, rightWidth: SIDEBAR_WIDTH.right.default })}>Reset sizes</button>
        </Row>
        <Row path={path('density')} title="List density" description="How tightly tabs and conversations are packed." highlight={highlight === 'density'}>
          <Choice label="List density" name="density" value={appearance.density} options={DENSITIES} onChange={(density) => set({ density })} />
        </Row>
      </>
    );
  }
  if (subpage === 'chat-display') {
    return (
      <>
        <Row path={path('text-direction')} title="Text direction" description="Left to right, right to left, or decided by each message." highlight={highlight === 'text-direction'}>
          <Choice label="Text direction" name="text-direction" value={appearance.textDirection} options={DIRECTIONS} onChange={(textDirection) => set({ textDirection })} />
        </Row>
        <Row path={path('tool-steps')} title="Tool steps" description="Keep finished tool steps in the conversation, or show only the ones that need you." highlight={highlight === 'tool-steps'}>
          <Choice label="Tool steps" name="tool-steps" value={appearance.toolSteps} options={TOOL_STEPS} onChange={(toolSteps) => set({ toolSteps })} />
        </Row>
      </>
    );
  }
  return (
    <Row path={path('theme')} title="Theme" description="Follow the system, or always use light or dark." highlight={highlight === 'theme'}>
      <Choice label="Theme" name="theme" value={appearance.theme} options={THEMES} onChange={(theme) => set({ theme })} />
    </Row>
  );
}

// ---- Model ---------------------------------------------------------------------------------------------------

function DictationModelField({ value, onSave }: { value: string; onSave: (value: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const valid = isModelName(text);
  return (
    <form className="inline-form" onSubmit={(event) => { event.preventDefault(); if (valid && text !== value) onSave(text); }}>
      <input type="text" aria-label="Speech model" value={text} spellCheck={false} autoComplete="off" onChange={(event) => setText(event.target.value)} />
      <button type="submit" className="btn" aria-label="Use speech model" disabled={!valid || text === value}>Use</button>
      {!valid && <span className="field-error" role="alert">Use a model name of 1 to 200 characters on one line.</span>}
    </form>
  );
}

export function ModelSection({ subpage, highlight, settings, onSaveSettings, preferences, onPreferences }: SectionProps) {
  if (subpage === 'local') return <LocalModelsSection subpage={subpage} highlight={highlight} />;
  if (!settings) return <Empty>Loading…</Empty>;
  return (
    <>
      <div className="srow" data-setting={rowPath('model', subpage, 'endpoint')}>
        <SettingsForm key={`${settings.baseUrl}|${settings.model}|${settings.system}`} settings={settings} onSave={onSaveSettings} />
      </div>
      {window.mobius.agent.savedServers && (
        <Row path={rowPath('model', subpage, 'saved-servers')} title="Saved servers" description="Keep model servers under a name and switch between them. Saving keeps the address, the model and, in the system's secret store, the key." highlight={highlight === 'saved-servers'}>
          <SavedServers current={`${settings.baseUrl}|${settings.model}`} />
        </Row>
      )}
      <Row path={rowPath('model', subpage, 'dictation-model')} title="Voice dictation" description="The speech model asked for when you dictate a message. It runs on the same server as the chat model." highlight={highlight === 'dictation-model'}>
        <DictationModelField value={preferences.dictationModel} onSave={(dictationModel) => void onPreferences({ dictationModel })} />
        <p className="srow-text">Not every server offers one. If yours does not, dictation says so.</p>
      </Row>
      <Row path={rowPath('model', subpage, 'effort')} title="Effort" description="How hard the model is asked to think. Also in the message box. Only models that can reason use it." highlight={highlight === 'effort'}>
        <Choice label="Effort" name="effort" value={preferences.reasoningEffort} options={EFFORT_OPTIONS} onChange={(reasoningEffort) => void onPreferences({ reasoningEffort })} />
      </Row>
    </>
  );
}

// ---- Safety and Browser --------------------------------------------------------------------------------------

function GrantList({ label, grants, onRemove, empty }: { label: string; grants: AgentGrant[]; onRemove: (id: number) => Promise<void>; empty: string }) {
  if (grants.length === 0) return <Empty>{empty}</Empty>;
  return (
    <ul className="slist" aria-label={label}>
      {grants.map((grant) => {
        const what = `${grant.capability}${grant.resource ? ` on ${grant.resource}` : ''}`;
        return (
          <li key={grant.id} className="slist-item">
            <div className="slist-main">
              <span className="mono">{grant.capability}</span>
              {grant.resource && <span className="slist-sub">{grant.resource}</span>}
            </div>
            <span className="badge" data-effect={grant.effect}>{grant.effect === 'allow' ? 'Always allowed' : 'Always blocked'}{grant.duration === 'session' ? ' this session' : ''}</span>
            <button type="button" className="btn" aria-label={`Remove ${what}`} onClick={() => void onRemove(grant.id)}>Remove</button>
          </li>
        );
      })}
    </ul>
  );
}

function useGrants() {
  const load = useCallback(() => window.mobius.agent.grants(), []);
  const { value, reload, loaded } = useLoaded<AgentGrant[]>(load, []);
  const remove = useCallback(async (id: number) => {
    await window.mobius.agent.revokeGrant(id);
    await reload();
  }, [reload]);
  return { grants: value, remove, loaded };
}

function ActivityList() {
  const load = useCallback(() => window.mobius.agent.activity(100), []);
  const { value, reload, loaded } = useLoaded<ActivityEntry[]>(load, []);
  if (loaded && value.length === 0) return <Empty>Nothing has happened yet.</Empty>;
  return (
    <>
      <div className="srow-tools"><button type="button" className="btn" onClick={() => void reload()}>Refresh</button></div>
      <ul className="slist" aria-label="Activity log">
        {value.map((entry) => {
          const line = describeActivity(entry);
          return (
            <li key={entry.seq} className="slist-item" data-tone={line.tone}>
              <div className="slist-main">
                <span>{line.text}</span>
                {line.who && <span className="slist-sub">{line.who}</span>}
              </div>
              <time className="slist-time" dateTime={new Date(entry.tsMs).toISOString()} title={new Date(entry.tsMs).toLocaleString()}>{relativeTime(entry.tsMs, Date.now())}</time>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Settings › Safety › Privacy: the last seven days, read from the activity log. Nothing here leaves this computer. */
function PrivacyReport({ baseUrl }: { baseUrl: string }) {
  const load = useCallback(() => window.mobius.agent.activity(200), []);
  const { value, loaded } = useLoaded<ActivityEntry[]>(load, []);
  const rows = privacyReport(value, Date.now() - 7 * 24 * 60 * 60 * 1000);
  const times = (n: number) => (n === 0 ? '—' : n === 1 ? 'once' : `${n} times`);
  return (
    <>
      <p className="srow-text">Requests are answered by: <strong>{whereItRuns(baseUrl)}</strong>.</p>
      {loaded && rows.length === 0 ? (
        <p className="srow-text">Mobius has not read or changed anything in the last seven days.</p>
      ) : (
        <table className="stable privacy-table" aria-label="Privacy report">
          <thead><tr><th scope="col">App</th><th scope="col">Read</th><th scope="col">Changed</th><th scope="col">Blocked</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.area}><th scope="row">{r.area}</th><td>{times(r.read)}</td><td>{times(r.changed)}</td><td>{times(r.blocked)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="srow-text">From the activity log on this computer. Change what Mobius may do in each app under Approvals.</p>
    </>
  );
}

const ACCESS_OPTIONS: ReadonlyArray<{ id: AccessLevel; label: string }> = [
  { id: 'off', label: 'Off' },
  { id: 'ask', label: 'Ask first' },
  { id: 'read', label: 'Read' },
  { id: 'act', label: 'Act' },
];
const ACCESS_APPS: ReadonlyArray<{ id: keyof AppAccess; label: string; help: Record<AccessLevel, string> }> = [
  { id: 'browser', label: 'Browser', help: { off: 'Mobius cannot see your tabs, read pages, search the web or open new ones.', ask: 'Mobius asks before it reads a page, searches the web or opens a page.', read: 'Mobius reads your tabs and pages and searches the web without asking, and asks before opening one.', act: 'Mobius reads pages, searches the web and opens new ones without asking. Clicking and typing still ask.' } },
  { id: 'notes', label: 'Notes', help: { off: 'Mobius cannot open or change your notes.', ask: 'Mobius asks before it opens or changes a note.', read: 'Mobius opens your notes without asking, and asks before changing one.', act: 'Mobius opens and changes your notes without asking. You can still review and undo each change.' } },
  { id: 'docs', label: 'Docs', help: { off: 'Mobius cannot open or change your documents.', ask: 'Mobius asks before it opens or changes a document.', read: 'Mobius opens your documents without asking, and asks before changing one.', act: 'Mobius opens and changes your documents without asking. You can still keep or discard each change.' } },
  { id: 'sheets', label: 'Sheets', help: { off: 'Mobius cannot open or change your workbooks.', ask: 'Mobius asks before it reads a workbook or changes one.', read: 'Mobius reads your workbooks without asking, and asks before changing a cell.', act: 'Mobius reads and changes your workbooks without asking. You can still keep or discard each change.' } },
  { id: 'mail', label: 'Mail', help: { off: 'Mobius cannot read your mail or draft replies.', ask: 'Mobius asks before it reads your mail. It may suggest drafts; only you send.', read: 'Mobius reads your mail without asking. It may suggest drafts; only you send.', act: 'Mobius reads your mail without asking. It may suggest drafts; only you send.' } },
  { id: 'slides', label: 'Slides', help: { off: 'Mobius cannot open or change your decks.', ask: 'Mobius asks before it opens or changes a deck.', read: 'Mobius opens your decks without asking, and asks before changing one.', act: 'Mobius opens and changes your decks without asking. You can still keep or discard what it changed.' } },
  { id: 'tasks', label: 'Tasks', help: { off: 'Mobius cannot see or change your task lists.', ask: 'Mobius asks before it reads or changes your tasks.', read: 'Mobius reads your task lists without asking, and asks before changing them.', act: 'Mobius reads and changes your task lists without asking.' } },
  { id: 'calendar', label: 'Calendar', help: { off: 'Mobius cannot see or change your calendars.', ask: 'Mobius asks before it reads your calendar or adds to it.', read: 'Mobius reads your calendars without asking, and asks before adding or changing an event.', act: 'Mobius reads your calendars and adds or changes events without asking. It never invites anyone.' } },
  { id: 'design', label: 'Design', help: { off: 'Mobius cannot open or change your designs.', ask: 'Mobius asks before it opens or changes a design.', read: 'Mobius opens your designs without asking, and asks before changing one.', act: 'Mobius opens and changes your designs without asking. You can still keep or discard what it changed.' } },
  { id: 'canvas', label: 'Canvas', help: { off: 'Mobius cannot open or change your boards.', ask: 'Mobius asks before it opens or changes a board.', read: 'Mobius opens your boards without asking, and asks before changing one.', act: 'Mobius opens and changes your boards without asking. You can still keep or discard what it changed.' } },
  { id: 'skills', label: 'Skills', help: { off: 'Mobius cannot read or change your skills.', ask: 'Mobius asks before it reads or changes a skill.', read: 'Mobius reads your skills without asking, and asks before changing one.', act: 'Mobius reads and improves your skills without asking. Every version is kept, and you can keep or discard each change.' } },
  { id: 'video', label: 'Video', help: { off: 'Mobius cannot see or change your cuts.', ask: 'Mobius asks before it reads or changes a cut.', read: 'Mobius reads your cuts without asking, and asks before changing one.', act: 'Mobius changes your cuts without asking. Clips are never changed, and you can keep or discard each change.' } },
  { id: 'studio', label: 'Studio', help: { off: 'Mobius cannot open or change your songs.', ask: 'Mobius asks before it opens or changes a song.', read: 'Mobius opens your songs without asking, and asks before changing one.', act: 'Mobius changes your songs without asking. It writes notes, never audio, and you can keep or discard each change.' } },
  { id: 'photo', label: 'Photo', help: { off: 'Mobius cannot see or change your photos’ edits.', ask: 'Mobius asks before it reads or changes a photo’s edits.', read: 'Mobius reads your photos’ edits without asking, and asks before changing them.', act: 'Mobius changes your photos’ edits without asking. The pictures themselves are never changed.' } },
  { id: 'code', label: 'Code', help: { off: 'Mobius cannot open, change or test your projects.', ask: 'Mobius asks before it opens or changes a file. It may run the test command you chose.', read: 'Mobius opens your project files without asking, and asks before changing one. It may run the test command you chose.', act: 'Mobius opens and changes your project files without asking. You can still keep or discard each change.' } },
];

/** What Mobius remembers, each with Forget. Read again whenever it changes, by the agent or here. */
function MemoryList() {
  const [items, setItems] = useState<string[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void window.mobius.memory?.list().then((list) => live && setItems(list)).catch(() => live && setItems([]));
    load();
    const off = window.mobius.memory?.onChange(load);
    return () => { live = false; off?.(); };
  }, []);
  if (!window.mobius.memory) return <p className="srow-text">Memory is not available here.</p>;
  if (items === null) return null;
  return (
    <>
      {items.length === 0 ? (
        <p className="srow-text">Nothing yet. When Mobius learns something worth keeping, such as a preference you mention, it asks to remember it.</p>
      ) : (
        <ul className="memory-list" aria-label="What Mobius remembers">
          {items.map((text) => (
            <li key={text} className="memory-item">
              <span className="memory-text">{text}</span>
              <button type="button" className="btn" aria-label={`Forget: ${text}`} onClick={() => void window.mobius.memory!.forget(text).then((r) => setProblem(r.ok ? null : r.error))}>Forget</button>
            </li>
          ))}
        </ul>
      )}
      {problem && <p className="srow-text" role="alert">{problem}</p>}
      <p className="srow-text">Kept in memory.md in the data folder, as plain text you can edit.</p>
    </>
  );
}

export function SafetySection({ subpage, highlight, settings, preferences, onPreferences }: SectionProps) {
  const { grants, remove } = useGrants();
  const path = (row: string) => rowPath('safety', subpage, row);
  if (subpage === 'memory') {
    return (
      <Row path={path('remembered')} title="What Mobius remembers" description="Short facts Mobius keeps between conversations. It asks before remembering unless you chose otherwise. Forget any of them here." highlight={highlight === 'remembered'}>
        <MemoryList />
      </Row>
    );
  }
  if (subpage === 'activity') {
    return (
      <Row path={path('activity-log')} title="Activity log" description="A record of what was asked, allowed and run. It never contains what was typed or read." highlight={highlight === 'activity-log'}>
        <ActivityList />
      </Row>
    );
  }
  if (subpage === 'privacy') {
    const storage = settings?.hasKey ? (settings.keyStorage === 'keychain' ? 'Your API key is stored encrypted by your system.' : 'Your API key is kept only until you quit Mobius.') : 'No API key is saved.';
    return (
      <>
        <Row path={path('privacy-report')} title="Privacy report" description="What Mobius read and changed in the last seven days, by app, and where your requests are answered." highlight={highlight === 'privacy-report'}>
          <PrivacyReport baseUrl={settings?.baseUrl ?? ''} />
        </Row>
        <Row path={path('key-storage')} title="Key storage" description="Whether your API key is stored encrypted by the system or only kept until you quit." highlight={highlight === 'key-storage'}>
          <p className="srow-text">{storage}</p>
        </Row>
        <Row path={path('web-content')} title="Web content" description="Text from web pages is treated as untrusted and never as instructions." highlight={highlight === 'web-content'}>
          <p className="srow-text">When the agent reads a page, the text is marked as untrusted. Nothing in a page can change what is allowed: every action still asks you first, unless you chose to always allow it.</p>
        </Row>
      </>
    );
  }
  return (
    <>
      <Row path={path('approval-mode')} title="Approval mode" description="Manual asks before the agent acts. Smart lets a reviewer model approve the clearly safe ones. Off lets it act without asking." highlight={highlight === 'approval-mode'}>
        <Choice label="Approval mode" name="approval-mode" value={preferences.approvalMode} options={APPROVAL_MODES} onChange={(approvalMode) => void onPreferences({ approvalMode })} />
        <p className="srow-text" data-testid="approval-mode-help">{APPROVAL_HELP[preferences.approvalMode]}</p>
      </Row>
      <Row path={path('app-access')} title="What Mobius may do in each app" description="For the browser, notes and tasks: off, ask first, read without asking, or act without asking. Risky actions still ask." highlight={highlight === 'app-access'}>
        <div className="access-grid">
          {ACCESS_APPS.map((app) => (
            <div key={app.id} className="access-row">
              <span className="access-app">{app.label}</span>
              <Choice label={`${app.label}: what Mobius may do`} name={`access-${app.id}`} value={preferences.appAccess[app.id] ?? 'ask'} options={ACCESS_OPTIONS}
                onChange={(level) => void onPreferences({ appAccess: { ...preferences.appAccess, [app.id]: level } })} />
              <p className="srow-text access-help">{app.help[preferences.appAccess[app.id] ?? 'ask']}</p>
            </div>
          ))}
        </div>
        <p className="srow-text">Clicking or typing on a web page, deleting, running commands and reading secrets always ask, whatever you choose here. Off also holds when approvals are off.</p>
      </Row>
      <Row path={path('always-allowed')} title="Always allowed" description="Actions you chose to always allow. Remove one to be asked again." highlight={highlight === 'always-allowed'}>
        <GrantList label="Always allowed" grants={grants} onRemove={remove} empty="Nothing is always allowed. You are asked the first time." />
      </Row>
      <Row path={path('each-time')} title="Asked every time" description="Some actions can only ever be allowed one use at a time." highlight={highlight === 'each-time'}>
        <p className="srow-text">Running commands, deleting files, reading secrets and clicking or typing on a web page always ask, and cannot be set to always allow.</p>
      </Row>
    </>
  );
}

function BookmarkSettings({ highlight }: { highlight: string | null }) {
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<BookmarkEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () => void window.mobius.bookmarks.get(query).then((next) => {
      if (live) {
        setEntries(next);
        setLoaded(true);
      }
    });
    load();
    const off = window.mobius.bookmarks.onChanged(load);
    return () => {
      live = false;
      off();
    };
  }, [query]);
  return (
    <Row path={rowPath('browser', 'bookmarks', 'saved-pages')} title="Bookmarks" description="Pages you saved with the star next to the address." highlight={highlight === 'saved-pages'}>
      <div className="slist-tools">
        <input type="search" className="input" aria-label="Search bookmarks" placeholder="Search bookmarks" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      {loaded && entries.length === 0 ? <Empty>{query ? 'Nothing matches.' : 'No bookmarks yet. Use the star next to the address.'}</Empty> : (
        <ul className="slist" aria-label="Bookmarks">
          {entries.map((entry) => (
            <li key={entry.url} className="slist-item">
              <div className="slist-main">
                <span>{entry.title}</span>
                <span className="slist-sub">{entry.url}</span>
              </div>
              <button type="button" className="btn" aria-label={`Remove bookmark ${entry.title}`} onClick={() => window.mobius.bookmarks.remove(entry.url)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </Row>
  );
}

function HistorySettings({ highlight }: { highlight: string | null }) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<HistoryView>({ enabled: true, entries: [] });
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () => void window.mobius.history.get(query).then((next) => {
      if (live) {
        setView(next);
        setLoaded(true);
      }
    });
    load();
    const off = window.mobius.history.onChanged(load);
    return () => {
      live = false;
      off();
    };
  }, [query]);
  return (
    <>
      <Row path={rowPath('browser', 'history', 'keep-history')} title="Keep browsing history" description="Remember the pages you visit, on this computer only. Turning this off keeps what is already there." highlight={highlight === 'keep-history'}>
        <label className="switch-line">
          <input type="checkbox" role="switch" checked={view.enabled} onChange={(event) => { setView((v) => ({ ...v, enabled: event.target.checked })); window.mobius.history.setEnabled(event.target.checked); }} />
          <span>{view.enabled ? 'On' : 'Off'}</span>
        </label>
      </Row>
      <Row path={rowPath('browser', 'history', 'history-list')} title="Pages you visited" description="Newest first." highlight={highlight === 'history-list'}>
        <div className="slist-tools">
          <input type="search" className="input" aria-label="Search history" placeholder="Search history" value={query} onChange={(event) => setQuery(event.target.value)} />
          {confirming ? (
            <>
              <button type="button" className="btn danger" onClick={() => { window.mobius.history.clear(); setConfirming(false); }}>Confirm clear</button>
              <button type="button" className="btn" onClick={() => setConfirming(false)}>Cancel</button>
            </>
          ) : (
            <button type="button" className="btn" disabled={view.entries.length === 0} onClick={() => setConfirming(true)}>Clear all</button>
          )}
        </div>
        {loaded && view.entries.length === 0 ? <Empty>{query ? 'Nothing matches.' : 'No pages yet.'}</Empty> : (
          <ul className="slist" aria-label="Pages you visited">
            {view.entries.map((entry) => (
              <li key={entry.url} className="slist-item">
                <div className="slist-main">
                  <span>{entry.title}</span>
                  <span className="slist-sub">{entry.url} · {relativeTime(entry.visited, Date.now())}</span>
                </div>
                <button type="button" className="btn" aria-label={`Remove ${entry.title} from history`} onClick={() => window.mobius.history.remove(entry.url)}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </Row>
    </>
  );
}

export function BrowserSection({ subpage, highlight, preferences, onPreferences }: SectionProps) {
  const { grants, remove } = useGrants();
  if (subpage === 'network') {
    return (
      <Row path={rowPath('browser', 'network', 'private-addresses')} title="Local addresses" description="Let the agent use addresses on this computer or your local network. Off by default, so a web page cannot steer it at your router or a local service." highlight={highlight === 'private-addresses'}>
        <Toggle label="Let the agent use local addresses" checked={preferences.agentPrivateUrls} onChange={(agentPrivateUrls) => void onPreferences({ agentPrivateUrls })} />
        <p className="srow-text">This only limits the agent. You can open any address yourself.</p>
      </Row>
    );
  }
  if (subpage === 'bookmarks') return <BookmarkSettings highlight={highlight} />;
  if (subpage === 'history') return <HistorySettings highlight={highlight} />;
  return (
    <Row path={rowPath('browser', subpage, 'allowed-sites')} title="Allowed sites" description="Sites the agent may open without asking. Remove one to be asked again." highlight={highlight === 'allowed-sites'}>
      <GrantList label="Allowed sites" grants={grants.filter((g) => g.capability === 'browser.navigate')} onRemove={remove} empty="No sites are always allowed. You are asked the first time the agent opens one." />
    </Row>
  );
}

// ---- Conversations -------------------------------------------------------------------------------------------

function ConversationRow({ conversation, active, onOpen, onDelete }: { conversation: ConversationInfo; active: boolean; onOpen: () => void; onDelete: () => Promise<string | null> }) {
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <li className="slist-item">
      <div className="slist-main">
        <span>{conversation.title}{active ? <span className="badge" data-effect="allow">Open</span> : null}</span>
        <span className="slist-sub">{conversation.messages} messages · {relativeTime(conversation.updated_ms, Date.now())}</span>
        {problem && <span className="field-error" role="alert">{problem}</span>}
      </div>
      {confirming ? (
        <>
          <button type="button" className="btn danger" onClick={() => void onDelete().then((error) => { setProblem(error); setConfirming(false); })}>Confirm delete</button>
          <button type="button" className="btn" onClick={() => setConfirming(false)}>Cancel</button>
        </>
      ) : (
        <>
          <button type="button" className="btn" aria-label="Open" onClick={onOpen}>Open</button>
          <button type="button" className="btn" aria-label={`Delete ${conversation.title}`} onClick={() => setConfirming(true)}>Delete</button>
        </>
      )}
    </li>
  );
}

export function SessionsSection({ subpage, highlight, conversations, activeConversation, onOpenConversation, onDeleteConversation, onRefreshConversations }: SectionProps) {
  useEffect(() => void onRefreshConversations(), [onRefreshConversations]);
  const loadAbout = useCallback(() => window.mobius.app.about(), []);
  const about = useLoaded<AboutInfo | null>(loadAbout, null).value;
  return (
    <>
      <Row path={rowPath('sessions', subpage, 'saved-conversations')} title="Saved conversations" description="Open or delete earlier conversations." highlight={highlight === 'saved-conversations'}>
        {conversations.length === 0 ? (
          <Empty>No saved conversations yet.</Empty>
        ) : (
          <ul className="slist" aria-label="Saved conversations">
            {conversations.map((conversation) => (
              <ConversationRow key={conversation.id} conversation={conversation} active={conversation.id === activeConversation} onOpen={() => onOpenConversation(conversation.id)} onDelete={() => onDeleteConversation(conversation.id)} />
            ))}
          </ul>
        )}
      </Row>
      <Row path={rowPath('sessions', subpage, 'data-location')} title="Where they are kept" description="Conversations are stored on this computer." highlight={highlight === 'data-location'}>
        <p className="srow-text mono">{about?.dataFolder ?? '…'}</p>
        <button type="button" className="btn" onClick={() => void window.mobius.app.openDataFolder()}>Open data folder</button>
      </Row>
    </>
  );
}

// ---- Keyboard ------------------------------------------------------------------------------------------------

const FIXED_SHORTCUTS: Array<[string, string]> = [
  ['Enter', 'Send the message'],
  ['Shift+Enter', 'New line in the message'],
  ['Esc', 'Close a menu, the launcher or settings'],
];
const IN_APP: ShortcutAction[] = SHORTCUT_ACTIONS.filter((action) => !SHORTCUT_INFO[action].global);

/** One shortcut: what it does, the keys, and buttons to change, clear or put back the usual keys. */
function ShortcutRow({ action, bindings, onChange, note }: { action: ShortcutAction; bindings: KeyBindings; onChange: (next: KeyBindings) => void; note?: string }) {
  const [capturing, setCapturing] = useState(false);
  const [problem, setProblem] = useState('');
  const binding = bindings[action];
  const label = SHORTCUT_INFO[action].label;

  useEffect(() => {
    if (!capturing) return undefined;
    // Before anything else sees the key, so pressing a shortcut here does not also run it.
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        setCapturing(false);
        setProblem('');
        return;
      }
      const combo = comboOfPress({ code: event.code, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey });
      if (!combo) return; // only a modifier so far
      const reason = comboProblem(combo);
      const text = formatCombo(combo);
      const other = conflictFor(bindings, action, text);
      if (reason) setProblem(reason);
      else if (other) setProblem(`Already used for "${SHORTCUT_INFO[other].label}". Change or clear that one first.`);
      else {
        setProblem('');
        setCapturing(false);
        onChange({ ...bindings, [action]: text });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, bindings, action, onChange]);

  return (
    <tr>
      <td>{label}{note ? <span className="srow-text"> {note}</span> : null}</td>
      <td>
        <kbd data-testid={`keys-${action}`}>{binding === '' ? 'Not set' : describeCombo(binding, window.mobius.platform)}</kbd>
        {problem ? <span role="alert" className="srow-text"> {problem}</span> : null}
      </td>
      <td>
        <button type="button" className="btn" aria-label={`Change ${label}`} onClick={() => { setProblem(''); setCapturing((on) => !on); }}>{capturing ? 'Press the keys… (Esc to cancel)' : 'Change'}</button>{' '}
        {binding !== '' ? <button type="button" className="btn" aria-label={`Clear ${label}`} onClick={() => onChange({ ...bindings, [action]: '' })}>Clear</button> : null}{' '}
        {binding !== DEFAULT_KEYBINDINGS[action] && conflictFor(bindings, action, DEFAULT_KEYBINDINGS[action]) === null ? <button type="button" className="btn" aria-label={`Reset ${label}`} onClick={() => onChange({ ...bindings, [action]: DEFAULT_KEYBINDINGS[action] })}>Reset</button> : null}
      </td>
    </tr>
  );
}

export function KeyboardSection({ subpage, highlight, preferences, onPreferences }: SectionProps) {
  const bindings = preferences.keybindings;
  const change = useCallback((next: KeyBindings) => void onPreferences({ keybindings: next }), [onPreferences]);
  const [working, setWorking] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void window.mobius.window.quickEntryActive().then((active) => live && setWorking(active));
    return () => { live = false; };
    // Asked again whenever the preferences come back, not only when the binding changes: the binding shows at once,
    // before the system has taken the combination, and asking then says it is not working.
  }, [preferences]);
  const path = (row: string) => rowPath('keyboard', subpage, row);
  const changed = SHORTCUT_ACTIONS.some((action) => bindings[action] !== DEFAULT_KEYBINDINGS[action]);
  return (
    <>
      <Row path={path('shortcut-list')} title="Keyboard shortcuts" description="Change the keys for each one. On a Mac, Ctrl means Command." highlight={highlight === 'shortcut-list'}>
        <table className="stable" aria-label="Keyboard shortcuts">
          <tbody>
            {IN_APP.map((action) => <ShortcutRow key={action} action={action} bindings={bindings} onChange={change} />)}
            {FIXED_SHORTCUTS.map(([keys, what]) => (
              <tr key={keys}><td>{what}</td><td><kbd>{keys}</kbd></td><td /></tr>
            ))}
          </tbody>
        </table>
        {changed ? <p><button type="button" className="btn" onClick={() => change(DEFAULT_KEYBINDINGS)}>Reset all shortcuts</button></p> : null}
      </Row>
      <Row path={path('quick-entry')} title="Quick entry from anywhere" description="A shortcut that works even when Mobius is in the background. It brings Mobius up and starts a message. It is off until you choose keys." highlight={highlight === 'quick-entry'}>
        <table className="stable" aria-label="Quick entry">
          <tbody>
            <ShortcutRow action="quickEntry" bindings={bindings} onChange={change} />
          </tbody>
        </table>
        {bindings.quickEntry !== '' && working === false ? <p role="status" className="srow-text" data-testid="quick-entry-taken">Another program is already using these keys, so this one is not working yet. Choose different keys.</p> : null}
        {bindings.quickEntry !== '' && working === true ? <p role="status" className="srow-text" data-testid="quick-entry-working">Working.</p> : null}
      </Row>
    </>
  );
}

// ---- Advanced ------------------------------------------------------------------------------------------------

export function NotificationsSection({ subpage, highlight, preferences, onPreferences }: SectionProps) {
  const path = (row: string) => rowPath('notifications', subpage, row);
  const set = (change: Partial<PreferencesSettings>) => void onPreferences(change);
  if (subpage === 'sounds') {
    return (
      <Row path={path('mute-sounds')} title="Mute notification sounds" description="Notifications arrive without a sound." highlight={highlight === 'mute-sounds'}>
        <Toggle label="Mute notification sounds" checked={preferences.muteSounds} onChange={(muteSounds) => set({ muteSounds })} />
      </Row>
    );
  }
  return (
    <>
      <p className="srow-text">Mobius only tells you when it is in the background. The notice says what kind of thing happened, never what was asked or answered.</p>
      <Row path={path('notify-needs-you')} title="When it needs you" description="Tell me when the agent is waiting for my answer." highlight={highlight === 'notify-needs-you'}>
        <Toggle label="When it needs you" checked={preferences.notifyNeedsYou} onChange={(notifyNeedsYou) => set({ notifyNeedsYou })} />
      </Row>
      <Row path={path('notify-finished')} title="When a request finishes" description="Tell me when the agent has finished or has stopped because of a problem." highlight={highlight === 'notify-finished'}>
        <Toggle label="When a request finishes" checked={preferences.notifyFinished} onChange={(notifyFinished) => set({ notifyFinished })} />
      </Row>
      <Row path={path('notify-downloads')} title="When a download finishes" description="Tell me when a file has finished downloading." highlight={highlight === 'notify-downloads'}>
        <Toggle label="When a download finishes" checked={preferences.notifyDownloads} onChange={(notifyDownloads) => set({ notifyDownloads })} />
      </Row>
    </>
  );
}

/** Settings > Advanced > Other apps: Mobius as an MCP server for other agents. */
function OtherApps({ subpage, highlight }: { subpage: string; highlight: string | null | undefined }) {
  const api = window.mobius.share;
  const [status, setStatus] = useState<ShareStatus | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const reload = useCallback(() => {
    if (!api) return;
    void api.status().then(setStatus);
    void api.token().then(setToken);
  }, [api]);
  useEffect(reload, [reload]);
  if (!api) return <Empty>Only the desktop app can share its tools.</Empty>;
  const change = async (c: { enabled?: boolean; allowChanges?: boolean }) => {
    const r = await api.set(c);
    setProblem(r.ok ? null : r.error);
    reload();
  };
  const copy = async (what: string, text: string) => {
    await navigator.clipboard?.writeText(text);
    setCopied(what);
  };
  const url = status?.url ?? '';
  const claude = token && url ? `claude mcp add --transport http mobius ${url} --header "Authorization: Bearer ${token}"` : '';
  const hermes = token && url ? `mcp_servers:\n  mobius:\n    url: ${url}\n    headers:\n      Authorization: Bearer ${token}` : '';
  return (
    <>
      <Row path={rowPath('advanced', subpage, 'share-mcp')} title="Let other apps use Mobius" description="Agents such as Claude Code or Hermes can read the files in your workspace over MCP, on this computer only. Off until you turn it on." highlight={highlight === 'share-mcp'}>
        <Toggle label="Let other apps use Mobius" checked={status?.enabled ?? false} onChange={(enabled) => void change({ enabled })} />
      </Row>
      <Row path={rowPath('advanced', subpage, 'share-changes')} title="Let them change files" description="Other apps may also create and edit files. Each change is checkpointed, so it can be undone." highlight={highlight === 'share-changes'}>
        <Toggle label="Let them change files" checked={status?.allowChanges ?? false} onChange={(allowChanges) => void change({ allowChanges })} />
      </Row>
      {status?.problem && <p className="field-error" role="alert">{status.problem}</p>}
      {problem && <p className="field-error" role="alert">{problem}</p>}
      {status?.running && token && (
        <section className="share-setup" aria-label="Connect an app">
          <p className="prow-note" role="status">Listening at <code>{url}</code></p>
          <div className="share-snippet">
            <span className="share-label">Claude Code</span>
            <code className="share-code" aria-label="Claude Code command">{claude}</code>
            <button type="button" className="btn" onClick={() => void copy('claude', claude)}>{copied === 'claude' ? 'Copied' : 'Copy'}</button>
          </div>
          <div className="share-snippet">
            <span className="share-label">Hermes (config.yaml)</span>
            <code className="share-code" aria-label="Hermes settings">{hermes}</code>
            <button type="button" className="btn" onClick={() => void copy('hermes', hermes)}>{copied === 'hermes' ? 'Copied' : 'Copy'}</button>
          </div>
          <p className="prow-note">The token works like a password for your files. If it got out, make a new one: apps set up with the old one stop working.</p>
          <button type="button" className="btn" onClick={() => void api.renewToken().then(() => { setCopied(null); reload(); })}>Make a new token</button>
        </section>
      )}
    </>
  );
}

export function AdvancedSection({ subpage, highlight, settings, onSaveSettings, preferences, onPreferences }: SectionProps) {
  const [steps, setSteps] = useState(String(settings?.maxSteps ?? 25));
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setSteps(String(settings?.maxSteps ?? 25)), [settings?.maxSteps]);
  const number = Number(steps);
  const valid = Number.isInteger(number) && number >= 1 && number <= 100;
  const save = async () => {
    if (!settings || !valid) return;
    const result = await onSaveSettings({ baseUrl: settings.baseUrl, model: settings.model, ...(settings.system ? { system: settings.system } : {}), maxSteps: number });
    setStatus(result.ok ? { ok: true, text: 'Saved' } : { ok: false, text: result.error });
  };
  if (subpage === 'other-apps') return <OtherApps subpage={subpage} highlight={highlight} />;
  if (subpage === 'profiles') return <ProfilesPane subpage={subpage} highlight={highlight} />;
  if (subpage === 'desktop') {
    return (
      <Row path={rowPath('advanced', subpage, 'keep-awake')} title="Keep the computer awake while working" description="Stop the computer sleeping while the agent is working on a request. It may sleep while the agent is only waiting for you." highlight={highlight === 'keep-awake'}>
        <Toggle label="Keep the computer awake while working" checked={preferences.keepAwake} onChange={(keepAwake) => void onPreferences({ keepAwake })} />
      </Row>
    );
  }
  return (
    <Row path={rowPath('advanced', subpage, 'max-steps')} title="Steps per request" description="The most model calls one request may use before it is stopped." highlight={highlight === 'max-steps'}>
      {!settings?.baseUrl ? (
        <Empty>Set up a model first (Model).</Empty>
      ) : (
        <div className="inline-form">
          <label className="field compact"><span>Steps per request</span><input type="number" min={1} max={100} step={1} value={steps} onChange={(event) => { setSteps(event.target.value); setStatus(null); }} /></label>
          <button type="button" className="btn primary" disabled={!valid} onClick={() => void save()}>Save</button>
          {!valid && <span className="field-error">Use a whole number from 1 to 100.</span>}
          {status && <span className={status.ok ? 'field-ok' : 'field-error'} role={status.ok ? 'status' : 'alert'}>{status.text}</span>}
        </div>
      )}
    </Row>
  );
}

// ---- About ---------------------------------------------------------------------------------------------------

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <tr><th scope="row">{label}</th><td>{children}</td></tr>;
}

export function AboutSection({ subpage, highlight, coreStatus }: SectionProps) {
  const load = useCallback(() => window.mobius.app.about(), []);
  const { value: about } = useLoaded<AboutInfo | null>(load, null);
  const STATUS: Record<CoreStatus, string> = { starting: 'Starting', ready: 'Running', restarting: 'Restarting', failed: 'Not running' };
  return (
    <>
      <div className="about-brand">
        <MobiusMark size={56} label="Mobius" />
        <div>
          <p className="about-name">Mobius</p>
          <p className="about-line">{about?.app ? `Version ${about.app}` : 'An agent and the apps it works in.'}</p>
        </div>
      </div>
      <Row path={rowPath('about', subpage, 'versions')} title="Versions" description="Mobius, its core, and the parts it runs on." highlight={highlight === 'versions'}>
        <table className="stable" aria-label="Versions">
          <tbody>
            <Fact label="Mobius">{about?.app ?? '…'}</Fact>
            <Fact label="Core">{about?.core ? `${about.core.version} (protocol ${about.core.protocol})` : 'Not running'}</Fact>
            <Fact label="Web engine">{about?.engine ?? '…'}</Fact>
            <Fact label="System">{about ? `${about.platform} ${about.arch}` : '…'}</Fact>
          </tbody>
        </table>
      </Row>
      <Row path={rowPath('about', subpage, 'data-folder')} title="Data folder" description="Where settings, approvals and conversations are stored on this computer." highlight={highlight === 'data-folder'}>
        <p className="srow-text mono">{about?.dataFolder ?? '…'}</p>
        <button type="button" className="btn" onClick={() => void window.mobius.app.openDataFolder()}>Open data folder</button>
      </Row>
      {window.mobius.app.removeData && (
        <Row path={rowPath('about', subpage, 'remove-data')} title="Remove my data" description="Deletes conversations, settings, approvals, saved pages, downloaded models and saved API keys, and your Notes and every other file in the Mobius workspace. Mobius then closes. Files you downloaded with the browser are not touched." highlight={highlight === 'remove-data'}>
          <RemoveData />
        </Row>
      )}
      <Row path={rowPath('about', subpage, 'core-status')} title="Core status" description="Whether the part that makes decisions and keeps records is running." highlight={highlight === 'core-status'}>
        <p className="srow-text" role="status">{STATUS[coreStatus]}</p>
      </Row>
    </>
  );
}

/** Asks twice before removing everything, and says what happened. */
function RemoveData() {
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!asking) return <><button type="button" className="btn danger" onClick={() => setAsking(true)}>Remove my data…</button>{problem && <span className="field-error" role="alert">{problem}</span>}</>;
  return (
    <span className="clist-confirm" role="group" aria-label="Confirm removing all data">
      <button type="button" className="btn danger" onClick={() => void window.mobius.app.removeData?.().then((r) => { if (!r.ok) { setProblem(r.error); setAsking(false); } })}>Yes, remove everything</button>
      <button type="button" className="btn" onClick={() => setAsking(false)}>Cancel</button>
      {problem && <span className="field-error" role="alert">{problem}</span>}
    </span>
  );
}

/** Servers saved by name: save the one in use, switch to another, or remove one. */
function SavedServers({ current }: { current: string }) {
  const [servers, setServers] = useState<SavedServer[]>([]);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const reload = () => void window.mobius.agent.savedServers?.().then(setServers);
  useEffect(reload, []);
  const run = (task: Promise<AgentResult> | undefined, after?: () => void) =>
    void task?.then((r) => {
      setProblem(r.ok ? null : r.error);
      if (r.ok) after?.();
      reload();
    });
  return (
    <div className="saved-servers">
      {servers.length > 0 && (
        <ul className="clist" role="list" aria-label="Saved servers">
          {servers.map((s) => (
            <li key={s.id} className="clist-item" aria-current={`${s.baseUrl}|${s.model}` === current ? 'true' : undefined}>
              <span className="clist-main"><span className="clist-title">{s.name}</span><span className="clist-meta">{s.model} · {s.baseUrl}{s.hasKey ? '' : ' · no key'}</span></span>
              <button type="button" className="btn" aria-label={`Use ${s.name}`} onClick={() => run(window.mobius.agent.useServer?.(s.id))}>Use</button>
              <button type="button" className="btn" aria-label={`Remove ${s.name}`} onClick={() => run(window.mobius.agent.removeServer?.(s.id))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <span className="field-inline">
        <input className="input" aria-label="Name for this server" placeholder="Name, e.g. Work" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" className="btn" disabled={name.trim() === ''} onClick={() => run(window.mobius.agent.saveServer?.(name), () => setName(''))}>Keep current server</button>
      </span>
      {problem && <span className="field-error" role="alert">{problem}</span>}
    </div>
  );
}

/** Show, hide and reorder the sidebar's apps. At least one stays, so the sidebar is never empty. */
function SidebarAppsEditor({ value, onChange }: { value: SidebarApp[]; onChange: (apps: SidebarApp[]) => void }) {
  const hidden = SIDEBAR_APPS.filter((id) => !value.includes(id));
  const move = (id: SidebarApp, by: -1 | 1) => {
    const at = value.indexOf(id);
    const to = at + by;
    if (at < 0 || to < 0 || to >= value.length) return;
    const next = [...value];
    [next[at], next[to]] = [next[to]!, next[at]!];
    onChange(next);
  };
  return (
    <ul className="sidebar-apps" aria-label="Apps in the sidebar">
      {[...value, ...hidden].map((id) => {
        const shown = value.includes(id);
        const at = value.indexOf(id);
        return (
          <li key={id} className="sidebar-app" data-hidden={!shown || undefined}>
            <label className="sidebar-app-show">
              <input type="checkbox" checked={shown} disabled={shown && value.length === 1}
                onChange={(e) => onChange(e.target.checked ? [...value, id] : value.filter((v) => v !== id))} />
              <svg viewBox="0 0 20 20" aria-hidden="true" data-app={id}>{APP_ICONS[id]}</svg>
              <span>{appName(id)}</span>
            </label>
            {shown && (
              <span className="sidebar-app-order">
                <button type="button" className="strip-btn" aria-label={`Move ${appName(id)} up`} disabled={at === 0} onClick={() => move(id, -1)}>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 12 4-4 4 4" /></svg>
                </button>
                <button type="button" className="strip-btn" aria-label={`Move ${appName(id)} down`} disabled={at === value.length - 1} onClick={() => move(id, 1)}>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
                </button>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
