# Browse and find

## Browser

A full web browser, with Mobius able to read and work on pages for you.

![The Browser app in Mobius](../readme/apps/browser.png)

- **Tabs** live in the sidebar, as in Safari and Arc. Pinned tabs sit in their own group above the rest; drag a tab to
  reorder it or across the line to pin it.
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
- **Categories:** Primary, Transactions, Updates and All. Move a message to another category from its header.
- **Email is shown safely:** no scripts, and nothing loaded from the web, so tracking pixels don't fire.
- **Suggested replies** are dashed until you keep one (it opens as your draft), discard it or ask for another.
- **Get to zero** (in the Mobius panel while Mail is open) proposes a plan for the whole inbox, dashed until kept.
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

**Kept in:** `workspace/reading/`, each article a Markdown file.

## Files

Your whole workspace as a drive.

![The Files app in Mobius](../readme/apps/files.png)

- **The drive** is a list like Finder's: Name, Kind and Size columns (click one to sort; folders stay first), and each
  file wears the icon of the app that opens it. A file Mobius made is dashed until kept; a folder says how many such
  files it holds.
- **Select, then open.** A click selects, a double-click or Enter opens: folders in place, files in their own app. The
  arrow keys move, Backspace goes up a folder, and Back and Forward (Alt+Left, Alt+Right) walk the folders you visited.
- **Filter** narrows the open folder by name. **Right-click** a row to open it, copy its path, or ask Mobius about it.
- **The sidebar** lists the workspace's folders (Notes, Docs, Sheets...) one click away.
- **Made by Mobius** collects what Mobius created, dashed until you keep it, with a count of what is waiting.
