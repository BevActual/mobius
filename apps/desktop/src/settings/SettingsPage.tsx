import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SETTINGS, findSection, searchSettings, type SectionId } from './manifest';
import { AboutSection, AdvancedSection, AppearanceSection, BrowserSection, KeyboardSection, NotificationsSection, ModelSection, SafetySection, SessionsSection, type SectionProps } from './sections';
import { ProvidersSection } from './ProviderKeys';
import { SchedulesSection } from './Schedules';
import { PageBoundary } from './PageBoundary';
import { UsageSection } from './Usage';
import { ExtensionsSettings, GeneralSection, MemorySection, PrivacySection, VoiceSection, VoiceModelRows } from './Voice';
import { AppSidebar, SidebarRow, SidebarSearch, SidebarSection } from '../ui';
import '../settings.css';
import { MailAccountsSettings } from '../MailAccounts';

type Passed = Omit<SectionProps, 'subpage' | 'highlight'>;

const VIEWS: Record<SectionId, (props: SectionProps) => React.JSX.Element> = {
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
  notifications: NotificationsSection,
  sessions: SessionsSection,
  keyboard: KeyboardSection,
  usage: UsageSection,
  advanced: AdvancedSection,
  about: AboutSection,
};

export function SettingsPage({ onClose, initial, initialSubpage, sidebar = null, onTitle, ...rest }: Passed & { onClose: () => void; initial?: SectionId; initialSubpage?: string; /** The app's sidebar: Settings' search and sections go there, as an app's own list does. */ sidebar?: HTMLElement | null; /** The page's name, for the window's title row. */ onTitle?: (title: string) => void }) {
  const [section, setSection] = useState<SectionId>(initial ?? 'general');
  const [subpage, setSubpage] = useState<string>(() => initialSubpage ?? findSection(initial ?? 'general')?.subpages[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const current = findSection(section);
  const hits = useMemo(() => searchSettings(query), [query]);
  const View = VIEWS[section];
  useEffect(() => { onTitle?.(query.trim() ? 'Search' : current?.label ?? 'Settings'); }, [onTitle, query, current?.label]);
  // The app sidebar (zone 2), from the shared pieces: search, then the sections under their headings, as in System Settings.
  const nav = (
    <AppSidebar label="Settings sidebar">
      <SidebarSearch label="Search settings" value={query} onChange={setQuery} />
      <nav className="settings-nav" aria-label="Settings sections">
        {[...new Set(SETTINGS.map((item) => item.group ?? ''))].map((group) => (
          <SidebarSection key={group} title={group}>
            {SETTINGS.filter((item) => (item.group ?? '') === group).map((item) => (
              <SidebarRow key={item.id} label={item.label} current={item.id === section && !query.trim()} onSelect={() => openSection(item.id)} />
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
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    if (!highlight) return;
    root.current?.querySelector(`[data-setting$=".${highlight}"]`)?.scrollIntoView({ block: 'center' });
  }, [highlight, section, subpage]);

  const openSection = (id: SectionId) => {
    setSection(id);
    setSubpage(findSection(id)?.subpages[0]?.id ?? '');
    setHighlight(null);
    setQuery('');
  };

  return (
    <section ref={root} className="settings-page" role="region" aria-label="Settings">
      <div className="settings-body">
        {sidebar ? createPortal(nav, sidebar) : nav}
        <div className="settings-content">
          <div className="settings-column">
          {query.trim() ? (
            hits.length === 0 ? (
              <p className="srow-empty">No settings match “{query.trim()}”.</p>
            ) : (
              <ul className="slist" aria-label="Search results">
                {hits.map((hit) => (
                  <li key={`${hit.section}.${hit.subpage}.${hit.row}`}>
                    <button type="button" className="hit" onClick={() => { setSection(hit.section); setSubpage(hit.subpage); setHighlight(hit.row); setQuery(''); }}>
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
                {/* The toolbar names the page; the page opens on one quiet line on what it is for, as Mail's toolbar subline. */}
                <h2 className="sr-only">{current.label}</h2>
                <p className="settings-lede">{current.description}</p>
                {current.subpages.length > 1 && (
                  <div className="settings-tabs" role="tablist" aria-label={`${current.label} pages`}>
                    {current.subpages.map((page) => (
                      <button key={page.id} type="button" role="tab" aria-selected={page.id === subpage} className="settings-tab" onClick={() => { setSubpage(page.id); setHighlight(null); }}>{page.label}</button>
                    ))}
                  </div>
                )}
                <div className="settings-card"><PageBoundary key={`${section}.${subpage}`}><View subpage={subpage} highlight={highlight} {...rest} /></PageBoundary></div>
              </>
            )
          )}
          </div>
        </div>
      </div>
    </section>
  );
}
