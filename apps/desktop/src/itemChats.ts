import { useEffect, useRef } from 'react';
import { MAIN_BOT_ID, conversationIdFor } from '@mobius/shared';
import type { Here } from './surface';

/**
 * Chats live on the things they are about (Andrew, 26 November 2026): each note, document, sheet or task list keeps
 * its own chat with Mobius, found again by opening that thing; the panel keeps one general chat for everything else;
 * All chats, here and in Home, lists them all, each with what it is about.
 *
 * Which chat belongs to which item is kept on this computer, by the item's key (`Here.key`).
 */
export interface ItemChats { items: Record<string, { id: string; label: string }>; general?: string }

const KEY = 'mobius.item-chats';
/** Said on `window` when which chat belongs to which item changes, so what names a chat by its item can redraw. */
export const ITEM_CHATS_EVENT = 'mobius:item-chats';
const MAX = 400;

export function readItemChats(): ItemChats {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Partial<ItemChats>;
    const items: ItemChats['items'] = {};
    for (const [k, c] of Object.entries(v.items ?? {})) if (c && typeof c.id === 'string' && typeof c.label === 'string') items[k] = { id: c.id, label: c.label };
    return { items, ...(typeof v.general === 'string' ? { general: v.general } : {}) };
  } catch { return { items: {} }; }
}
function writeItemChats(chats: ItemChats): void {
  const keys = Object.keys(chats.items);
  const items = keys.length > MAX ? Object.fromEntries(keys.slice(-MAX).map((k) => [k, chats.items[k]!])) : chats.items;
  const text = JSON.stringify({ ...chats, items });
  try {
    if (window.localStorage.getItem(KEY) === text) return;
    window.localStorage.setItem(KEY, text);
  } catch { /* Not remembered. */ }
  window.dispatchEvent(new Event(ITEM_CHATS_EVENT));
}

/** What a chat is about, for All chats: the item's name, or null for the general chat and older chats. */
export function itemOfChat(chats: ItemChats, id: string): string | null {
  return Object.values(chats.items).find((c) => c.id === id)?.label ?? null;
}
const bound = (chats: ItemChats, id: string) => chats.general === id || Object.values(chats.items).some((c) => c.id === id);

/**
 * Which chat to show for where the person is now, and what to remember: the item's own chat (a new one if it has none;
 * the open chat itself when that is empty and not yet anyone's), or away from any item the open chat, which becomes the
 * general one, unless it is an item's (then the general one).
 */
export function chatForPlace(chats: ItemChats, here: { key: string; label: string } | null, open: { id: string; empty: boolean }, fresh: () => string): { id: string; chats: ItemChats } {
  const reuse = open.empty && !bound(chats, open.id);
  if (here) {
    const known = chats.items[here.key];
    if (known) return { id: known.id, chats: known.label === here.label ? chats : { ...chats, items: { ...chats.items, [here.key]: { id: known.id, label: here.label } } } };
    const id = reuse ? open.id : fresh();
    return { id, chats: { ...chats, items: { ...chats.items, [here.key]: { id, label: here.label } } } };
  }
  // Away from any item: the open chat stays, unless it is an item's, and becomes the general one (a chat the person
  // started or picked, or the one restored at start, is not swapped for an older one); from an item's chat, the general one.
  const onItem = Object.values(chats.items).some((c) => c.id === open.id);
  if (onItem) return chats.general ? { id: chats.general, chats } : (() => { const id = fresh(); return { id, chats: { ...chats, general: id } }; })();
  return { id: open.id, chats: chats.general === open.id ? chats : { ...chats, general: open.id } };
}

/** The item's own chat, made (and remembered) if it has none: for asking about it from elsewhere (the Ask card). */
export function itemChatFor(here: { key: string; label: string }): string {
  const next = chatForPlace(readItemChats(), here, { id: '', empty: false }, () => conversationIdFor(MAIN_BOT_ID, crypto.randomUUID()));
  writeItemChats(next.chats);
  return next.id;
}

/** How long the person stays on a place before its chat is shown: flicking through apps moves no chat, and the app's
 * own loading comes first (each move reads a chat's history and what its last turn changed from the core). */
export const SETTLE_MS = 300;

/**
 * Follows the person from item to item: opening a note shows its chat, leaving it for a place with no item shows the
 * general chat, once the person has stayed there a moment. Never while Mobius is working in the open chat (it may be
 * opening things itself), while what it changed waits for Keep or is still being read (the person is likely going to
 * look at it), once the person has used the open chat since arriving, and not in the Agent app, where the chat is the
 * page and the person picks it.
 */
export function useItemChats(here: Here | null, on: boolean, open: { id: string; empty: boolean; count: number; busy: boolean; waiting: boolean }, reading: { current: boolean }, select: (id: string) => void): void {
  const now = useRef(open);
  now.current = open;
  const key = on ? (here ? `item:${here.key}` : 'general') : null;
  const label = useRef('');
  label.current = here?.label ?? '';
  useEffect(() => {
    if (!key) return;
    const arrived = { id: now.current.id, count: now.current.count };
    let timer = 0;
    let tries = 0;
    const move = () => {
      const o = now.current;
      if (o.busy || o.waiting || o.id !== arrived.id || o.count !== arrived.count) return;
      if (reading.current && ++tries < 20) { timer = window.setTimeout(move, 100); return; }
      const place = key === 'general' ? null : { key: key.slice(5), label: label.current };
      const next = chatForPlace(readItemChats(), place, o, () => conversationIdFor(MAIN_BOT_ID, crypto.randomUUID()));
      writeItemChats(next.chats);
      if (next.id !== o.id) select(next.id);
    };
    timer = window.setTimeout(move, SETTLE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a change of place moves the chat.
  }, [key]);
}
