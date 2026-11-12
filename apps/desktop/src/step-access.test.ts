import { describe, expect, it } from 'vitest';
import { appOfStep, stepTag } from './step-access';

const ask = { browser: 'follow', notes: 'follow', tasks: 'follow' } as const;

describe('plan step tags', () => {
  it('finds the app a step names', () => {
    expect(appOfStep('Compare 3 walkable hotels in Browser')).toBe('browser');
    expect(appOfStep('Build the budget page in Notes')).toBe('notes');
    expect(appOfStep('Add a reminder for the deposit')).toBe('tasks');
    expect(appOfStep('Block an hour in my calendar for the slides')).toBe('calendar');
    expect(appOfStep('Think it over')).toBeNull();
  });
  it('says what the settings mean for that app', () => {
    expect(stepTag('Open the site', ask, 'manual')).toEqual({ app: 'Browser', tag: 'Asks first' });
    expect(stepTag('Open the site', ask, 'smart')?.tag).toBe('Asks if unsure');
    expect(stepTag('Open the site', ask, 'off')?.tag).toBe('Acts');
    expect(stepTag('Add a task', { ...ask, tasks: 'always' }, 'propose')?.tag).toBe('Asks first');
    expect(stepTag('Write the note', { ...ask, notes: 'off' }, 'off')?.tag).toBe('Off');
    expect(stepTag('Add the dentist appointment', ask, 'manual'), 'settings from before Calendar follow the mode').toEqual({ app: 'Calendar', tag: 'Asks first' });
    expect(stepTag('Add the dentist appointment', { ...ask, calendar: 'always' }, 'smart')?.tag).toBe('Asks first');
    expect(stepTag('Write the note', ask, 'propose')?.tag).toBe('Proposes');
    expect(stepTag('Open the site', ask, 'propose')?.tag).toBe('Asks first');
    expect(stepTag('Think', ask, 'manual')).toBeNull();
  });
});
