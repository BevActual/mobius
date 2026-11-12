import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SETTINGS, findSection, searchSettings, type SectionId } from './manifest';
import { AboutSection, AdvancedSection, AppearanceSection, BrowserSection, KeyboardSection, NotificationsSection, ModelSection, SafetySection, SessionsSection, type SectionProps } from './sections';
import { ProvidersSection } from './ProviderKeys';
import { SchedulesSection } from './Schedules';
import { PageBoundary } from './PageBoundary';
import { UsageSection } from './Usage';
import { ExtensionsSettings, GeneralSection, MemorySection, PrivacySection, VoiceSection, VoiceModelRows } from './Voice';
import '../settings.css';

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
  notifications: NotificationsSection,
  sessions: SessionsSection,
  keyboard: KeyboardSection,
  usage: UsageSection,
  advanced: AdvancedSection,
  about: AboutSection,
};

/** The glyph drawn for each section in the list (12 by 12). */
const SECTION_GLYPHS: Record<string, string> = {
  general: 'M6 3.8a2.2 2.2 0 1 0 0.01 0M6 1v1.5M6 9.5V11M1 6h1.5M9.5 6H11M2.5 2.5l1 1M8.5 8.5l1 1M2.5 9.5l1-1M8.5 3.5l1-1',
  voice: 'M2 5v2M4 3.5v5M6 2v8M8 3.5v5M10 5v2',
  memory: 'M3.5 2h5a1 1 0 0 1 1 1v7L6 8l-3.5 2V3a1 1 0 0 1 1-1z',
  privacy: 'M3.5 5.5V4a2.5 2.5 0 0 1 5 0v1.5M2.5 5.5h7v5h-7z',
  extensions: 'M2 4h2.5a1 1 0 1 1 2 0H9v2.5a1 1 0 1 1 0 2V10H2z',
  appearance: 'M6 1.5a4.5 4.5 0 1 0 0.01 0M6 1.5v9',
  model: 'M2 9l3-3 2 2 3-4',
  providers: 'M4 6h4M3 4a2 2 0 1 0 0 4M9 4a2 2 0 1 1 0 4',
  safety: 'M6 1.5 10 3v3c0 2.5-1.8 4-4 4.5C3.8 10 2 8.5 2 6V3z',
  browser: 'M6 1.5a4.5 4.5 0 1 0 0.01 0M1.5 6h9M6 1.5c-2 2.5-2 6.5 0 9M6 1.5c2 2.5 2 6.5 0 9',
  schedules: 'M6 1.5a4.5 4.5 0 1 0 0.01 0M6 3.5V6l1.8 1.2',
  notifications: 'M3 8.5V5.5a3 3 0 0 1 6 0v3l1 1H2zM5 10.5h2',
  sessions: 'M2 3h8v5H5l-2 2V8H2z',
  keyboard: 'M1.5 3.5h9v5h-9zM3.5 5.5h1M5.5 5.5h1M7.5 5.5h1M4 7h4',
  usage: 'M2 10V7M4.7 10V4.5M7.3 10V6M10 10V2.5',
  advanced: 'M2 3l3 3-3 3M6 9h4',
  about: 'M6 1.5a4.5 4.5 0 1 0 0.01 0M6 5.5v3M6 3.6v0.1',
};

/** The tint of each section's icon, as in System Settings: one colour per section, so the eye finds it again. */
const SECTION_TINTS: Record<string, string> = {
  general: '#8e8e93', appearance: '#007aff', notifications: '#ff3b30', keyboard: '#8e8e93',
  providers: '#00c7be', model: '#5856d6', voice: '#ff2d55',
  safety: '#ff9f0a', memory: '#a2845e', privacy: '#1f6feb',
  browser: '#30b0c7', sessions: '#af52de', schedules: '#34c759', extensions: '#7d7aff',
  usage: '#ff9500', advanced: '#3a3a3c', about: '#636366',
};

function SectionIcon({ id, className }: { id: string; className: string }) {
  return (
    <svg className={className} viewBox="0 0 12 12" aria-hidden="true" style={{ background: SECTION_TINTS[id] ?? '#8e8e93' }}>
      <path d={SECTION_GLYPHS[id] ?? 'M6 1.5a4.5 4.5 0 1 0 0.01 0'} />
    </svg>
  );
}

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
  const nav = (
    <nav className="settings-nav" aria-label="Settings sections">
      {/* As in System Settings: search at the top of the sidebar, then the sections under their headings. */}
      <input type="search" role="searchbox" className="settings-search" aria-label="Search settings" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} />
      {[...new Set(SETTINGS.map((item) => item.group ?? ''))].map((group) => (
        <div key={group} className="settings-nav-group" role="group" aria-label={group}>
          {group && <h2 className="settings-nav-heading">{group}</h2>}
          {SETTINGS.filter((item) => (item.group ?? '') === group).map((item) => (
            <button key={item.id} type="button" className="settings-nav-item" data-section={item.id} aria-current={item.id === section && !query.trim() ? 'page' : undefined} onClick={() => openSection(item.id)}>
              {/* A coloured glyph per section, as in System Settings and the Settings board. */}
              <SectionIcon id={item.id} className="settings-nav-icon" />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );

  useEffect(() => {
    (sidebar ?? root.current)?.querySelector<HTMLElement>('[role="searchbox"], input[type="search"]')?.focus();
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
                {/* As the head of a System Settings pane: the section's icon, its name and one line on what it is for. */}
                <header className="settings-hero" data-section={current.id}>
                  <SectionIcon id={current.id} className="settings-hero-icon" />
                  <h2 className="settings-section-title">{current.label}</h2>
                  <p className="settings-section-desc">{current.description}</p>
                </header>
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
