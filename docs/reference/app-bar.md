# The bar for each app

What "finished" means for a Mobius app, and the app each one is measured against. Each app's thread works toward this
bar; how it should look is in the [design rules](../design/rules.md).

## The five parts

An app meets the bar when it passes all five:

1. **Core features.** Someone could switch from the rival below for everyday use and not miss anything they reach for
   daily.
2. **Polish.** It follows [Instrument](../design/instrument.md), the agreed design style, and the
   [design rules](../design/rules.md), and it is built from the [shared controls](../developers/shared-controls.md). It has keyboard shortcuts, empty and error states, Undo, fast loading of large
   items, and works in light and dark.
3. **Mobius built in.** Verbs on the selection, the result dashed in place, Why this on the object, Try another in
   place, and progress with Stop. Linked from in the panel, and tools the agent can call to read and change the app's
   data. Mobius is optional: the app is fully usable with Mobius off.
4. **Real data.** The data is the person's own (files, or a real account such as IMAP or CalDAV), it syncs where the
   rival syncs, and nothing on screen is sample data.
5. **Tests.** Unit tests for the format and logic, an end-to-end spec for each core job, and a Rust test for the store.

## What each app is measured against

| App | Rival |
| --- | --- |
| Notes | Apple Notes, Bear |
| Tasks | Things, Todoist |
| Calendar | Fantastical, Google Calendar |
| Mail | Superhuman, Apple Mail |
| Docs | Google Docs, Word |
| Sheets | Excel, Google Sheets |
| Slides | Keynote |
| Browser | Arc, Safari, ChatGPT Atlas |
| Files | Google Drive, Finder |
| Knowledge | Notion |
| Projects | Linear |
| Database | TablePlus |
| Reader | Readwise Reader |
| Research | Perplexity |
| Terminal | Windows Terminal |
| Canvas | Miro |
| Design | Figma |
| Code | VS Code, Cursor |
| Photo | Lightroom |
| Video | CapCut |
| Music | Ableton Live |
| Abilities | VS Code extensions |
| Settings | Hermes Agent settings ([parity](hermes-settings-parity.md)) |

The order the apps were first brought up to the bar (daily apps first, simplest first: Notes, Tasks, Calendar, Docs,
Sheets, Browser, then the pro apps) no longer applies: since 12 November every app has its own thread and branch and
works toward the bar at the same time.
