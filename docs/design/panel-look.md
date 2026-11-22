# The panel look

Andrew agreed this look on 22 November 2026 ("yea i think this all works"), after a round on the Design lead's
canvas. It keeps Instrument's sizes, type and rules, and changes how the window is put together: every area is a
calm, rounded panel on a darker frame, in the spirit of Linear, with Ableton's top bar and browser where the work
needs them. Where this page and [rules](rules.md) or [Instrument](instrument.md) disagree, this page wins.

The mocks are in `panel-look/` (source `refined2.html` and `refined2.css`, open with `?s=mail|music|browser|settings`
and `&t=dark|light`). They use the real apps' content as it is on main, so every feature shown exists or is listed
under "New in the apps" below.

![Mail in the panel look, dark](panel-look/mail-dark.png)

## The frame

- **Panels on a frame.** The window background is the frame. Each area (an app's list, its content, the Mobius panel)
  is its own panel with rounded corners, a hairline edge and an 8 px gap around it. Panels hold the content; nothing
  sits loose on the frame. Settings › Appearance has "Panels on the frame" to turn the gaps off for more room.
- **Two top rows, as today.** The title row holds the Go icon, the menus, the open file's name in the centre and the
  window buttons. The tool row holds the app's tools, **centred**. An app with no tools (Settings) has only the title
  row.
- **No command bar on screen.** Ctrl K (and the Go icon) open the command window; nothing waits in the top bar for it.
- **Mobius is an icon** at the right end of the tool row (the title row when there is none), lightly tinted indigo,
  with a **Comments** icon right beside it. Their names and keys are in the tooltips.
- **Icons for familiar actions, words for modes and values.** Reply, Done, Later, Loop, Mixer, Automation, Export,
  Reader and Downloads are icons with a tooltip that names the key ("Automation (A)"). Session/Arrange, Important/
  Waiting/Other and readouts such as `1.1.1 · 92 bpm · 4/4 · D minor` stay in words. Related icons sit in a small
  group.

## Colour and surfaces

- **Indigo means Mobius, only.** Selection, unread dots, switches, segmented controls and focus use ink and grey.
  Indigo appears on the Mobius icon, on what Mobius made (dashed until kept), and on From Mobius rows.
- **Dark.** Near-black frame, panels one step above it, edges as faint white lines (6 to 10 % white) with a soft
  shadow and a thin top highlight. No solid grey borders. Text in three steps: ink, secondary, faint.
- **Light** keeps the same structure: a light grey frame and white panels.

## Inside panels

- Each panel has a short header (40 px): its name on the left, its few tools on the right. No line under it.
- List rows float: no lines between them, a selected row is a rounded grey fill. Side lists use 28 px rows with
  outline icons.
- A short list ends with a quiet note ("That's everything that matters", with counts), not an empty panel.
- Reading and settings pages are one centred column (about 600 px for reading, 720 px for settings), with grouped
  rows: name, one line of explanation, the control on the right.

## Mobius

- The panel is docked right as today. At rest it shows **Waiting for you** as real objects (the Pad idea, the reply to
  Priya) with Open or Review, then the ideas as chips above the composer. It is never an empty column.
- A change Mobius made stays dashed where it happens, with one floating **Why · Discard · Try another · Keep** bar near
  it and the request in one line under it. No banners across the top.
- Browser and Settings start with the panel closed. Browser has "Ask about this page (Ctrl L)" at the foot of its tabs
  panel; nothing floats over the web page.

## The apps

| App | Shape |
| --- | --- |
| Mail | Mail panel (search, Inbox, Later, Drafts, Sent, Done, Labels, From Mobius, Accounts) · list with split tabs Important, Waiting, Other · centred reading column with a facts row under the sender and the reply box inside the message ("Draft with Mobius" in it) · keys bar at the foot |
| Music | Browser panel after Live 12's browser ([manual](https://www.ableton.com/en/live-manual/12/working-with-the-browser/)): search, Collections, Library categories, Places (This song, Songs, Packs, User Library, folders), tag filters by sound type and character, name and type list, preview strip with Similar sounds · Arrangement panel · tool row: Session/Arrange, transport group, one mono readout, icons for loop, metronome, tap, mixer, automation, export |
| Browser | Tabs panel after Arc: spaces switched at its foot, favourites as tiles, Pinned, Today with Clear, From Mobius, Ask about this page · the page fills its panel · address bar in the middle of the tool row |
| Settings | Settings panel with search and iconed sections · centred page with grouped rows |

![Music in the panel look, dark](panel-look/music-dark.png)
![Browser in the panel look, dark](panel-look/browser-dark.png)
![Settings in the panel look, dark](panel-look/settings-dark.png)

## Command window

Ctrl Space anywhere on the PC, Ctrl K inside Mobius: one centred window. Opened empty it shows app tiles, Recent and
Suggested; typing a command turns it into fields (Tab moves between them) with a quick answer, matches from every app,
and a dashed "Ask Mobius" row that answers in place (Ctrl Enter). See [launcher](launcher.md).

![The command window, just opened](panel-look/launcher-dark.png)

## New in the apps

Not just restyling; each is app work: Music's browser (tags, preview, Similar sounds), Mail's split tabs, built-in
reply box and facts row, Browser's spaces and favourite tiles, the Mobius panel's Waiting for you objects, and the
"Panels on the frame" setting.

## Order

1. Builder: the shared frame (panels on the frame, centred tool row, Mobius and Comments icons, dark surfaces, the
   indigo-only rule in tokens). Every app gets the look at once.
2. Apps lead, one PR per app: Mail, then Music's browser (with the parity work), Browser, Settings, then the rest in
   the same style. Design lead reviews each against this page.
