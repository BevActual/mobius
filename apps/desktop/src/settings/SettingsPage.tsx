import { useEffect, useMemo, useRef, useState } from 'react';
import { SETTINGS, findSection, searchSettings, type SectionId } from './manifest';
import { AboutSection, AdvancedSection, AppearanceSection, BrowserSection, KeyboardSection, NotificationsSection, ModelSection, SafetySection, SessionsSection, type SectionProps } from './sections';
import { ProvidersSection } from './ProviderKeys';

type Passed = Omit<SectionProps, 'subpage' | 'highlight'>;

const VIEWS: Record<SectionId, (props: SectionProps) => React.JSX.Element> = {
  appearance: AppearanceSection,
  model: ModelSection,
  providers: ProvidersSection,
  safety: SafetySection,
  browser: BrowserSection,
  notifications: NotificationsSection,
  sessions: SessionsSection,
  keyboard: KeyboardSection,
  advanced: AdvancedSection,
  about: AboutSection,
};

export function SettingsPage({ onClose, initial, ...rest }: Passed & { onClose: () => void; initial?: SectionId }) {
  const [section, setSection] = useState<SectionId>(initial ?? 'appearance');
  const [subpage, setSubpage] = useState<string>(() => findSection(initial ?? 'appearance')?.subpages[0]?.id ?? '');
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
            <button key={item.id} type="button" className="settings-nav-item" aria-current={item.id === section && !query.trim() ? 'page' : undefined} onClick={() => openSection(item.id)}>{item.label}</button>
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
