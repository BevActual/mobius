import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SETTINGS, findSection, searchSettings, type SectionId } from './manifest';
import { AboutSection, AdvancedSection, AppearanceSection, BrowserSection, KeyboardSection, NotificationsSection, ModelSection, SafetySection, SessionsSection, type SectionProps } from './sections';
import { ProvidersSection } from './ProviderKeys';
import { SchedulesSection } from './Schedules';
import { PageBoundary } from './PageBoundary';
import { UsageSection } from './Usage';
import { ExtensionsSettings, GeneralSection, MemorySection, PrivacySection, VoiceSection, VoiceModelRows } from './Voice';
import { AppSidebar, KeyCaps, SidebarRow, SidebarSection } from '../ui';
import { SectionIcon } from './icons';
import '../settings.css';
import { MailAccountsSettings } from '../MailAccounts';
import { ConnectionsList } from './AccountsPage';
import { CalendarAccountsSettings } from '../CalendarAccounts';
import { MessagesAccountsSettings } from '../MessagesAccounts';

type Passed = Omit<SectionProps, 'subpage' | 'highlight'>;

const VIEWS: Record<SectionId, (props: SectionProps) => React.JSX.Element> = {
  connections: ({ onGo, onOpenApp }) => <ConnectionsList onGo={onGo ?? (() => {})} {...(onOpenApp ? { onOpenApp } : {})} />,
  general: GeneralSection,
  voice: VoiceSection,
  memory: MemorySection,
  privacy: PrivacySection,
  extensions: ExtensionsSettings,
  appearance: AppearanceSection,
  // Models by task: chat, second and quick models, then who listens and who speaks.
  model: (props) => <><ModelSection {...props} />{props.subpage !== 'local' && <VoiceModelRows {...props} />}</>,
  providers: ProvidersSection,
  safety: SafetySection,
  schedules: SchedulesSection,
  browser: BrowserSection,
  // Mail's accounts (from the Mail app).
  mail: ({ highlight }) => <MailAccountsSettings highlight={highlight === 'mail-accounts'} />,
  // Calendar's accounts (from the Calendar app).
  calendar: ({ highlight }) => <CalendarAccountsSettings highlight={highlight === 'calendar-accounts'} />,
  // Messages' accounts (from the Messages app).
  messages: ({ highlight }) => <MessagesAccountsSettings highlight={highlight === 'messages-accounts'} />,
  notifications: NotificationsSection,
  sessions: SessionsSection,
  keyboard: KeyboardSection,
  usage: UsageSection,
  advanced: AdvancedSection,
  about: AboutSection,
};

