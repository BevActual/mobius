# Drives

A drive is a folder on a server the person already runs or pays for, opened from Files beside the workspace. Mobius
needs no account or server of its own for it. The code is `crates/mobius-host/src/drives.rs`.

## How it works

- **One interface, many kinds.** Every drive implements the `Drive` trait: `check`, `list`, `read`, `write`,
  `make_folder`, `rename`, `delete`. WebDAV is the first kind. S3-style storage and network shares (SMB) can be added as
  other implementations without changing the bridge or the window.
- **Nothing is copied.** Each call goes to the server. There is no local mirror and no sync, so there is nothing to keep
  in step and no conflicts to merge. Two-way sync of workspace folders is a later step and a decision for Andrew.
- **Changes carry a version.** A write sends the ETag of the version it was based on (`If-Match`). If someone changed
  the file on the server since, the server answers 412 and Mobius says so (`conflict: true`) instead of writing over
  their change. A new file is sent with `If-None-Match: *`, so it never replaces one that appeared meanwhile. A move
  sends `Overwrite: F`, so it never replaces what is at the destination. A delete with a version is refused the same way.
- **Accounts** are kept in `drives.json` in the data folder; passwords in the system's secret store, only once the
  account was checked. Passwords go only to the same site, also after a redirect.
- **The bridge** (`drives.*`) is the person's own requests from the window. The agent has its own tools, below.

| Bridge call | Does |
| --- | --- |
| `list`, `add {name, server, username, password}`, `remove id` | The person's drives |
| `browse id folder` | Folders first, then files, with size, date and version |
| `read id path` | The file as base64, with its version (up to 32 MB) |
| `write id path {base64 \| text} etag?` | Replace that version, or make a new file |
| `mkdir id path`, `move id from to`, `delete id path etag?` | As named |
| `download id path folder` | Files: a copy of the drive's file in the workspace `folder`, under a free name |
| `upload id path folder` | Files: a copy of the workspace file `path` in the drive's `folder`; never replaces one |

Changes are announced as `mobius:drives-changed { drive, path, by }`.

### The agent's tools

| Tool | Capability | Does |
| --- | --- | --- |
| `drives.list` | `drives.read` | The person's drives, or a folder's contents with sizes, dates and versions |
| `drives.read` | `drives.read` | A text file with its version (up to 200 KB); other files are described |
| `drives.fetch` | `files.write` | Copies a drive file into the workspace, never replacing one, so the turn's review can discard it |
| `drives.write` | `drives.write` | Writes text or a workspace file. Replaces only at the version given; makes missing folders |
| `drives.move`, `drives.delete` | `drives.write` | As named; a move never replaces |

`drives.write` is a **floor** in the core's policy, like `process.exec`: the person approves each change on a server,
in every approval mode, because nothing in Mobius can undo it there. Read text from a drive counts as untrusted, and a
`drives.write` that it asks for is treated as consequential.

## Servers

| Server | Address to give | Notes |
| --- | --- | --- |
| Nextcloud, ownCloud | The server's address alone | Mobius looks at `remote.php/dav/files/<user>/` when the address has no path. Needs an app password when two-step sign-in is on. |
| Fastmail Files | `https://myfiles.fastmail.com/` | App password with Files access. |
| Synology, QNAP | The WebDAV address set up on the NAS | Usually its own port (5005 / 5006 on Synology). |
| Apache `mod_dav`, nginx | The WebDAV folder | A folder named without its final `/` is redirected; Mobius follows. |

## Known limits and quirks

- **Big files.** One request carries a whole file, up to 32 MB. Nextcloud's chunked upload (v2:
  `remote.php/dav/uploads/<user>/<id>/`, numbered chunks, then a `MOVE` of `.file`) is how larger files go; it is not
  built yet. Plain PUT on Nextcloud is limited by the server's PHP and proxy settings, not by WebDAV.
- **Nextcloud's legacy path** `remote.php/webdav/` also works when given in full.
- **Weak ETags.** Some servers send `W/"…"`; Mobius sends the version back exactly as it got it.
- **Servers that ignore `If-Match`.** A few minimal servers do; on those a change can overwrite someone else's. Nextcloud, ownCloud
  and Apache honour it; nginx's WebDAV module is worth checking before relying on it.
