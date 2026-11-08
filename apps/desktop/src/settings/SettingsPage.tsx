import { useEffect, useMemo, useRef, useState } from 'react';
import { SETTINGS, findSection, searchSettings, type SectionId } from './manifest';
import { AboutSection, AdvancedSection, AppearanceSection, BrowserSection, KeyboardSection, NotificationsSection, ModelSection, SafetySection, SessionsSection, type SectionProps } from './sections';
import { ProvidersSection } from './ProviderKeys';
import { SchedulesSection } from './Schedules';

type Passed = Omit<SectionProps, 'subpage' | 'highlight'>;

const VIEWS: Record<SectionId, (props: SectionProps) => React.JSX.Element> = {
  appearance: AppearanceSection,
  model: ModelSection,
  providers: ProvidersSection,
  safety: SafetySection,
  schedules: SchedulesSection,
  browser: BrowserSection,
  notifications: NotificationsSection,
  sessions: SessionsSection,
  keyboard: KeyboardSection,
  advanced: AdvancedSection,
  about: AboutSection,
};

/** The glyph drawn for each section in the list (12 by 12). */
const SECTION_GLYPHS: Record<string, string> = {
  appearance: 'M6 1.5a4.5 4.5 0 1 0 0.01 0M6 1.5v9',
  model: 'M2 9l3-3 2 2 3-4',
  providers: 'M4 6h4M3 4a2 2 0 1 0 0 4M9 4a2 2 0 1 1 0 4',
  safety: 'M6 1.5 10 3v3c0 2.5-1.8 4-4 4.5C3.8 10 2 8.5 2 6V3z',
  browser: 'M6 1.5a4.5 4.5 0 1 0 0.01 0M1.5 6h9M6 1.5c-2 2.5-2 6.5 0 9M6 1.5c2 2.5 2 6.5 0 9',
  schedules: 'M6 1.5a4.5 4.5 0 1 0 0.01 0M6 3.5V6l1.8 1.2',
  notifications: 'M3 8.5V5.5a3 3 0 0 1 6 0v3l1 1H2zM5 10.5h2',
  sessions: 'M2 3h8v5H5l-2 2V8H2z',
  keyboard: 'M1.5 3.5h9v5h-9zM3.5 5.5h1M5.5 5.5h1M7.5 5.5h1M4 7h4',
  advanced: 'M2 3l3 3-3 3M6 9h4',
  about: 'M6 1.5a4.5 4.5 0 1 0 0.01 0M6 5.5v3M6 3.6v0.1',
};

export function SettingsPage({ onClose, initial, initialSubpage, ...rest }: Passed & { onClose: () => void; initial?: SectionId; initialSubpage?: string }) {
  const [section, setSection] = useState<SectionId>(initial ?? 'appearance');
  const [subpage, setSubpage] = useState<string>(() => initialSubpage ?? findSection(initial ?? 'appearance')?.subpages[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const current = findSection(section);
  const hits = useMemo(() => searchSettings(query), [query]);
  const View = VIEWS[section];

  useEffect(() => {
    root.current?.querySelector<HTMLElement>('[role="searchbox"], input[type="search"]')?.focus();
  }, []);
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
      <header className="settings-head">
        <h1>Settings</h1>
        <input type="search" role="searchbox" className="settings-search" aria-label="Search settings" placeholder="Search settings" value={query} onChange={(event) => setQuery(event.target.value)} />
        <button type="button" className="btn" aria-label="Close settings" onClick={onClose}>Done</button>
      </header>
      <div className="settings-body">
        <nav className="settings-nav" aria-label="Settings sections">
          {SETTINGS.map((item) => (
            <button key={item.id} type="button" className="settings-nav-item" data-section={item.id} aria-current={item.id === section && !query.trim() ? 'page' : undefined} onClick={() => openSection(item.id)}>
              {/* A coloured glyph per section, as in System Settings and the Settings board. */}
              <svg className="settings-nav-icon" viewBox="0 0 12 12" aria-hidden="true"><path d={SECTION_GLYPHS[item.id] ?? 'M6 1.5a4.5 4.5 0 1 0 0.01 0'} /></svg>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="settings-content">
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
                <h2 className="settings-section-title">{current.label}</h2>
                <p className="settings-section-desc">{current.description}</p>
                {current.subpages.length > 1 && (
                  <div className="settings-tabs" role="tablist" aria-label={`${current.label} pages`}>
                    {current.subpages.map((page) => (
                      <button key={page.id} type="button" role="tab" aria-selected={page.id === subpage} className="settings-tab" onClick={() => { setSubpage(page.id); setHighlight(null); }}>{page.label}</button>
                    ))}
                  </div>
                )}
                <View subpage={subpage} highlight={highlight} {...rest} />
              </>
            )
          )}
        </div>
      </div>
    </section>
  );
}
