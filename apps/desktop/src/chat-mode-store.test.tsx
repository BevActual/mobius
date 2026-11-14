import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { resetChatModeForTests, setChatMode, useChatMode } from './chat-mode';

function Probe({ app }: { app?: string }) {
  const [mode] = useChatMode(app);
  return <i>{mode}</i>;
}

describe('the composer mode an app can read and set', () => {
  afterEach(() => resetChatModeForTests());
  it('starts on Agent and follows a mode set from anywhere', () => {
    expect(renderToStaticMarkup(<Probe />)).toBe('<i>agent</i>');
    setChatMode('triage');
    expect(renderToStaticMarkup(<Probe />)).toBe('<i>triage</i>');
  });
  it('reads another app’s own mode as Agent, so Mail sees Triage only while it is on', () => {
    setChatMode('triage');
    expect(renderToStaticMarkup(<Probe app="mail" />)).toBe('<i>triage</i>');
    expect(renderToStaticMarkup(<Probe app="calendar" />)).toBe('<i>agent</i>');
  });
  it('ignores a mode that does not exist', () => {
    setChatMode('plan');
    setChatMode('nonsense' as never);
    expect(renderToStaticMarkup(<Probe />)).toBe('<i>plan</i>');
  });
});