- **Folder versions.** A folder's ETag changes when anything in it changes on Nextcloud, but not on every server, so it
  is not used to tell whether a listing is fresh.

## Two-way sync (design)

Andrew chose to start sync on 2026-11-15. This is the design for the first version. The code will be
`crates/mobius-host/src/drive_sync.rs`.

### Built on the `Drive` trait, for every kind of drive

Sync uses only the `Drive` trait, never WebDAV directly, so S3-style storage, Dropbox, OneDrive and Google Drive (which
Andrew asked for on 2026-11-15) can sync once they implement it. The trait grows by what those services need:

- **A version, not an ETag.** `Entry::etag` becomes `version`. It is an opaque string sent back to guard a change: an
  ETag for WebDAV and S3, a revision for Dropbox and Google Drive, a cTag or eTag for OneDrive. A drive that can't
  guard a change by version says so (`guards_versions() == false`). Sync then reads the version just before writing,
  and accepts the small gap.
- **Ids beside paths.** `Entry` gains `id: Option<String>`. Google Drive lets two files share one name in a folder,
  so sync keys its base by id where there is one, and by path where there isn't. Two files with the same name are
  synced as `name` and `name (2)` locally, with the base recording which id is which.
- **A change feed where there is one.** `changes(since: Option<&str>) -> Res<Option<(Vec<Change>, String)>>` returns
  what changed since a cursor, and the next cursor. Google Drive has its changes list, OneDrive has delta, Dropbox has
  a list-folder cursor, and Nextcloud has sync-collection `REPORT`. `None` means the drive has no feed, so sync falls
  back to listing.
- **Service documents are links, never files.** A Google Doc, Sheet or Slides file has no bytes to download. `Entry`
  gains `link: Option<String>`. Files shows such a file with its link to open in the browser, and sync leaves it alone
  on both sides.
- **Sign-in on the service's own page.** One OAuth piece for every service: PKCE, a loopback redirect on
  `127.0.0.1`, and the refresh token in the system's secret store, with access tokens refreshed as needed. Calendar
  sign-in for Google and Microsoft uses the same piece. A drive account records which sign-in it uses (an app
  password or a token), and `check` says plainly when the sign-in has to be done again.


- **A workspace folder, paired with a folder on a drive.** The person turns it on per folder from Files (for example,
  `notes` with `Cloud / Notes`). It is off by default. A folder is in at most one pair, and pairs don't nest. Pairs
  are kept in `drive-sync.json`.
- **The workspace folder stays the working copy.** Every app, the agent's tools, Review and Rewind keep working on
  local files as now. Sync only moves changes between the folder and the server.
- **Left out:** names the systems make (`.DS_Store`, `Thumbs.db`, `desktop.ini`, `~$*`), Mobius's temp files
  (`*.mobius-tmp`), `.git` folders, and conflict copies (below). Files over 32 MB are listed as "too big to sync"
  until chunked upload is built. They are skipped, never deleted.

### How changes are found

Each pair keeps a **base**: for every file, its SHA-256 and the server's ETag when the two last matched. Stat data is
kept beside it so unchanged files aren't hashed again. A change is a different hash locally, or a different ETag on the
server. Times are only used to skip hashing, never to decide what changed.

- **Local:** walk the folder, and hash a file only when its size or time differs from the base.
- **Server:** `PROPFIND` one level at a time. On Nextcloud and ownCloud, a folder's ETag changes when anything below
  it changes, so an unchanged folder is skipped. Other servers get a full walk.
- **When:** a minute after the last local change, every 5 minutes while Mobius is open, when Files opens, and on Sync
  now.

### What each case does

| Local since base | Server since base | Result |
| --- | --- | --- |
| changed or new | same or absent | `PUT` with `If-Match` the base ETag (`If-None-Match: *` for a new file) |
| same | changed or new | `GET`, then write locally (temp file, then rename) |
| changed | changed | Same bytes: update the base only. Different: a **conflict** |
| deleted | same | `DELETE` with `If-Match` the base ETag |
| same | deleted | Delete locally |
| deleted | changed | **Keep the edit:** download it again |
| changed | deleted | **Keep the edit:** upload it again, as new |

