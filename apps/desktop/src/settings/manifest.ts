export type SectionId = 'appearance' | 'model' | 'safety' | 'browser' | 'notifications' | 'sessions' | 'keyboard' | 'advanced' | 'about';

export interface SettingRow {
  id: string;
  label: string;
  description: string;
  /** Other words someone might type to find it. */
  keywords: readonly string[];
}

export interface SettingsSubpage { id: string; label: string; rows: readonly SettingRow[] }

export interface SettingsSection {
  id: SectionId;
  label: string;
  description: string;
  subpages: readonly SettingsSubpage[];
}

const row = (id: string, label: string, description: string, ...keywords: string[]): SettingRow => ({ id, label, description, keywords });

/**
 * Every setting there is, in one place, so the page and the search cannot disagree. The shape follows Hermes's
 * settings: sections with subpages, and each row can be found by search. Only what Mobius really has is listed.
 */
export const SETTINGS: readonly SettingsSection[] = [
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'How Mobius looks.',
    subpages: [
      { id: 'general', label: 'General', rows: [
        row('resume-last', 'Reopen the last conversation', 'When Mobius starts, open the conversation you were in instead of a blank one.', 'resume', 'reopen', 'startup', 'launch', 'last chat', 'last conversation'),
      ] },
      { id: 'theme', label: 'Theme', rows: [row('theme', 'Theme', 'Follow the system, or always use light or dark.', 'color', 'colour', 'mode', 'dark', 'light', 'night')] },
      { id: 'typography', label: 'Typography', rows: [
        row('ui-zoom', 'Interface zoom', 'Make everything in the window larger or smaller.', 'scale', 'zoom', 'bigger', 'smaller', 'size'),
        row('chat-text', 'Conversation text size', 'The size of text in the agent panel.', 'font', 'chat', 'text', 'size', 'bigger', 'smaller'),
        row('chat-font', 'Conversation font', 'The typeface used for messages.', 'font', 'typeface', 'serif', 'sans', 'monospace', 'mono', 'family'),
      ] },
      { id: 'layout', label: 'Layout', rows: [
        row('sidebar-at-start', 'Show the tab list at start', "Whether the browser's list of tabs is open when Mobius starts.", 'sidebar', 'tabs', 'startup', 'panel'),
        row('left-sidebar', 'Tab and conversation list', 'Attached keeps it beside the page. Floating shows it over the page when you move to the edge, and hides it again.', 'floating', 'attached', 'auto hide', 'autohide', 'pinned', 'sidebar', 'overlay', 'left'),
        row('right-sidebar', 'Agent panel', 'Attached keeps it beside the page. Floating shows it over the page when you move to the edge, and hides it again.', 'floating', 'attached', 'auto hide', 'autohide', 'pinned', 'sidebar', 'overlay', 'right', 'chat panel'),
        row('sidebar-size', 'Sidebar sizes', 'Drag the edge of a sidebar to resize it, or focus the edge and use the arrow keys. Double-click puts the usual width back.', 'width', 'resize', 'wider', 'narrower', 'reset size'),
        row('density', 'List density', 'How tightly tabs and conversations are packed.', 'compact', 'comfortable', 'spacing', 'sidebar', 'dense'),
      ] },
      { id: 'chat-display', label: 'Conversation', rows: [
        row('text-direction', 'Text direction', 'Left to right, right to left, or decided by each message.', 'rtl', 'ltr', 'right to left', 'left to right', 'arabic', 'hebrew', 'bidi', 'direction'),
        row('tool-steps', 'Tool steps', 'Keep finished tool steps in the conversation, or show only the ones that need you.', 'hide tool steps', 'tools', 'technical', 'details', 'clutter', 'compact'),
      ] },
    ],
  },
  {
    id: 'model',
    label: 'Model',
    description: 'The model the agent talks to.',
    subpages: [
      { id: 'main', label: 'Server', rows: [
        row('provider', 'Provider', 'Pick a service to fill in its server address.', 'openai', 'openrouter', 'anthropic', 'claude', 'gemini', 'google', 'groq', 'deepseek', 'mistral', 'ollama', 'lm studio', 'cloud', 'service', 'preset'),
        row('endpoint', 'Server address', 'Where the model is. Any server that speaks the OpenAI chat format works, including local ones.', 'url', 'endpoint', 'local', 'host'),
        row('model-name', 'Model', 'The model name to ask for.', 'name', 'qwen', 'gpt'),
        row('api-key', 'API key', 'Stored encrypted by your system when it can. It is never shown again.', 'key', 'secret', 'token', 'password', 'credential'),
        row('fallback', 'Second model', 'A model to use when the first is busy, down or cannot be reached.', 'fallback', 'backup', 'failover', 'retry', 'second model', 'outage', 'rate limit'),
        row('instructions', 'Instructions', 'Extra instructions the agent always follows.', 'system prompt', 'persona', 'personality'),
        row('dictation-model', 'Voice dictation', 'The speech model asked for when you dictate a message. It runs on the same server as the chat model.', 'speech', 'whisper', 'microphone', 'mic', 'transcribe', 'voice', 'stt', 'dictate'),
        row('effort', 'Effort', 'How hard the model is asked to think. Also in the message box. Only models that can reason use it.', 'reasoning', 'thinking', 'low', 'medium', 'high', 'effort'),
      ] },
      { id: 'local', label: 'This computer', rows: [
        row('hardware', 'Your computer', 'The graphics card and memory models have to fit in.', 'gpu', 'vram', 'graphics', 'memory', 'ram', 'nvidia'),
        row('running', 'Running now', 'The model Mobius is running for the agent.', 'llama', 'llama.cpp', 'stop', 'server', 'local', 'runtime'),
        row('context-size', 'Context size', 'How much text a local model keeps in view. More uses more graphics memory.', 'context length', 'context window', 'tokens', 'ctx', 'memory', 'vram'),
        row('local-models', 'On this computer', 'Models you have downloaded. Run one to use it for the agent.', 'gguf', 'run', 'files', 'offline', 'private'),
        row('find-models', 'Find models', 'Search Hugging Face, or let Mobius suggest what will run well here, and download one.', 'download', 'search', 'recommend', 'suggest', 'huggingface', 'hugging face', 'gguf'),
      ] },
    ],
  },
  {
    id: 'safety',
    label: 'Safety',
    description: 'What the agent may do, and a record of what it did.',
    subpages: [
      { id: 'approvals', label: 'Approvals', rows: [
        row('approval-mode', 'Approval mode', 'Manual asks before the agent acts. Smart lets a reviewer model approve the clearly safe ones. Off lets it act without asking.', 'approval mode', 'manual', 'smart', 'off', 'yolo', 'permissions', 'prompts', 'confirm', 'ask', 'guardian', 'reviewer'),
        row('always-allowed', 'Always allowed', 'Actions you chose to always allow. Remove one to be asked again.', 'revoke', 'permissions', 'grants', 'remove', 'allow'),
        row('each-time', 'Asked every time', 'Some actions can only ever be allowed one use at a time.', 'once', 'command', 'delete', 'secrets', 'click', 'type'),
      ] },
      { id: 'activity', label: 'Activity', rows: [row('activity-log', 'Activity log', 'A record of what was asked, allowed and run. It never contains what was typed or read.', 'log', 'history', 'audit', 'events', 'record')] },
      { id: 'privacy', label: 'Privacy', rows: [
        row('key-storage', 'Key storage', 'Whether your API key is stored encrypted by the system or only kept until you quit.', 'keychain', 'encrypted', 'secret'),
        row('web-content', 'Web content', 'Text from web pages is treated as untrusted and never as instructions.', 'prompt injection', 'untrusted', 'pages'),
      ] },
    ],
  },
  {
    id: 'browser',
    label: 'Browser',
    description: 'What the agent may do in the browser.',
    subpages: [
      { id: 'sites', label: 'Sites', rows: [row('allowed-sites', 'Allowed sites', 'Sites the agent may open without asking. Remove one to be asked again.', 'websites', 'domains', 'origins', 'navigate', 'revoke')] },
      { id: 'network', label: 'Network', rows: [row('private-addresses', 'Local addresses', 'Let the agent use addresses on this computer or your local network. Off by default, so a web page cannot steer it at your router or a local service.', 'local network', 'localhost', 'private', 'lan', 'intranet', '127.0.0.1', '192.168', 'router', 'ssrf', 'security')] },
      { id: 'bookmarks', label: 'Bookmarks', rows: [row('saved-pages', 'Bookmarks', 'Pages you saved with the star next to the address.', 'bookmarks', 'favourites', 'favorites', 'saved pages', 'star', 'remove bookmark')] },
      { id: 'history', label: 'History', rows: [
        row('keep-history', 'Keep browsing history', 'Remember the pages you visit, on this computer only.', 'browsing history', 'remember', 'pages visited', 'privacy', 'off'),
        row('history-list', 'Pages you visited', 'Search the pages you visited, remove one, or clear them all.', 'browsing history', 'clear history', 'search history', 'delete', 'visited'),
      ] },
    ],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'When Mobius may tell you something while you are in another window.',
    subpages: [
      { id: 'alerts', label: 'Alerts', rows: [
        row('notify-needs-you', 'When it needs you', 'Tell me when the agent is waiting for my answer.', 'notify me', 'alerts', 'approval', 'waiting', 'banner', 'do not disturb'),
        row('notify-finished', 'When a request finishes', 'Tell me when the agent has finished or has stopped because of a problem.', 'notify me', 'alerts', 'done', 'complete', 'failed', 'do not disturb'),
        row('notify-downloads', 'When a download finishes', 'Tell me when a file has finished downloading.', 'notify me', 'alerts', 'downloads', 'file', 'do not disturb'),
      ] },
      { id: 'sounds', label: 'Sounds', rows: [
        row('mute-sounds', 'Mute notification sounds', 'Notifications arrive without a sound.', 'mute sounds', 'silence', 'quiet', 'chime', 'audio'),
      ] },
    ],
  },
  {
    id: 'sessions',
    label: 'Conversations',
    description: 'Your saved conversations.',
    subpages: [
      { id: 'saved', label: 'Saved', rows: [
        row('saved-conversations', 'Saved conversations', 'Open or delete earlier conversations.', 'sessions', 'chats', 'history', 'delete conversation', 'remove'),
        row('data-location', 'Where they are kept', 'Conversations are stored on this computer.', 'folder', 'storage', 'disk', 'path'),
      ] },
    ],
  },
  {
    id: 'keyboard',
    label: 'Keyboard',
    description: 'Shortcuts.',
    subpages: [{ id: 'shortcuts', label: 'Shortcuts', rows: [
      row('shortcut-list', 'Keyboard shortcuts', 'Change the keys for each shortcut.', 'keys', 'hotkeys', 'keybindings', 'rebind', 'remap', 'ctrl', 'command', 'reset shortcuts'),
      row('quick-entry', 'Quick entry from anywhere', 'A shortcut that works even when Mobius is in the background.', 'global shortcut', 'global hotkey', 'summon', 'bring up', 'wake', 'launch'),
    ] }],
  },
  {
    id: 'advanced',
    label: 'Advanced',
    description: 'For when the defaults are not right.',
    subpages: [
      { id: 'agent', label: 'Agent', rows: [row('max-steps', 'Steps per request', 'The most model calls one request may use before it is stopped.', 'limit', 'loop', 'iterations', 'runaway')] },
      { id: 'desktop', label: 'Desktop', rows: [row('keep-awake', 'Keep the computer awake while working', 'Stop the computer sleeping while the agent is working on a request. It may sleep while the agent is only waiting for you.', 'keep awake', 'prevent sleep', 'caffeinate', 'idle', 'power', 'overnight')] },
    ],
  },
  {
    id: 'about',
    label: 'About',
    description: 'What is installed.',
    subpages: [{ id: 'app', label: 'This app', rows: [
      row('versions', 'Versions', 'Mobius, its core, and the parts it runs on.', 'version', 'engine', 'chromium', 'build'),
      row('data-folder', 'Data folder', 'Where settings, approvals and conversations are stored on this computer.', 'path', 'folder', 'files'),
      row('core-status', 'Core status', 'Whether the part that makes decisions and keeps records is running.', 'health', 'running', 'restart'),
    ] }],
  },
];

export const settingPath = (section: string, subpage: string, row: string): string => `${section}.${subpage}.${row}`;

export const findSection = (id: string): SettingsSection | undefined => SETTINGS.find((section) => section.id === id);

export interface SearchHit { section: SectionId; subpage: string; row: string; label: string; description: string; where: string }

/** Every word has to match somewhere in the row, its page, or its section. A match in the name ranks first. */
export function searchSettings(query: string): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const hits: Array<SearchHit & { score: number }> = [];
  for (const section of SETTINGS) {
    for (const page of section.subpages) {
      for (const item of page.rows) {
        const name = item.label.toLowerCase();
        const rest = [item.description, ...item.keywords, page.label, section.label].join(' ').toLowerCase();
        if (!words.every((word) => name.includes(word) || rest.includes(word))) continue;
        const score = words.filter((word) => name.includes(word)).length * 2;
        hits.push({ section: section.id, subpage: page.id, row: item.id, label: item.label, description: item.description, where: `${section.label} › ${page.label}`, score });
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score).map(({ score: _score, ...hit }) => hit);
}
