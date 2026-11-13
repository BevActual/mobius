# Browse and find

## Browser

A full web browser, with Mobius able to read and work on pages for you.

![The Browser app in Mobius](../readme/apps/browser.png)

- **Tabs** live in the sidebar, as in Safari and Arc. Pinned tabs sit in their own group above the rest; drag a tab to
  reorder it or across the line to pin it. A small Mobius mark on a tab means Mobius is reading or using it; a hand means
  you took it back.
- **A new tab** opens Mobius's start page: your favourites, the sites you visit most, and your reading list. It is drawn
  by Mobius, so none of it is shown to a web page.
- **Bookmarks** with the star beside the address, **Find** (Ctrl+F), downloads and history.
- **Mobius on the page.** Ask about the page, or select text and act on it. Opening a site the agent hasn't been allowed
  asks first, and clicking or typing on a page asks every time. When a page needs a sign-in, you sign in yourself.
- Pages are shown by the system web view (WebView2) in the installer, or by Chromium (CEF) in a build from source that includes it.

Settings: **Settings › Browser** (allowed sites, local addresses, bookmarks, history).

## Mail

Your mail, mirrored to this computer, sorted for you, with drafts Mobius can write and you send.

![The Mail app in Mobius](../readme/apps/mail.png)

- **Accounts** sign in with an app password. Ready-made settings for iCloud, Fastmail, Gmail and Yahoo, or any provider by its IMAP and SMTP servers.
- **The sidebar** holds New message, Search, your mailboxes (Inbox, Drafts, Flagged, Sent and Archive) and your accounts. Flagged and Archive gather your flagged and archived mail.
- **Categories:** Primary, Transactions, Updates and All. Move a message to another from **More** (…) in its toolbar or from its right-click menu.
- **The message toolbar** in the window's top row, as in Apple Mail: Reply, Reply All and Forward; Archive and Flag; and **More** for Mark as Unread, Remind Me Tomorrow and moving it to another category. Archive and Remind Me Tomorrow can be undone from the note that appears at the bottom. Right-click a message in the list for the same actions without opening it.
- **Replies quote the message** under where you write, and forwards carry who it was from and to. Attachments are not forwarded yet.
- **Keys:** the up and down arrows move through the list; E archives, R replies and H brings the message back tomorrow at 8:00.
- **Email is shown safely:** no scripts, and nothing loaded from the web, so tracking pixels don't fire.
- **Suggested replies** are dashed until you keep one (it opens as your draft), discard it or ask for another. A reply you kept, here or with Keep all, waits under the message it answers with **Send** and **Edit**.
- **Take care of this** (in the Mobius panel with an email open) does the whole job in one ask: to-dos go to Tasks with their due dates, a meeting it asks for goes in Calendar (at the time the email names if you are free, otherwise at a free time it picks), and a reply is suggested. Each waits for you.
- **Get to zero** (in the Mobius panel while no email is open) proposes a plan for the whole inbox, dashed until kept.
- **Ask about your mail** in the Mobius composer: the answer lists the messages it came from, and each one opens.
- **Send later:** tomorrow at 8:00, Monday at 9:00, or when the person is usually on mail.

Mobius never sends mail itself. It writes drafts; you press Send.

**Kept in:** `workspace/mail/<account>/`, a copy of each account's recent Inbox and Sent mail, with your drafts.

## Search

One box for everything Mobius keeps: conversations, notes, tasks and pages. The sidebar narrows it to one kind of thing.
Type a question instead and Search hands it to Mobius.

![The Search app in Mobius](../readme/apps/search.png)

## Research

Ask a question and Mobius searches the web from several angles, reads the best pages and writes a report with its
sources. The report is a page like any other, and follow-up questions add to it. What Mobius wrote waits for you to
keep.

![The Research app in Mobius](../readme/apps/research.png)

**Kept in:** `workspace/research/`, each report a Markdown file.

## Reader

Pages saved to read later, shown as plain readable text with where each came from. Save the page you're on from the
Browser, or give Reader an address.

![The Reader app in Mobius](../readme/apps/reader.png)

- **The article has the page.** The bar above it says where it came from, when you saved it and how many minutes are
  left; a thin line fills as you read, and each article opens where you stopped. Opening Reader shows your newest
  article.
- **Aa** sets the text size, the font (sans serif or serif) and the page colour (Match Mobius, Sepia, Grey or Night),
  as in Safari Reader. Your choice is kept on this computer.
- **Save a link** (the link button, or New › Save a link) shows the link field; with nothing open it is always there.
  **Save this tab** keeps the page open in the Browser.
- **Highlights:** select a passage and press Highlight (or H); they are listed under the article and can be copied to
  Notes. **Ask Mobius** on a selected passage or a highlight starts a message with it quoted, the article attached.
- **J** and **K** move to the next and previous article in the list. **Done reading** (E) moves the article to Archive
  and opens the next one.

**Kept in:** `workspace/reading/`, each article a Markdown file.

## Files

Your whole workspace as a drive.

![The Files app in Mobius](../readme/apps/files.png)

- **The drive** is a list like Finder's: Name, Kind and Size columns (click one to sort; folders stay first), and each
  file wears the icon of the app that opens it. A file Mobius made is dashed until kept; a folder says how many such
  files it holds.
- **Select, then open.** A click selects, a double-click or Enter opens: folders in place, files in their own app. The
  arrow keys move, Backspace goes up a folder, and Back and Forward (Alt+Left, Alt+Right) walk the folders you visited.
- **The toolbar** names the open folder with how many items it holds, and has Back, Forward and New folder. The
  **path bar** at the foot shows where the folder is; click any part to go back up.
- **Search**, at the top of the sidebar, narrows the open folder by name. **Right-click** a row to open, rename, copy its path, show it in Explorer,
  ask Mobius about it, or move it to the Trash.
- **New folder** (Ctrl+Shift+N) is named in place; **F2** renames; **Delete** moves to the Trash, with Undo in a toast
  at the foot of the page. The Trash is
  `workspace/.trash/`, hidden from Files' folders and from Mobius.
- **Trash**, under Places in the sidebar, lists what you moved there, when, and where it was. **Put Back** (or a
  double-click) returns it to that folder; **Empty Trash** and **Delete Immediately** (right-click) delete for good, and
  always ask first. Mobius cannot empty the Trash. An app's own folder (notes/, docs/...) is never renamed or
  trashed from here.
- **Date Modified** shows when each file and folder last changed. The agent's own `files.list` leaves dates out.
- **The sidebar** has Workspace and Trash under Places, the workspace's folders (Notes, Docs, Sheets...) under Folders, a dot on
  any folder holding something from Mobius, and Made by Mobius under From Mobius.
- **Made by Mobius** collects what Mobius created, dashed until you keep it, with a count of what is waiting.
