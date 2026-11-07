# Workspace layout: one adaptive surface

Owner direction (2026-11-07): an app in Mobius should not feel like a window into another application. The UI
morphs: the controls that exist change with what you are doing, inside one unified design, and the agent can be used
while you work in any app.

## The parts, the same in every app

| Part | What it is | How it adapts |
|---|---|---|
| Sidebar (left) | The apps by name, then the open app's own list (tabs, notebooks, lists, conversations). Folds to an icon rail. | The **Create** button follows the app (New tab / New note / New task / New conversation). Counts and dots show what is waiting and what the agent changed elsewhere. A narrow window folds it to the rail on its own. |
| Toolbar (top) | Where you are (title + one line about it), then the app's own controls, then the agent. | Browser: back, forward, address. Notes: notebook and save state. Tasks: how many to do, Clear completed. Agent: which model. |
| Work area | The app's content as one sheet on the window. | Only the content changes between apps; headers live in the toolbar, not in each page. |
| Agent | One conversation across all apps. | Three sizes: **Ask** in the toolbar when the panel is put away; the **panel** beside the work (the composer turns into a live status line while the agent works); the **Agent app** full size. On-canvas actions work on text selected in a note or on a web page. |
| App hub | Every app as a tile with a live status, ways to start something, apps still to come. | Opens from the sidebar; type to narrow it. |

## Rules taken from Apple's HIG (Sidebars, Toolbars) and Microsoft's 2026 Copilot redesign

- Do not hide the sidebar by default; let people hide it, and fold it when the window is narrow (macOS Mail).
- Sidebar icons use the accent colour; at most two levels of hierarchy; nothing critical at the bottom.
- One entry point for the agent that sits above the work and opens a side pane that works with the content, with
  clear signals of what it is doing (M365 Copilot, May 2026). Invoking it on the content itself comes after.
- Progressive disclosure: start clean, reveal controls in context, never every path at once.
- Glass only on the top layer (the app hub, menus); the sidebar and toolbar are solid.

## Mobius 2 shell

- One window. The sidebar runs edge to edge; one toolbar spans the work area; controls are capsules; indigo is the one
  accent. Glass stays on the top layer only, so Linux stays readable.
- **Split view**: the toolbar's split button puts a second app beside the first. Each pane has a small header (choose
  its app, swap, close) outside the page view; the toolbar and sidebar follow the focused pane. Drag the divider, or
  focus it and use the arrow keys. Below 980 px the second pane folds away until the window is wide again. With the
  Agent app in a pane, the agent panel steps aside.
- **Beside the conversation**: when the agent writes a note, changes a task list or opens a web page while you are in the
  Agent app, it opens in the second pane, and typing stays in the conversation. A pane you chose for something else is never
  replaced; that app gets its dot in the sidebar instead.
- **Replies read as formatting**: headings, lists, quotes, code, bold and links (links open as tabs in Mobius). The
  reply is read into plain data, never HTML, and only web and mail links are followed.
- **Little Mobius**: a small window, kept above other apps, with the conversation and nothing else. It opens from the
  toolbar, shares conversations with the main window, and closes with it.

- **On-canvas actions**: select text in a note and a capsule appears above it: Ask (the text joins the agent's message
  box as a Note chip), Rewrite (the agent changes it in the note), Summarise, and Make a task (added straight to the
  first list, no agent needed). On a web page, the toolbar's selection menu offers Ask, Summarise, Explain, Make a task and Save to Notes (quoted on a Clippings page, with a link back; "Save to another page…" picks a different page and keeps saving there)
  (the page is a native view, so its picture covers it while the menu is open).
- **Review and undo**: each agent turn begins with a checkpoint. When a turn ends having changed notes, task lists or
  files, a strip above the message box says so: Review lists each change with its own Undo; Undo all puts back only
  what that turn changed, so edits made since elsewhere are kept. A changed note says so above the page, with Show
  changes (the page line by line: added, removed, kept, with an Undo on each change) and Undo all; changed pages and lists carry a dot in their sidebars.
- **Your sidebar**: drag an app in the sidebar to reorder it (or Alt+Up/Down on a focused app), or right-click it to move it, hide it, or edit the list. Settings ›
  Appearance › Layout has the full list with a checkbox and order buttons for each. At least one app always stays,
  and hidden apps are still in All apps. Pin a note or a task list (the pin beside it), or a web page (the pin in the browser toolbar), and it stays under
  the apps, up to eight; drag pinned items (or Alt+Up/Down) to reorder them. A pinned page opens in its tab if one is open.

## Next

1. Run the end-to-end suite (including `e2e/mobius2.spec.ts`) in the Windows shell, and look over the real window, a web
   page in a split pane, and Little Mobius.