export function SettingsPage({ onClose, initial, initialSubpage, sidebar = null, ownsNav = false, onTitle, ...rest }: Passed & { onClose: () => void; initial?: SectionId; initialSubpage?: string; /** The app's sidebar: Settings' search and sections go there, as an app's own list does. */ sidebar?: HTMLElement | null; /** The sections are a panel of their own: while it is hidden, they are not drawn in the page. */ ownsNav?: boolean; /** The page's name, for the window's title row. */ onTitle?: (title: string) => void }) {
  const [section, setSection] = useState<SectionId>(initial ?? 'general');
  const [subpage, setSubpage] = useState<string>(() => initialSubpage ?? findSection(initial ?? 'general')?.subpages[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState<string | null>(null);
  // Bumped on every move to a page, so the page is scrolled to even when it is the one already open.
  const [moved, setMoved] = useState(0);
  const root = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const results = useRef<HTMLUListElement>(null);
  const current = findSection(section);
  const hits = useMemo(() => searchSettings(query), [query]);
  const View = VIEWS[section];
  useEffect(() => { onTitle?.(query.trim() ? 'Search' : current?.label ?? 'Settings'); }, [onTitle, query, current?.label]);
  // The app sidebar (zone 2), from the shared pieces: search, then the sections under their headings, as in System Settings.
  const nav = (
    <AppSidebar label="Sections">
      <label className="settings-search">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM10.3 10.3 13.5 13.5" /></svg>
        <input type="search" aria-label="Search settings" title="Search settings (Ctrl+F)" placeholder="Search settings" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => {
          if (e.key === 'Escape' && query) { e.preventDefault(); e.stopPropagation(); setQuery(''); }
          else if (e.key === 'Enter' && hits[0]) go(hits[0].section, hits[0].subpage, hits[0].row);
          // Down goes into the results, as in System Settings' search.
          else if (e.key === 'ArrowDown' && hits[0]) { e.preventDefault(); results.current?.querySelector<HTMLElement>('button')?.focus(); }
        }} />
        {!query && <span aria-hidden="true"><KeyCaps keys="Ctrl+F" /></span>}
      </label>
      <nav className="settings-nav" aria-label="Settings sections">
        {[...new Set(SETTINGS.map((item) => item.group ?? ''))].map((group) => (
          <SidebarSection key={group} title={group}>
            {SETTINGS.filter((item) => (item.group ?? '') === group).map((item) => (
              <SidebarRow key={item.id} icon={<SectionIcon id={item.id} />} label={item.label} current={item.id === section && !query.trim()} onSelect={() => openSection(item.id)} />
            ))}
          </SidebarSection>
        ))}
      </nav>
    </AppSidebar>
  );

  useEffect(() => {
    (sidebar ?? root.current)?.querySelector<HTMLElement>('input[type="search"]')?.focus();
  }, [sidebar]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
      // Ctrl+F finds a setting, as in every settings window.
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.code === 'KeyF') { event.preventDefault(); (sidebar ?? root.current)?.querySelector<HTMLElement>('input[type="search"]')?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, sidebar]);
  // Each move lands where it was going: the setting a search found, the page asked for (Appearance's Layout from the
  // View menu), or the top of the section, not wherever the last section had been scrolled to.
  useEffect(() => {
    const row = highlight && root.current?.querySelector(`[data-setting$=".${highlight}"]`);
    const first = findSection(section)?.subpages[0]?.id;
    const page = subpage && subpage !== first && root.current?.querySelector(`[data-subpage="${subpage}"]`);
    if (row) row.scrollIntoView({ block: 'center' });
    else if (page) page.scrollIntoView({ block: 'start' });
    else content.current?.scrollTo?.({ top: 0 });
  }, [moved]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Opens a section, at one of its pages and one of its settings when given. */
  const go = (id: SectionId, sub?: string, row?: string) => {
    setSection(id);
    setSubpage(sub ?? findSection(id)?.subpages[0]?.id ?? '');
    setHighlight(row ?? null);
    setQuery('');
    setMoved((n) => n + 1);
  };
  const openSection = (id: SectionId) => go(id);
  // Opened again at another section while it is open (Help › Keyboard Shortcuts, View › Layout), it goes there.
  const asked = useRef(`${initial ?? ''}.${initialSubpage ?? ''}`);
  useEffect(() => {
    const now = `${initial ?? ''}.${initialSubpage ?? ''}`;
    if (now === asked.current) return;
    asked.current = now;
    if (initial) go(initial, initialSubpage);
  }, [initial, initialSubpage]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Up and down move through the search results; up from the first goes back to the search field. */
  const stepResults = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = [...(results.current?.querySelectorAll<HTMLElement>('button.hit') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    const next = buttons[at + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) next.focus();
    else if (e.key === 'ArrowUp') (sidebar ?? root.current)?.querySelector<HTMLElement>('input[type="search"]')?.focus();
  };

  return (
    <section ref={root} className="settings-page" role="region" aria-label="Settings">
      <div className="settings-body">
        {sidebar ? createPortal(nav, sidebar) : ownsNav ? null : nav}
        <div ref={content} className="settings-content">
          <div className="settings-column">
          {query.trim() ? (
            hits.length === 0 ? (
              <p className="srow-empty">No settings match “{query.trim()}”.</p>
            ) : (
              <ul ref={results} className="slist" aria-label="Search results" onKeyDown={stepResults}>
                {hits.map((hit) => (
                  <li key={`${hit.section}.${hit.subpage}.${hit.row}`}>
                    <button type="button" className="hit" onClick={() => go(hit.section, hit.subpage, hit.row)}>
                      <span className="hit-title">{hit.label}</span>
                      <span className="hit-where">{hit.where}</span>
                      <span className="hit-desc">{hit.description}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            current && (
              <>
                {/* Where it is (its group › its name), the name, one quiet line on what it is for, then each of its pages
                    as a group: a small grey heading over one rounded card of rows, as in System Settings and Linear. */}
                <p className="settings-crumb">{current.group ? `${current.group} › ${current.label}` : current.label}</p>
                <h2 className="settings-heading">{current.label}</h2>
                <p className="settings-lede">{current.description}</p>
                {current.subpages.map((page) => (
                  <section key={page.id} className="settings-group" aria-label={page.label} data-subpage={page.id}>
                    {(current.subpages.length > 1 || page.label !== current.label) && !(page.rows.length === 1 && page.rows[0]!.label === page.label) && <h3 className="settings-group-title">{page.label}</h3>}
                    <div className="settings-card"><PageBoundary key={`${section}.${page.id}`}><View subpage={page.id} highlight={highlight} onGo={(id, sub) => go(id, sub)} {...rest} /></PageBoundary></div>
                  </section>
                ))}
              </>
            )
          )}
          </div>
        </div>
      </div>
    </section>
  );
}
