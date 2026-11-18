# The launcher: what it does

The Go button and Ctrl+K open the launcher. It is how you get anywhere in Mobius now that the rail is gone (panel-layouts.md), so it has to be fast, find everything, and never come up empty. This page covers what it should do, what it does today, and the order to build the rest in.

## Its four jobs

| Job | What you do | What it shows |
|---|---|---|
| **Go** | Open an app, a place, or something you had open | Pinned apps, Recent, and the places at the foot (Home, Activity, Abilities, Settings) |
| **Find** | Type part of a name or some words | Items from every app: notes, mail, tasks, files, events, songs, chats, tabs |
| **Do** | Type what you want done | Commands: the open app's, every app's "New …", and settings you can flip |
| **Ask** | Type a question | Ask Mobius is always the first row, so a search with no match becomes a question |

## Where it falls short today (checked on main, fed360ec)

1. **Recent stays empty.** `noteRecentItem` is never called, so nothing gets recorded.
2. **Picking a Recent row opens only the app,** not the thing itself.
3. **Typing never finds items.** `find` isn't passed to the launcher, even though `search-hub.ts` already searches conversations, notes, documents, sheets, mail, tasks and pages, and `openTarget` already opens each of them.
4. **Commands come only from the menus,** so they cover just the open app, plus the "New …" actions. You can't run another app's command, and settings aren't there at all.
5. **Ranking doesn't learn.** The thing you pick every time doesn't rise to the top.
6. **Results that arrive late would move the selection,** because selection is held by position, not by item.

## What it should do

### Nothing typed

This works as it does today, with a working Recent:

- Ask Mobius.
- The pinned apps, with waiting dots.
- Recent: up to eight items, newest first, deduplicated. Items that no longer exist are dropped.
- The places.

### Typing

The sections come in this order. Each one is left out when it has nothing to show.

1. **Ask Mobius:** "…your words…".
2. **Top hit:** the single best match of any kind, if it is clearly ahead of the rest.
3. **Apps and places.**
4. **Items:** at most eight, each showing its app and when it changed. The last row is "Show all in Search", which opens Search with the same words.
5. **Commands:** with their keys.
6. **Settings:** for example "Dark theme" or "Density: compact". A switch flips right there in the row, and anything else opens the Settings section.
7. **Open tabs.**

### Narrowing to one app

Type an app's name and press Tab. The field then shows a chip ("Mail ›"), and everything below comes from that app alone: its items first, then its commands. Backspace on an empty field removes the chip.

Starting the text with `>` shows commands only.

### Acting on a row

| Key | Effect |
|---|---|
| Enter | Opens it, or runs it |
| Ctrl+Enter | Opens it beside what you have now, where the app supports that |
| Alt+Enter | Ask Mobius about this: opens Mobius with the item attached |
| Shift+Enter or → | A short menu of actions: Open, Ask Mobius about this, Copy link, Pin (for an app), Reveal in Files (for a file) |

### Ranking

- **Matching** is fuzzy on word starts, so "q3 bud" finds "Q3 budget".
- **Exact and prefix matches** come before fuzzy ones.
- **Learning:** what you picked for these same first letters rises. This choice memory is kept per profile on this device. It is never sent anywhere.
- **Recent items** get a lift over older ones.

### It must not break

- **Speed:** it opens in one frame. Every local source answers within 50 ms or is skipped. Slow sources (drives, mail on a server) stream in below.
- **Stable selection:** the selection follows the item, not the row number, so late results never move it. Enter always acts on what is highlighted.
- **Sources fail quietly:** a source that fails or times out is left out with no error row. The rest still show.
- **Never empty:** the Ask row is always there.
- **Escape** clears the text first, then closes.
- **IME:** text from an input method is not searched until it is committed.
- **Stale entries:** Recent and pinned entries for an app that was removed from Abilities are skipped, not shown broken.

## Look and feel

This section comes from reviewing the reference sheet's launcher, light and dark, at 1440×900.

| What it does now | Change |
|---|---|
| Its height jumps: tall with nothing typed, then it shrinks to two rows as you type | Keep one height while it is open, the height it has with nothing typed. Results scroll inside it, and the field never moves |
| It opens on its own, apart from the button | It grows from the Go button: same left edge, just under the top bar, 120 ms (none with reduced motion). Ctrl+K opens it in the same place |
| Section labels are in capitals ("PINNED", "APPLICATIONS") | Sentence case, as in every other list: "Pinned", "Recent", "Apps" (not "Applications") |
| An app row's detail says "Pinned" | Show its key ("Ctrl+3"), or nothing |
| Typing doesn't show why a row matched | The matched letters are drawn in ink at medium weight, and the rest in the row's own colour |
| Two footers: the places row, and the key hints under it | One footer. The places sit on the left, and on the right one hint for the selected row ("↵ Open", or "↵ Ask" on the Ask row). The full key list moves to the actions menu (Shift+Enter) |
| "Right-click an app to pin or unpin it" stays in the footer | Gone. Pinning lives in the actions menu and the right-click menu |
| Pinned tiles are 18 px marks in 72 px tiles, and up to 7 fit | 24 px marks. Up to 9 fit, matching Ctrl+1 to 9. A tile shows its key on hover |
| Rows are 40 px in every density | Rows follow the density: 36 px comfortable, 30 px compact, like every other list (instrument.md) |
| Nothing found | One quiet line under Ask: "Nothing in your apps matches. Press Enter to ask Mobius." |
| Slow sources | A thin progress line under the field while they load. No spinner, and nothing jumps when they arrive |
| A Recent row shows its kind's icon | It shows its app's icon, so the column of icons tells you where each item lives |

Later, if it earns its place: a preview of the selected item to the right of the list, as wide as the list (a note's first lines, a mail's sender and first line, an event's time).

## How apps take part

Each app registers what the launcher can find and do in it, the same way it declares its panels (`PanelLayout`). This works whether or not the app is open:

```ts
interface LauncherSource {
  app: AppId;
  /** Items matching the words, best first. Synchronous over what is already loaded; async allowed. */
  find?: (query: string, signal: AbortSignal) => FoundItem[] | Promise<FoundItem[]>;
  /** Commands that work from anywhere: "New event", "Compose", "Start timer". */
  commands?: () => LauncherCommand[];
}
```

The Apps lead's apps view uses the same registry: it lets you jump to any item in any app and run any app's commands.

## Build order

1. **Recent and Find** (Builder). Record a Recent item inside `openTarget`, and open Recent rows through it. Pass `find`, built from `hubResults`, and open its results through `openTarget`. This fixes gaps 1 to 3 with code that already exists.
2. **Look and feel** (above), **selection by item, sections, Top hit, "Show all in Search", Settings rows** (Design lead, in Launcher.tsx and launcher.css).
3. **The source registry** (Builder), then each app's `find` and `commands` (Apps lead).
4. **Narrowing to an app with Tab, `>`, and the actions menu** (Design lead).
5. **Choice memory in ranking** (Design lead).

Each step lands with unit tests for ranking and selection, and with an e2e test: Ctrl+K, type part of a note's name, press Enter, and the note is open.
