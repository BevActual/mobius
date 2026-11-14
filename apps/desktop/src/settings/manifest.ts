export type SectionId = 'general' | 'appearance' | 'model' | 'providers' | 'voice' | 'safety' | 'memory' | 'privacy' | 'schedules' | 'browser' | 'mail' | 'calendar' | 'notifications' | 'sessions' | 'keyboard' | 'extensions' | 'usage' | 'advanced' | 'about';

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
  /** The heading it is listed under in the sidebar. */
  group?: string;
  /** Other names it is found by (Gateways was Providers). */
  keywords?: readonly string[];
}

const row = (id: string, label: string, description: string, ...keywords: string[]): SettingRow => ({ id, label, description, keywords });

/**
 * Every setting there is, in one place, so the page and the search cannot disagree. The shape follows Hermes's
 * settings: sections with subpages, and each row can be found by search. Only what Mobius really has is listed.
 */
const SECTIONS: readonly SettingsSection[] = [
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'How Mobius looks.',
    subpages: [
      { id: 'theme', label: 'Theme', rows: [row('theme', 'Theme', 'Follow the system (light by day, dark by night), or always use Light, Mid grey, Dark or Cool dark.', 'color', 'colour', 'mode', 'dark', 'light', 'night', 'grey', 'gray', 'mid', 'cool')] },
      { id: 'typography', label: 'Typography', rows: [
        row('ui-zoom', 'Interface zoom', 'Make everything in the window larger or smaller.', 'scale', 'zoom', 'bigger', 'smaller', 'size'),
        row('chat-text', 'Conversation text size', 'The size of text in the agent panel.', 'font', 'chat', 'text', 'size', 'bigger', 'smaller'),
        row('chat-font', 'Conversation font', 'The typeface used for messages.', 'font', 'typeface', 'serif', 'sans', 'monospace', 'mono', 'family'),
      ] },
      { id: 'layout', label: 'Layout', rows: [
        row('sidebar-apps', 'Apps in the sidebar', 'Choose which apps the sidebar lists, and their order. The others stay in All apps.', 'sidebar', 'apps', 'reorder', 'order', 'hide', 'show', 'customise', 'customize', 'rail'),
        row('sidebar-at-start', 'Show the tab list at start', "Whether the browser's list of tabs is open when Mobius starts.", 'sidebar', 'tabs', 'startup', 'panel'),
        row('left-sidebar', 'Tab and conversation list', 'Attached keeps it beside the page. Floating shows it over the page when you move to the edge, and hides it again.', 'floating', 'attached', 'auto hide', 'autohide', 'pinned', 'sidebar', 'overlay', 'left'),
        row('right-sidebar', 'Agent panel', 'Attached keeps it beside the page. Floating shows it over the page when you move to the edge, and hides it again.', 'floating', 'attached', 'auto hide', 'autohide', 'pinned', 'sidebar', 'overlay', 'right', 'chat panel'),
        row('sidebar-size', 'Sidebar sizes', 'Drag the edge of a sidebar to resize it, or focus the edge and use the arrow keys. Double-click puts the usual width back.', 'width', 'resize', 'wider', 'narrower', 'reset size'),
        row('density', 'List density', 'How tightly tabs and conversations are packed.', 'compact', 'comfortable', 'spacing', 'sidebar', 'dense'),
        row('key-hints', 'Key hints', 'A small bar under lists with their most useful keys. It hides itself once you use them.', 'keyboard', 'shortcuts', 'keys', 'hints', 'hint bar'),
      ] },
      { id: 'chat-display', label: 'Conversation', rows: [
        row('text-direction', 'Text direction', 'Left to right, right to left, or decided by each message.', 'rtl', 'ltr', 'right to left', 'left to right', 'arabic', 'hebrew', 'bidi', 'direction'),
        row('tool-steps', 'Tool steps', 'Keep finished tool steps in the conversation, or show only the ones that need you.', 'hide tool steps', 'tools', 'technical', 'details', 'clutter', 'compact'),
      ] },
    ],
  },
  {
    id: 'model',
    label: 'Models',
    description: 'Which model does what. The services they come from are in Gateways.',
    subpages: [
      { id: 'main', label: 'Defaults', rows: [
        row('second-model', 'Second model', 'Asked when the first is busy, down or cannot be reached.', 'fallback', 'backup', 'failover', 'second model', 'outage', 'rate limit'),
        row('chat-model', 'Chat model', 'The model Mobius talks to, from the services connected in Gateways.', 'model', 'chat model', 'default model', 'which model', 'switch model', 'gpt', 'claude', 'qwen', 'llama'),
        row('quick-model', 'Quick model', 'For quick jobs, like checking a step in Auto before it runs.', 'quick', 'fast model', 'small model', 'reviewer', 'smart approval', 'models by task', 'task model', 'cheap model'),
        row('images', 'Images', 'Makes pictures for Photo, Design and Slides when you ask.', 'image generation', 'pictures', 'dall-e', 'gpt image', 'flux', 'generate image', 'art', 'models by task', 'image model'),
        row('listen', 'Listen', 'Turns your speech into text when you dictate.', 'speech to text', 'stt', 'dictation', 'transcribe', 'models by task', 'voice model'),
        row('speak', 'Speak', 'Reads replies aloud.', 'text to speech', 'tts', 'read aloud', 'models by task', 'voice model'),
        row('effort', 'Effort', 'How hard the model is asked to think. Also in the message box. Only models that can reason use it.', 'reasoning', 'thinking', 'low', 'medium', 'high', 'effort'),
      ] },
      { id: 'local', label: 'This computer', rows: [
        row('quick-setup', 'Set up a local model', 'Install the engine, pick a model that fits, download it and start it, in one step.', 'quick', 'setup', 'easy', 'automatic', 'guided', 'wizard', 'local', 'offline', 'private'),
        row('hardware', 'Your computer', 'The graphics card and memory models have to fit in.', 'gpu', 'vram', 'graphics', 'memory', 'ram', 'nvidia'),
        row('engine', 'Engine', 'The program that runs models: llama.cpp, in the build for your graphics card.', 'llama.cpp', 'llama-server', 'cuda', 'vulkan', 'install', 'update', 'gpu', 'runtime'),
        row('running', 'Running now', 'The model Mobius is running for the agent.', 'llama', 'llama.cpp', 'stop', 'server', 'local', 'runtime'),
        row('context-size', 'Context size', 'How much text a local model keeps in view. More uses more graphics memory.', 'context length', 'context window', 'tokens', 'ctx', 'memory', 'vram'),
        row('local-models', 'On this computer', 'Models you have downloaded. Run one to use it for the agent.', 'gguf', 'run', 'files', 'offline', 'private'),
        row('find-models', 'Find models', 'Search Hugging Face, or let Mobius suggest what will run well here, and download one.', 'download', 'search', 'recommend', 'suggest', 'huggingface', 'hugging face', 'gguf'),
      ] },
    ],
  },
  {
    id: 'providers',
    label: 'Gateways',
    description: 'Connect services: a key for each, or an account you sign in to. Which model does what is in Models.',
    keywords: ['providers', 'provider', 'gateway', 'connect', 'elevenlabs'],
    subpages: [
      { id: 'keys', label: 'API keys', rows: [
        row('provider-keys', 'Your gateways', 'One key per service, kept in the system\'s secret store and never shown again. A key is only ever sent to its own service. Use a provider to switch the agent to it.', 'keys', 'credentials', 'accounts', 'sign in', 'oauth', 'switch provider', 'services', 'claude', 'gpt', 'grok', 'openrouter', 'groq', 'mistral', 'deepseek', 'together', 'fireworks', 'hugging face', 'gemini', 'cerebras', 'perplexity', 'cohere', 'kimi', 'moonshot', 'qwen', 'glm', 'nvidia'),
        row('custom-server', 'Custom server', 'Any server that speaks the OpenAI chat format, at an address you give.', 'custom', 'server', 'address', 'url', 'endpoint', 'self hosted', 'openai compatible'),
        row('provider', 'Service', 'Pick a service to fill in its server address.', 'openai', 'openrouter', 'anthropic', 'claude', 'gemini', 'google', 'groq', 'deepseek', 'mistral', 'ollama', 'lm studio', 'cloud', 'service', 'preset'),
        row('endpoint', 'Server address', 'Where the model is. Any server that speaks the OpenAI chat format works, including local ones.', 'url', 'endpoint', 'local', 'host'),
        row('model-name', 'Model', 'The model name to ask for.', 'name', 'qwen', 'gpt'),
        row('api-key', 'API key', 'Stored encrypted by your system when it can. It is never shown again.', 'key', 'secret', 'token', 'password', 'credential'),
        row('fallback', 'Second model', 'A model to use when the first is busy, down or cannot be reached.', 'fallback', 'backup', 'failover', 'retry', 'second model', 'outage', 'rate limit'),
        row('instructions', 'Instructions', 'Extra instructions the agent always follows.', 'system prompt', 'persona', 'personality'),
      ] },
    ],
  },
  {
    id: 'safety',
    label: 'Approvals and safety',
    description: 'What the agent may do, and a record of what it did.',
    subpages: [
      { id: 'approvals', label: 'Approvals', rows: [
        row('approval-mode', 'Permission', 'How much Mobius does without asking: Ask each time, Review changes, Apply changes or Auto.', 'permission', 'ask each time', 'review changes', 'apply changes', 'auto', 'approval mode', 'smart approvals', 'manual', 'smart', 'off', 'yolo', 'permissions', 'prompts', 'confirm', 'ask', 'guardian', 'reviewer'),
        row('app-access', 'What Mobius may do in each app', 'For the browser, notes and tasks: off, ask first, read without asking, or act without asking. Risky actions still ask.', 'per app', 'autonomy', 'access', 'permissions', 'browser', 'notes', 'tasks', 'off limits', 'read', 'act'),
        row('always-allowed', 'Always allowed', 'Actions you chose to always allow. Remove one to be asked again.', 'revoke', 'permissions', 'grants', 'remove', 'allow'),
        row('each-time', 'Asked every time', 'Some actions can only ever be allowed one use at a time.', 'once', 'command', 'delete', 'secrets', 'click', 'type'),
      ] },
      { id: 'activity', label: 'Activity', rows: [row('activity-log', 'Activity log', 'A record of what was asked, allowed and run. It never contains what was typed or read.', 'log', 'history', 'audit', 'events', 'record')] },
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
  // Mail: its accounts live here, so the Mail app's sidebar holds only mail.
  {
    id: 'mail',
    label: 'Mail',
    description: 'The accounts Mail reads and sends from.',
    subpages: [
      { id: 'accounts', label: 'Accounts', rows: [row('mail-accounts', 'Mail accounts', 'Add a mail account, or remove one. Its mail stays with your provider.', 'email', 'imap', 'smtp', 'icloud', 'gmail', 'fastmail', 'yahoo', 'app password', 'add account', 'remove account')] },
    ],
  },
  // Calendar: its accounts live here, so the Calendar app's sidebar holds only calendars.
  {
    id: 'calendar',
    label: 'Calendar',
    description: 'The calendars Calendar reads from elsewhere.',
    subpages: [
      { id: 'accounts', label: 'Accounts', rows: [row('calendar-accounts', 'Calendar accounts', 'Subscribe to a calendar link, or connect iCloud, Fastmail or Nextcloud. Refresh or remove one.', 'calendar', 'caldav', 'subscribe', 'webcal', 'ics', 'icloud', 'fastmail', 'nextcloud', 'google calendar', 'outlook', 'add account', 'remove account', 'refresh')] },
    ],
  },
  {
    id: 'schedules',
    label: 'Schedules',
    description: 'Things to ask Mobius at a time of day.',
    subpages: [
      { id: 'scheduled', label: 'Scheduled', rows: [
        row('schedules', 'Scheduled requests', 'Ask Mobius something at a time of day, on the days you choose. Each run is a new conversation, and it asks before acting as usual.', 'schedule', 'cron', 'every day', 'weekdays', 'morning brief', 'daily', 'recurring', 'automation', 'timer'),
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
    description: 'Click a shortcut to change it.',
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
      { id: 'other-apps', label: 'Other apps', rows: [
        row('share-mcp', 'Let other apps use Mobius', 'Agents such as Claude Code or Hermes can read the files in your workspace over MCP, on this computer only. Off until you turn it on.', 'mcp', 'server', 'claude code', 'hermes', 'share', 'expose', 'integration', 'agents', 'connect'),
        row('share-changes', 'Let them change files', 'Other apps may also create and edit files. Each change is checkpointed, so it can be undone.', 'write', 'edit', 'mcp', 'permission'),
      ] },
      { id: 'profiles', label: 'Profiles', rows: [row('profiles', 'Profiles', 'Keep parts of your life apart: each profile has its own conversations, notes, tasks, memory, schedules and settings. Downloaded models are shared.', 'profile', 'work', 'personal', 'client', 'switch', 'space', 'account', 'separate')] },
    ],
  },
  {
    id: 'about',
    label: 'About',
    description: 'What is installed.',
    subpages: [{ id: 'app', label: 'This app', rows: [
      row('software-update', 'Software Update', 'The version running, and Check for Updates.', 'update', 'updates', 'upgrade', 'new version', 'check for updates', 'version', 'install'),
      row('auto-update', 'Automatically install updates', 'Install a downloaded update the next time Mobius quits.', 'automatic', 'auto update', 'updates', 'install'),
      row('versions', 'Versions', 'Mobius, its core, and the parts it runs on.', 'version', 'engine', 'chromium', 'build', 'core status', 'health', 'running', 'restart'),
      row('data-folder', 'Data folder', 'Where settings, approvals and conversations are stored on this computer.', 'path', 'folder', 'files'),
    ] }],
  },
  {
    id: 'general',
    label: 'General',
    description: 'How Mobius starts, and the computer while it works.',
    subpages: [
      { id: 'general', label: 'General', rows: [
        row('resume-last', 'Reopen the last conversation', 'When Mobius starts, open the conversation you were in instead of a blank one.', 'resume', 'reopen', 'startup', 'launch', 'last chat', 'last conversation'),
        row('keep-awake', 'Keep the computer awake while working', 'Stop the computer sleeping while the agent is working on a request. It may sleep while the agent is only waiting for you.', 'keep awake', 'prevent sleep', 'caffeinate', 'idle', 'power', 'overnight'),
      ] },
    ],
  },
  {
    id: 'usage',
    label: 'Usage',
    description: 'Tokens used and what they may have cost, by day.',
    keywords: ['cost', 'spend', 'billing', 'tokens', 'money', 'price'],
    subpages: [{ id: 'usage', label: 'Usage', rows: [
      row('usage-period', 'Period', 'Which days to show: the last 7, 30 or 90 days, or this month.', 'days', 'week', 'month', 'range'),
      row('usage-summary', 'Totals', 'Tokens, estimated cost and requests for the period.', 'tokens', 'cost', 'spend', 'total', 'money', 'billing'),
      row('usage-chart', 'Tokens by day', 'How many tokens each day used.', 'chart', 'daily', 'graph'),
      row('usage-breakdown', 'Breakdown', 'The period by model, service or app.', 'by model', 'by app', 'by service', 'gateway', 'provider', 'cost per model'),
      row('usage-export', 'Export', 'Every day, service, model and app as CSV.', 'csv', 'spreadsheet', 'download', 'copy', 'excel'),
      row('usage-clear', 'Clear usage', 'Forget every count kept so far.', 'reset', 'delete', 'forget'),
    ] }],
  },
  {
    id: 'voice',
    label: 'Voice',
    description: 'Who listens when you dictate, and who speaks answers aloud. Each has its own service and a fallback.',
    subpages: [
      { id: 'listening', label: 'Listening', rows: [
        row('listen-with', 'Listen with', 'Speech to text: the chat model\'s server, a speech server on this computer, or ElevenLabs.', 'dictation', 'dictate', 'speech to text', 'stt', 'whisper', 'faster-whisper', 'transcribe', 'microphone', 'mic', 'elevenlabs', 'local'),
        row('listen-model', 'Speech model', 'The model asked for when you dictate.', 'whisper', 'whisper-1', 'model', 'dictation model'),
        row('listen-url', 'Speech server on this computer', 'Its address, in OpenAI\'s audio format, as faster-whisper serves it.', 'url', 'address', 'faster-whisper', 'speech server'),
        row('listen-fallback', 'If that cannot listen', 'What to try next.', 'fallback', 'backup', 'second'),
        row('listen-test', 'Try listening', 'Ask the chosen server whether it answers.', 'test', 'check', 'try'),
      ] },
      { id: 'speaking', label: 'Speaking', rows: [
        row('speak-with', 'Speak with', 'Text to speech: a speech server on this computer, ElevenLabs, or off.', 'text to speech', 'tts', 'kokoro', 'read aloud', 'voice', 'speak', 'elevenlabs', 'local'),
        row('speak-model', 'Voice model', 'The model asked for when speaking.', 'kokoro', 'model', 'tts model'),
        row('speak-voice', 'Voice', 'The voice to speak with. Empty uses the server\'s own.', 'voice', 'speaker', 'narrator'),
        row('speak-url', 'Speech server on this computer', 'Its address, in OpenAI\'s audio format, as Kokoro serves it.', 'url', 'address', 'kokoro', 'speech server'),
        row('speak-fallback', 'If that cannot speak', 'What to try next.', 'fallback', 'backup', 'second'),
        row('read-aloud', 'Read replies aloud', 'Each new reply is read as it arrives; Esc or a new message stops it.', 'read aloud', 'speak replies', 'tts', 'voice', 'listen to replies'),
        row('speak-test', 'Try speaking', 'Ask the chosen server whether it answers.', 'test', 'check', 'try'),
      ] },
    ],
  },
  {
    id: 'memory',
    label: 'Memory',
    description: 'What Mobius remembers between conversations.',
    subpages: [
      { id: 'memory', label: 'Memory', rows: [
        row('remembered', 'What Mobius remembers', 'Short facts Mobius keeps between conversations. It asks before remembering unless you chose otherwise. Forget any of them here.', 'memory', 'remember', 'forget', 'knowledge', 'wiki', 'how I work', 'facts', 'personal', 'learned'),
      ] },
    ],
  },
  {
    id: 'privacy',
    label: 'Privacy',
    description: 'What Mobius read, where your requests go, and how keys are kept.',
    subpages: [
      { id: 'privacy', label: 'Privacy', rows: [
        row('privacy-report', 'Privacy report', 'What Mobius read and changed in the last seven days, by app, and where your requests are answered.', 'privacy', 'report', 'what was read', 'data', 'local', 'on device', 'where'),
        row('key-storage', 'Key storage', 'Whether your API key is stored encrypted by the system or only kept until you quit.', 'keychain', 'encrypted', 'secret'),
        row('web-content', 'Web content', 'Text from web pages is treated as untrusted and never as instructions.', 'prompt injection', 'untrusted', 'pages'),
        row('remove-data', 'Remove my data', 'Delete everything Mobius keeps on this computer, then close.', 'delete', 'erase', 'reset', 'wipe', 'uninstall', 'clear all', 'factory'),
      ] },
    ],
  },
  {
    id: 'extensions',
    label: 'Abilities',
    description: 'Apps, skills, connectors and plugins live in the Abilities app.',
    subpages: [
      { id: 'open', label: 'Abilities', rows: [
        row('extensions-app', 'Open Abilities', 'Add and remove apps, and install, update and turn off skills, connectors and plugins.', 'extensions', 'add apps', 'remove apps', 'apps', 'skills', 'connectors', 'plugins', 'mcp', 'catalogue', 'install', 'updates'),
      ] },
    ],
  },
];

/** The sidebar's order, under its headings, as in System Settings. */
const ORDER: ReadonlyArray<[SectionId, string]> = [
  ['general', 'Mobius'], ['appearance', 'Mobius'], ['notifications', 'Mobius'], ['keyboard', 'Mobius'],
  ['providers', 'Models'], ['model', 'Models'], ['voice', 'Models'], ['usage', 'Models'],
  ['safety', 'Safety'], ['memory', 'Safety'], ['privacy', 'Safety'],
  ['browser', 'Apps'], ['mail', 'Apps'], ['calendar', 'Apps'], ['sessions', 'Apps'], ['schedules', 'Apps'], ['extensions', 'Apps'],
  ['advanced', 'System'], ['about', 'System'],
];

/**
 * Every setting there is, in one place, so the page and the search cannot disagree: sections under headings, each
 * with subpages, and each row can be found by search. Only what Mobius really has is listed.
 */
export const SETTINGS: readonly SettingsSection[] = ORDER.map(([id, group]) => ({ ...SECTIONS.find((x) => x.id === id)!, group }));

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
        const rest = [item.description, ...item.keywords, page.label, section.label, ...(section.keywords ?? [])].join(' ').toLowerCase();
        if (!words.every((word) => name.includes(word) || rest.includes(word))) continue;
        // A word in the row's name counts most; a keyword that is exactly the phrase typed (an old name, such as
        // "approval mode" for Permission) counts more still.
        const exact = words.length > 1 && item.keywords.some((k) => k.toLowerCase() === words.join(' ')) ? 3 : 0;
        const score = words.filter((word) => name.includes(word)).length * 2 + exact;
        hits.push({ section: section.id, subpage: page.id, row: item.id, label: item.label, description: item.description, where: `${section.label} › ${page.label}`, score });
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score).map(({ score: _score, ...hit }) => hit);
}
