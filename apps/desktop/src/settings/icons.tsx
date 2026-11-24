import type { ReactNode } from 'react';
import { APP_ICONS } from '../Rail';
import type { SectionId } from './manifest';

/** Each section's line icon in the Settings panel (20×20 line drawings, as the app icons). */
export const SECTION_ICONS: Record<SectionId, ReactNode> = {
  connections: <><circle cx="6" cy="10" r="3" /><circle cx="14" cy="10" r="3" /><path d="M9 10h2" /></>,
  general: <><circle cx="10" cy="10" r="2.5" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></>,
  appearance: <><path d="M2.5 10s3-5.5 7.5-5.5 7.5 5.5 7.5 5.5-3 5.5-7.5 5.5S2.5 10 2.5 10Z" /><circle cx="10" cy="10" r="2.2" /></>,
  notifications: <path d="M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 1.5h-13zM8.5 17h3" />,
  keyboard: <><rect x="2.5" y="5.5" width="15" height="9" rx="1.5" /><path d="M5.5 8.5h1M9.5 8.5h1M13.5 8.5h1M6.5 11.5h7" /></>,
  providers: <path d="M7 2.5v4M13 2.5v4M5 6.5h10v3a5 5 0 0 1-10 0zM10 14.5v3" />,
  model: <path d="M10 2.5 16.5 6v8L10 17.5 3.5 14V6zM3.5 6 10 9.5 16.5 6M10 9.5v8" />,
  voice: <><rect x="7.5" y="2.5" width="5" height="9" rx="2.5" /><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" /></>,
  usage: <path d="M4 16.5v-5M8 16.5V7M12 16.5v-7M16 16.5V3.5" />,
  safety: <path d="M10 2.5 16 5v4.5c0 3.8-2.6 6.6-6 8-3.4-1.4-6-4.2-6-8V5z" />,
  memory: <><path d="M10 3.5c-3 0-5.5 2.2-5.5 5 0 1.6.8 3 2 4v3h7v-3c1.2-1 2-2.4 2-4 0-2.8-2.5-5-5.5-5Z" /><path d="M8 16.5h4" /></>,
  privacy: <><rect x="4.5" y="9" width="11" height="8" rx="1.5" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></>,
  schedules: <><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 2" /></>,
  browser: APP_ICONS.browser,
  mail: APP_ICONS.mail,
  calendar: APP_ICONS.calendar,
  contacts: <><circle cx="10" cy="7.5" r="3" /><path d="M4.5 16.5c.8-2.8 3-4.5 5.5-4.5s4.7 1.7 5.5 4.5" /></>,
  messages: APP_ICONS.messages,
  sessions: <path d="M3 4.5h14v9H8l-4 3v-3H3z" />,
  extensions: <><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="11" y="3" width="6" height="6" rx="1" /><rect x="3" y="11" width="6" height="6" rx="1" /><rect x="11" y="11" width="6" height="6" rx="1" /></>,
  advanced: <path d="M3 5.5h8M14 5.5h3M3 10h3M9 10h8M3 14.5h10M16 14.5h1M11 4v3M6 8.5v3M13 13v3" />,
  about: <><circle cx="10" cy="10" r="7" /><path d="M10 9v4.5M10 6.5v.01" /></>,
};

export const SectionIcon = ({ id }: { id: SectionId }) => <svg className="settings-nav-icon" viewBox="0 0 20 20" aria-hidden="true">{SECTION_ICONS[id]}</svg>;
