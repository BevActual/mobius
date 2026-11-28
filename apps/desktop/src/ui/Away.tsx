import { createContext, useContext } from 'react';

/**
 * True while an app is kept, hidden, for the person's next visit (Notes, which is slow to make afresh): it stays in
 * the page but shows nothing outside it. Its toolbar controls and inspector panels go, its commands are not heard, and
 * it is inert, so no key or click reaches it. Everything else keeps its state for the visit back.
 */
export const AwayContext = createContext(false);

/** Whether the app this is drawn in is kept hidden for now (see `AwayContext`). */
export const useAway = (): boolean => useContext(AwayContext);