- **A conflict keeps both and says so.** The server's version keeps the name, because someone else may be using it.
  The local version is renamed `name (conflict, Mobius, 2026-11-15 14.32).ext` beside it, as Nextcloud's own client
  does. Conflict copies are never uploaded. Files shows a conflict line with Open both, Keep mine (uploads it under the
  name) and Keep theirs (deletes the copy).
- **A `412` from the server** means it changed in between: that file is looked at again next round, never forced.
- **Many deletes ask first.** If a round would delete more than 10 files, or more than a quarter of the pair, on
  either side, the pair pauses and Files asks: "Delete 40 files on Cloud?" with Delete and Keep them.
- **Moves.** Over plain WebDAV, a move on the server looks like a delete plus a new file, and is handled that way, with
  the guard above. Moves made in Mobius are sent as `MOVE` (with `Overwrite: F`), because the checkpoints record them.
  That part comes after the first version.

### Mobius's changes, Review and Rewind

- **An agent's change waits for Keep.** Files the agent changed in a turn that hasn't been kept are held: not
  uploaded, and Files says "3 wait for Keep". Keep releases them: the window tells the host which paths were kept
  (`changes.kept`). Discard puts the file back as it was, so it matches the base again and there is nothing to send.
  Nothing unreviewed reaches the server. Only each conversation's newest turn waits: when the next turn starts, Review
  leaves the earlier one behind, and so does sync. Turns from before a folder was paired never hold it.
- **What sync brings in can be undone.** Before a round writes or deletes local files, the workspace takes a
  checkpoint ("Before sync from Cloud"). Rewind can go back past it like any other.
- **Rewind and Discard are local changes like any other.** They are sent on the next round. When a Rewind would change
  files in a synced folder, its confirmation says so first: "This also changes 4 files on Cloud". Rewinding a file
  that was deleted on the server puts it back there too.

### Offline, errors and resume

- The base is saved after every file that goes through, so a round cut off by a quit, a crash or the network
  resumes where it stopped. A partial `PUT` leaves nothing on Nextcloud, because it writes to a `.part` file first.
- With no network, or when the server is unreachable, a round tries again after 1, 2, 5 and then every 10 minutes.
  A sign-in that stopped working pauses the pair and asks for the app password again.
- Each pair has a status in Files: Up to date · Syncing 3 of 12 · 2 wait for Keep · 1 conflict · Offline, trying again
  in 2 minutes · Paused. Pause, Resume and Sync now sit beside it.

### In the code

- `drive_sync.rs`: the round, the base, conflicts, the delete guard, and which of the agent's changes are held.
- `sync_pairs.rs`: the pairs (`drive-sync.json`, each base in `drive-sync/<id>.json`), their status, and the worker.
- The bridge: `drives.syncPairs`, `syncAdd(folder, drive, remote)`, `syncRemove`, `syncPause(pair, paused)`, `syncNow`,
  `syncAllowDeletes`, `syncKeepThem` and `syncResolve(pair, path, 'mine' | 'theirs')`, and the event
  `mobius:drive-sync { pair, status }`. Types are `SyncPair` and `SyncStatus` in the shared package.
- The soak test, `soak_hundreds_of_files_edited_on_both_sides_lose_nothing`, runs 300 files through eight rounds of edits,
  deletes and new files on both sides. Every other round is cut off a third of the way, and there is a Rewind in the
  middle. After each round, both sides must hold every edit, and our side of each conflict must be kept as a copy.
- `changes.kept(conversation, start, folder)` comes from Keep in the window. `changes.rewindPreview` says how many of
  the files are in synced folders (`synced`).

### First version and later

**First version:**

- Pairing a folder from Files.
- The base and the round, for both directions.
- The table above, including conflicts and the delete guard.
- Holding the agent's changes until Keep.
- The checkpoint before sync.
- Offline and resume.
- The status line, with Pause and Sync now.

It is built and tested against the fake WebDAV server (extended for `If-Match`, deletes and listings), then against a
real Nextcloud if one is available.

**Later:**

- `MOVE` for moves made in Mobius.
- Chunked upload over 32 MB.
- Nextcloud's sync-collection `REPORT` (RFC 6578) instead of walking.
- Line-by-line merge for text Mobius understands (notes, tasks, calendar).
- The agent reading the sync status.
