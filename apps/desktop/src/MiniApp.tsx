import { useMemo, useState } from 'react';
import { ChatPanel } from './ChatPanel';
import { useAgentSettings } from './useAgentSettings';
import { useAppearance } from './useAppearance';
import { useBots } from './useBots';
import { useConversation } from './useConversation';
import { useCoreStatus } from './useCoreStatus';
import { usePreferences } from './usePreferences';

/** True in the Little Mobius window. The shell gives it the label `mini`; `?view=mini` shows it in a plain browser. */
export function isMiniWindow(): boolean {
  const meta = (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__?.metadata;
  if (meta?.currentWindow?.label === 'mini') return true;
  try { return new URLSearchParams(window.location.search).get('view') === 'mini'; } catch { return false; }
}

/**
 * Little Mobius: the agent in a small window that stays above other apps. Same conversations as the main window,
 * nothing else on screen. Settings and the rest open in the main window.
 */
export function MiniApp() {
  const coreStatus = useCoreStatus();
  const bots = useBots();
  const botIds = useMemo(() => bots.bots.map((bot) => bot.id), [bots.bots]);
  const conversation = useConversation(coreStatus, botIds);
  const preferences = usePreferences();
  useAppearance();
  const { settings, save, reload } = useAgentSettings();
  const [onTop, setOnTop] = useState(true);
  const toMain = () => void window.mobius.mini.showMain();
  const controls = (
    <span className="mini-controls">
      <button type="button" className="strip-btn" aria-pressed={onTop} aria-label={onTop ? 'Stop keeping above other windows' : 'Keep above other windows'} title={onTop ? 'Kept above other windows' : 'Keep above other windows'}
        onClick={() => { const next = !onTop; setOnTop(next); void window.mobius.mini.setOnTop(next); }}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3h6M8 3v6l-3 4h10l-3-4V3M10 13v4" /></svg>
      </button>
      <button type="button" className="strip-btn" aria-label="Open in the main window" title="Open in the main window" onClick={toMain}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11 4h5v5M16 4l-7 7M14 12v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3" /></svg>
      </button>
    </span>
  );
  return (
    <div className="mini" data-core={coreStatus}>
      <ChatPanel
        surface={{ app: 'agent', hasPage: false, note: null, tasks: null }}
        state={conversation.state}
        settings={settings}
        coreReady={coreStatus === 'ready'}
        onSend={(text, items, options) => void conversation.send(text, items, options)}
        onStop={conversation.stop}
        onAnswer={conversation.answer}
        onReply={conversation.reply}
        onSaveSettings={save}
        conversations={conversation.list}
        activeConversation={conversation.id}
        onNewConversation={() => conversation.newConversation()}
        onSelectConversation={conversation.select}
        onOpenSettings={toMain}
        onRetry={conversation.retry}
        onEdit={conversation.edit}
        onDetails={conversation.toolDetails}
        effort={preferences.value.reasoningEffort}
        onEffort={(reasoningEffort) => void preferences.set({ reasoningEffort })}
        onModelChanged={() => void reload()}
        pin={controls}
      />
    </div>
  );
}
