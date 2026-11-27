import { describe, expect, it } from 'vitest';
import { chatForPlace, itemOfChat, type ItemChats } from './itemChats';

let n = 0;
const fresh = () => `main-${++n}`;
const trip = { key: 'note:notes/Trip.md', label: 'Trip' };

describe('chats that live on items', () => {
  it('an item with no chat takes the open one when it is empty and nobody’s, and is found again', () => {
    const first = chatForPlace({ items: {} }, trip, { id: 'c0', empty: true }, fresh);
    expect(first.id).toBe('c0');
    expect(itemOfChat(first.chats, 'c0')).toBe('Trip');
    expect(chatForPlace(first.chats, trip, { id: 'other', empty: false }, fresh).id).toBe('c0');
  });
  it('an item with no chat gets a new one when the open chat has words or is another’s', () => {
    expect(chatForPlace({ items: {} }, trip, { id: 'c0', empty: false }, fresh).id).toMatch(/^main-/);
    const general: ItemChats = { items: {}, general: 'g' };
    expect(chatForPlace(general, trip, { id: 'g', empty: true }, fresh).id).not.toBe('g');
  });
  it('away from any item, the general chat: the open one, unless it is an item’s', () => {
    const once = chatForPlace({ items: {} }, null, { id: 'c0', empty: false }, fresh);
    expect(once).toEqual({ id: 'c0', chats: { items: {}, general: 'c0' } });
    const onItem: ItemChats = { items: { [trip.key]: { id: 't', label: 'Trip' } } };
    const away = chatForPlace(onItem, null, { id: 't', empty: false }, fresh);
    expect(away.id).not.toBe('t');
    expect(away.chats.general).toBe(away.id);
    expect(chatForPlace(away.chats, null, { id: 't', empty: false }, fresh).id).toBe(away.id);
  });
  it('away from any item, a chat the person started or picked stays open and becomes the general one', () => {
    const next = chatForPlace({ items: {}, general: 'old' }, null, { id: 'new', empty: false }, fresh);
    expect(next).toEqual({ id: 'new', chats: { items: {}, general: 'new' } });
  });
  it('a renamed item keeps its chat under its new name', () => {
    const chats: ItemChats = { items: { [trip.key]: { id: 't', label: 'Trip' } } };
    const next = chatForPlace(chats, { key: trip.key, label: 'Trip to Hydra' }, { id: 'x', empty: false }, fresh);
    expect(next.id).toBe('t');
    expect(itemOfChat(next.chats, 't')).toBe('Trip to Hydra');
  });
});
