// The home page's one bit of script: the tabs that follow a quote from app to app. Without it, every picture shows
// one under the other. Nothing is loaded or sent anywhere. (The page's head marks <html> with "js" before it paints.)
document.documentElement.classList.add('js');

for (const list of document.querySelectorAll('[role="tablist"]')) {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const select = (tab, focus) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    }
    if (focus) tab.focus();
    // On a phone the tabs are one row that scrolls sideways: bring the chosen one into view.
    if (list.scrollWidth > list.clientWidth) list.scrollTo({ left: tab.offsetLeft - list.offsetLeft - 16, behavior: 'smooth' });
  };
  select(tabs.find((t) => t.getAttribute('aria-selected') === 'true') || tabs[0], false);
  list.addEventListener('click', (e) => {
    const tab = e.target.closest('[role="tab"]');
    if (tab) select(tab, false);
  });
  list.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (step) { e.preventDefault(); select(tabs[(i + step + tabs.length) % tabs.length], true); }
    else if (e.key === 'Home') { e.preventDefault(); select(tabs[0], true); }
    else if (e.key === 'End') { e.preventDefault(); select(tabs[tabs.length - 1], true); }
  });
}
