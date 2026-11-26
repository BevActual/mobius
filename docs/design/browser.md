# Browser: History in the tabs panel

The Browser round of 25 November 2026 (one app at a time). Browser's panel-look review (Spaces, Today clearing itself,
favourites, Ask about this page) and the second design pass (close × on hover, middle-click, Reader) were already in.
What every browser has and Mobius's did not show in the Browser itself is History: it was only in Settings. Chrome's
and Edge's History (Ctrl+H) and Safari's History sidebar are the references; Arc keeps its archive in the sidebar too.

## History

- **Where:** in the tabs panel, in place of the tabs, with the way back as its head ("‹ History"). Ctrl+H opens and
  closes it, as in Chrome and Edge; History is also first in the panel's ⋯. Escape clears the search, then goes back.
- **What:** a search (every word typed, in the title or the address), then the pages visited under Today, Yesterday
  and each earlier day by name, newest first. A page visited several times in a day is listed once, at its latest
  visit, with that time at the row's end.
- **Acting on a page:** a click goes there in the open tab, as Chrome and Safari do; a middle-click opens a new tab.
  Right-click: Open, Open in new tab, Copy address, Remove from history.
- **Clear history…** at the foot asks first and says what stays (tabs, bookmarks, Read later).
- **With history turned off** in Settings › Browser, the panel says so and where to turn it on.
- **Searching tabs** (Ctrl+Shift+A) also lists up to eight pages visited before under History, after Bookmarks,
  leaving out what is already open or bookmarked, as Arc's and Chrome's search do.

## Recently closed (round 2)

As Chrome's History › Recently closed and Arc's Archived Tabs (resources.arc.net, "Archived Tabs"): each web tab that
closes, by you or by Today clearing itself, is remembered (the last 25, on this computer). History opens with the ten
latest under **Recently closed**, above the days; one Today closed says "Cleared by Today" in place of its time. A click
opens it again in a new tab. Clear history forgets these too.

## Copy the address (round 2)

Ctrl+Shift+C copies the page's address and says "Copied the link", as Arc's Copy URL (Cmd+Shift+C) does.

## Split view (round 2)

As Arc's Split View (resources.arc.net, "Split View"): two tabs side by side in the page panel. A tab's menu has
**Open in split view** (that tab beside the one showing) and, on a tab in the split, **End split view**; Ctrl+Shift+=
splits with the tab seen last and, again, ends it. Above each page sits its title (a click makes it the active tab,
the address bar's) and an End split button that keeps that page. The divider drags, moves 5% with the arrow keys and
goes back to half on a double click; the share is kept across restarts. Both rows show "split" in the tabs panel. The
split ends when either page closes or a tab outside it is chosen. The shell places both native pages
(`browser.showBeside`, `surface.setBesideBounds`).

## Folders of pinned tabs (round 2)

As Arc's Folders (resources.arc.net, "Folders"): pinned tabs can be kept in folders, per space. A tab's menu has
**New folder with tab** (named in place), **Add to <folder>** and **Remove from folder**; Tabs options has **New
folder**. A tab put in a folder is pinned, and unpinning one takes it out. A folder opens and closes in place with its
count beside the name; closed, it still shows the tab you are on, as Arc's does. Right-click a folder to rename or
delete it; deleting keeps its tabs pinned. A search shows the tabs without folders.

## Later

- Separate sign-ins per space.
