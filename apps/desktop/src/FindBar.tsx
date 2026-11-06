import { useEffect, useRef, useState } from 'react';
import type { FindResult } from '@mobius/shared';

interface Props {
  tabId: string;
  /** Changes each time Ctrl+F is pressed, to put the cursor back in the box. */
  focusToken: number;
  onClose: () => void;
}

/** Search the page in the current tab. It lives in the strip because the page itself is drawn above the window. */
export function FindBar({ tabId, focusToken, onClose }: Props) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<FindResult | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusToken]);
  useEffect(() => window.mobius.browser.onFound((found) => { if (found.tabId === tabId) setResult(found); }), [tabId]);
  // Closing, or moving to another tab, clears the highlights.
  useEffect(() => () => window.mobius.browser.stopFind(tabId), [tabId]);

  const search = (value: string, forward = true, again = false) => {
    if (value === '') {
      window.mobius.browser.stopFind(tabId);
      setResult(null);
    } else {
      window.mobius.browser.find({ tabId, text: value, forward, again });
    }
  };
  const label = text === '' ? '' : result === null ? '' : result.matches === 0 ? 'No matches' : `${result.active} of ${result.matches}`;

  return (
    <div className="findbar" role="search" aria-label="Find in page">
      <input
        ref={input}
        type="text"
        aria-label="Find in page"
        placeholder="Find in page"
        value={text}
        maxLength={200}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => { setText(event.target.value); search(event.target.value); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); search(text, !event.shiftKey, true); }
          else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
        }}
      />
      <span className="findbar-count" role="status" aria-live="polite">{label}</span>
      <button type="button" className="strip-btn" aria-label="Previous match" disabled={!result?.matches} onClick={() => search(text, false, true)}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 12 5-5 5 5" /></svg>
      </button>
      <button type="button" className="strip-btn" aria-label="Next match" disabled={!result?.matches} onClick={() => search(text, true, true)}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 8 5 5 5-5" /></svg>
      </button>
      <button type="button" className="strip-btn" aria-label="Close find" onClick={onClose}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg>
      </button>
    </div>
  );
}
