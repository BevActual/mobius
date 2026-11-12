# ADR 0008: Shared controls on Base UI, styled with tokens

Status: accepted (2026-11-12).

## Context

Each app drew its own menus, dialogs, radio groups and switches. On main there were about ten hand-drawn menus,
thirteen dialogs and twelve radio groups, each with its own keyboard handling, focus rules and placement, and the
style sheets held hundreds of raw colour values outside `tokens.css`. They behaved slightly differently from app to app,
and each fix had to be repeated.

## Decision

1. **Behaviour comes from [Base UI](https://base-ui.com)** (`@base-ui/react`). It draws nothing, and gives focus
   handling, keyboard navigation, typeahead, ARIA and placement that keeps the control inside the window.
2. **The look stays plain CSS with `tokens.css`.** The shared controls are styled by Base UI's data attributes in
   `src/ui/ui.css`. No Tailwind for now.
3. **Shared controls live in `apps/desktop/src/ui/`**, not in a separate package yet. Apps import from `./ui`.
4. **Movement stays with Motion** (`motion.tsx`), so menus grow out of what opened them like the rest of Mobius.
5. **Guards in the unit tests:** no new hand-drawn control of a kind that `src/ui` offers, and no raw colours or pixel
   sizes in `src/ui` style sheets.

## Consequences

- Existing callers keep their APIs. `ContextMenu` is rebuilt on the shared menu, so its eight callers did not change.
- Apps move to the shared controls as they touch each piece, and take their file off the guard's list.
- One more dependency in the interface. Base UI is MIT-licensed, has no styles to override, and positions with
  JavaScript (Floating UI), so it behaves the same in WebView2 and WebKit.
- An in-app gallery of the controls was considered and left out for now.
