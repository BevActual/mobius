import { describe, expect, it } from 'vitest';
import { findSystemApps, findSystemCommands } from './launcher-system';

const apps = [{ name: 'Adobe Photoshop 2026', id: 'a' }, { name: 'Photos', id: 'b' }, { name: 'Spotify', id: 'c' }, { name: 'Visual Studio Code', id: 'd' }];
describe('the computer in the launcher', () => {
  it('finds apps by name, those starting with the words first', () => {
    expect(findSystemApps(apps, 'photo').map((a) => a.id)).toEqual(['b', 'a']);
    expect(findSystemApps(apps, 'code').map((a) => a.id)).toEqual(['d']);
    expect(findSystemApps(apps, '')).toEqual([]);
  });
  it('finds lock, sleep and the bin by short words too', () => {
    const commands = [{ id: 'lock', name: 'Lock the computer' }, { id: 'sleep', name: 'Put the computer to sleep' }, { id: 'empty-bin', name: 'Empty the Recycle Bin' }];
    expect(findSystemCommands(commands, 'trash').map((c) => c.id)).toEqual(['empty-bin']);
    expect(findSystemCommands(commands, 'computer').map((c) => c.id)).toEqual(['lock', 'sleep']);
    expect(findSystemCommands(commands, 'l')).toEqual([]);
  });
});
