# Pieces: apps as parts Mobius can bring beside your work

Status: proposal, 27 November 2026.

Andrew asked whether Mobius would work better if apps became modes of one app, with Mobius summoning panels as it
works: "it would also need to feel dynamic and not jarring... so Mobius feels almost like a Iron Man Jarvis while
you're working".

## The short version

- **Apps stay as homes.** Each app is still where you go to do that kind of work, with its full layout.
- **Each app also offers a few pieces.** A piece is a small, live view of one thing from that app (a mail thread,
  today's calendar, a task list) that can sit beside any app.
- **Mobius brings up the piece it is working in.** It brings it up beside you, shows its changes there (dashed, with
  Keep or Discard), and puts it away when it is done, unless you have started using it.
- **You can bring up pieces too.** Ctrl+K › "Show here", or Show beside from an item's menu. A project can open with
  its pieces already arranged.
- **Mobius only shows pieces Mobius already has.** It picks from a fixed catalogue of pieces built for each app. It
  never draws a new interface of its own. That keeps every piece as polished, fast and safe as the app it comes from.
- **Motion makes it feel calm, not busy.**
  - A piece arrives from the side it will sit on and leaves the same way.
  - What you are working on never moves and never loses the keyboard.
  - Mobius says what it is bringing up before it does.
  - Esc puts away the piece Mobius brought.

## What others do (read 27 November 2026)

- **Microsoft Loop components.**
  - They are "portable" pieces of content (a table, a task list, notes) that stay live and in sync wherever they are
    placed: in a Teams chat, an Outlook mail or OneNote.
  - Microsoft's design rules:
    - Each piece is live, embedded, actionable and portable.
    - The host draws the header (the app's icon and name, plus Open and Copy) and the border, so the piece never
      repeats them.
    - A piece that can only be looked at should become actionable.
- **Notion.** Opening a page from a list offers side peek (the list stays live on the left), center peek or full page.
  The choice is a setting of the view.
- **Arc.** Split view, and Peek for links (Mobius's Browser already has both).
- **Generative interfaces.** Products where an AI shows interfaces have settled on three levels:
  - A catalogue of built components that the agent chooses between.
  - A vocabulary of cards, lists and forms that the agent fills in.
  - Free-form HTML in a sandbox.

  The advice is to start with the catalogue, because it keeps the product's design and safety. Chat-plus-canvas
  products (ChatGPT canvas, Claude artifacts) put the agent's work in one panel beside the chat. The newer pattern is
  "chatless": the agent's work shows inside the app's own interface.
- **Motion guidance.**
  - Apple: add motion with a purpose, keep it brief, never make people wait for it, and reverse a motion the way it
    came.
  - Microsoft: show where the outgoing view goes and where the new one comes from; entering decelerates, leaving
    accelerates.

Mobius is already the chatless kind: Mobius works in the apps, and its changes are dashed in place. Pieces extend that
so its work can be seen beside whatever you have open, without switching apps.

Sources:
- https://support.microsoft.com/en-us/loop/get-to-know-loop-components
- https://learn.microsoft.com/en-ie/MicrosoftTeams/platform/m365-apps/design-loop-components
- https://www.notion.com/releases/2022-07-20
- https://www.copilotkit.ai/generative-ui
- https://dev.to/obetomuniz/who-owns-the-surface-22n9
- https://developer.apple.com/design/human-interface-guidelines/motion
- https://learn.microsoft.com/en-us/windows/apps/design/motion/directionality-and-gravity

## What the shell has already

| Built | What it gives pieces |
|---|---|
| Split view (`SplitView.tsx`, `split.ts`) | Two apps side by side, a remembered divider (25–75%) and a focused pane |
| Docks (`dock-fit.ts`, the Panels rules in [guide.md](guide.md)) | Left, right and bottom docks per app, panels that move between docks, layouts kept per app |
| The Mobius panel's Glance and Result slots (`PanelSlots.tsx`) | An app already gives the panel a small live card (Glance) and its own view of a result (Result) |
| Objects (`ui/Objects.tsx`) | `ObjectCard` and `ObjectChip`: the shared look of one thing from any app |
| Motion (`motion.tsx`, `app-motion.ts`, guide.md Motion) | `dockIn`/`dockOut` (200 ms in, 150 out), `switchIn`, `pageIn`, `foldAway`, `slideIn`; Reduce Motion fades |
| Browser Peek | A card over the page that comes and goes without losing your place |
| Chats on items (`itemChats.ts`) | Mobius already knows which item it is working on |

So the parts exist. What is new is a piece as a kind of thing, and one place beside your work where pieces go.

## How it works

### A piece

- A piece is a component an app registers: `{ id: 'mail.thread', app: 'mail', title, render(item) }`.
- It shows **one thing** (a thread, a day, a list), is live, and works on its own: reply, tick or move. It is not a
  picture.
- The shell draws its header: the app icon and the thing's name, plus **Open in Mail** (the full app, at that thing)
  and **Put away**. The piece never repeats them.
- It has three sizes it must fit:
  - **narrow** (280–360px, beside an app);
  - **half** (the right half of split view);
  - **card** (in the Mobius panel's Result slot).

### Pieces are panels

Andrew (27 November): pieces are like the panels the Panels button in the top bar shows and hides. So a piece is not a
new mechanism. It is a panel the shell owns, in the same system as every other panel ([guide.md](guide.md), Panels):

- **The Panels menu lists open pieces** under their own heading ("Pieces"), beside the app's panels and Mobius. Each
  can be shown or hidden there, and Reset layout puts them back.
- **They sit in the docks that already exist.** A piece opens in the right dock beside the app's own right panels.
  The Mobius panel stays as it is.
- **They are the shell's, like Mobius, so they stay as you switch apps.** A piece you brought up for a thread is still
  there when you go to Calendar. Where you last moved it is remembered.
- **Narrow windows:** docks already give way before the app does (`fitDocks`), and pieces follow that.

**What panels can do today** (checked in the code, `ui/PanelLayout.tsx`, 27 November; all of it was in 0.1.26):

| | App panels | Mobius panel |
|---|---|---|
| Show and hide (Panels menu, View menu, keys, Hide) | Yes | Yes |
| Resize, by dragging the dock's edge (double-click resets, arrow keys by 16px) | Yes, per dock, remembered per app | Yes |
| Move to another dock | **No** in 0.1.26. Round 0 adds it (#972) | No |
| Pop out into its own window | **No** in 0.1.26. Round 0 floats it over the page (#972); a separate window comes later | Yes |
| Tabs when two panels share a dock | Yes (`PanelTabs`) | No |

guide.md's Panels section says panels can be moved and popped out. That is the design, not what is built, and the
guide is corrected in this change. The dock edge is easy to miss: it is a thin line with no handle, which is probably
why resizing felt missing.

So pieces start with **round 0: panels that do what the guide says.** Every pane follows the same rules, Mobius and
pieces included:
- **Move:** drag a panel by its header to another dock, with the target dock outlined as you drag. A panel's menu
  also has **Move to left, right or bottom**.
- **Pop out:** **Pop out** floats a panel over the page, in the same window, so it keeps everything it was showing.
  It is moved by its header, sized from its corner, and docked again from its menu or by dragging it to a dock. A
  separate window of its own (as Little Mobius is) needs the app's state shared across windows, so it comes after the
  pieces.
- **Resize** stays as it is, with a visible grip on hover.
- **Remembered** per app, where each panel is, with Reset layout to undo.
- **Panels adapt to where they are** (Andrew, 27 November: "how panels change when resized, popped out, moved
  around so it's actually useful"). A panel lays itself out by the space it has, not by which dock it was made for.
  Each one declares a minimum width and height, and below that minimum the dock won't shrink it.
  - **Narrow** (a side dock at its smallest): essentials only. One line per row, secondary details hidden, tools
    folded into the panel's ⋯ menu.
  - **Wide** (a wide side dock, or a popped-out window): more columns, previews beside the list, and tools out in
    the open.
  - **Short and wide** (the bottom dock): rows become a horizontal strip or columns, rather than a tall list squeezed
    flat.
  - **Popped out:** the window's room is used fully, it is resizable like any window, and the panel follows the same
    rules there.
  - Nothing is cut off at any size: text wraps or ends in an ellipsis with the full text on hover, and nothing
    scrolls sideways.
  - This is built once in `PanelLayout`: each panel is told its size class through container queries and a
    `usePanelSize()` hook. Each app's panels are then checked at each size.

The shell's panels (Mobius, then pieces) already sit in the same menu as the app's (`ShellPanel` beside
`PanelsOfApp`), so pieces join that list once round 0 is done.

### How Mobius uses pieces

- **Brought up as it works.** When a turn first acts on something that has a piece (it reads a thread, changes a
  list, books into a day), the piece for that thing opens as a panel in the right dock. The working pill first says
  "Showing the Acme thread".
  - Reads that only look something up don't bring a piece. Only what Mobius is about to change does.
  - At most one piece per turn is brought, and it stays put for the rest of the turn.
- **Its changes are shown there:** dashed, with Keep or Discard, as in the app.
- **Put away when done**, after Keep or Discard, unless you clicked into it, in which case it is yours and stays.
  Pieces Mobius brought carry the dashed Mobius edge until then; yours never do.
- **A `show` tool** lets Mobius bring up a piece on purpose ("Show me today beside this"). It picks only from the
  catalogue, by app, piece and item id.
- **Background work never brings pieces.** Its result stays in the Inbox, which opens the piece when you click it.

### How you use pieces

- Ctrl+K: a result's **Show here** (Alt+Enter) opens it as a piece instead of opening its app.
- Item menus: **Show beside**, next to Assign to Mobius.
- **Projects:** a project remembers the pieces beside it (its task list and its calendar, say) and brings them back
  when you open it.

## Motion: calm, never jarring

These follow the motion rules in [guide.md](guide.md) and the motion checklist.

1. **A piece arrives from the side it will sit on.** It slides out of the edge in 200 ms and leaves the same way in
   150 ms (`dockIn`/`dockOut`). The app beside it gives up its room smoothly; nothing jumps.
2. **What you are working on never moves or loses focus.** The caret, the selection and the scroll stay where they
   are. A piece Mobius brings never takes the keyboard.
3. **Said before it is done.** The working pill names the piece a moment before it arrives (about 300 ms), so the
   motion is expected.
4. **Settles once.** Within a turn, a piece doesn't reshuffle. A second piece stacks under the first; it never swaps
   places with it.
5. **Interruptible.** Esc puts away what Mobius brought. Clicking a piece makes it yours. A piece on its way out can
   be caught back by clicking it.
6. **Changing state, not place.** When a piece goes from Mobius's to yours, only its edge changes (dashed to
   none, `--dur-fast`).
7. **Reduce Motion:** slides become a short fade.

## Built so far (27 November 2026)

- **Pieces as shell panels** (`pieces.ts`, `ShellPanelsContext` in `ui/PanelLayout.tsx`): open pieces are kept on this
  device (at most three, the oldest goes first) and added to every app's layout in the right dock, so they move,
  float, resize and show in the View menu like any panel. In split view they sit in the right pane. The header has
  **Open in …** and **Put away** (the panel's ×). A piece Mobius brings carries the dashed Mobius edge until the
  person clicks into it.
- **Tasks list:** a list's menu › Show beside. Adding and ticking work there; a renamed list keeps its piece.
- **Calendar day:** Window › Today beside the work. The day's events as a list, ‹ › and Today to step, Mobius's
  suggestions dashed with Add and No thanks; a row opens the event in Calendar.
- **Mail thread:** Show beside on a message (its row's menu, or the open message's ⋯). The conversation with Reply in
  place; Send works there as in Mail.

- **Mobius brings them up** (round 3): the first list, day or conversation a turn changes (a list it edits, a day it
  suggests an event on, a message it drafts a reply to) comes beside the work, once a turn, unless its app is already
  on screen. The working pill says "Showing …, from …" for a few seconds. The piece goes when its change is kept or
  discarded (Keep all, the app's Keep, Add or No thanks, the suggested reply's Discard), unless the person clicked
  into it, which makes it theirs. Esc away from a field puts Mobius's pieces away. The Mail piece shows Mobius's
  suggested reply with Discard and Keep, as Mail does.

- **Show here and Show beside** (round 4): in Ctrl+K, a found mail conversation, event or task list has **Show here**
  in its actions (Shift+Enter), which brings it beside the open app without leaving it. Calendar's event and empty-day
  menus have **Show day beside**, next to the Tasks list menu's and Mail's Show beside.

Not yet: a `show` tool for Mobius to bring a piece without changing anything, a piece remembered by project.

## First rounds

0. **Panels, done properly** (above), in this order: visible resize grips; moving between docks; panels that adapt
   to their size and place; then pop out. Every app's panels are checked at each size.
1. **Pieces as shell panels** (then judge how they feel before adding more): listed in the Panels menu, placed in the right dock, movable and remembered, with
   the dock motion.
2. **Three pieces:**
   - **Mail thread:** the thread, with reply in place.
   - **Calendar day:** today or another day, with its events and the dashed proposal.
   - **Tasks list:** a list with ticking and adding.

   Each is built from the app's own components, so it looks and behaves as it does in the app.
3. **Mobius brings them up:** the pill's notice, at most one per turn, put away after Keep or Discard, and the `show`
   tool.
4. **Ctrl+K › Show here** and **Show beside** in item menus.
5. **Tests:** e2e for bringing up and putting away, focus that never moves, Esc, Reduce Motion, and a narrow window.

Later rounds: Docs page, Notes note and Files preview pieces; projects that remember their pieces; and a piece in the
Mobius panel's Result slot.

## Decisions for Andrew

1. **Where pieces go:** settled by Andrew's note that they are like panels. They are panels in the existing docks,
   shown and hidden from the Panels menu.
2. **Does Mobius bring pieces up on its own?** Recommended: yes, only for what it is about to change, one per turn,
   announced first, put away when done. Off is a setting.
3. **Apps stay as homes, not modes.** Recommended: yes. Pieces give the Jarvis feel without taking away each app's
   full layout.
