# Drives

A drive is a folder on a server the person already runs or pays for, opened from Files beside the workspace. Mobius
needs no account or server of its own for it. The code is `crates/mobius-host/src/drives.rs` (WebDAV),
`crates/mobius-host/src/s3.rs` (S3-style storage) and `crates/mobius-host/src/dropbox.rs` (Dropbox).

## How it works

- **One interface, many kinds.** Every drive implements the `Drive` trait: `check`, `list`, `read`, `write`,
  `make_folder`, `rename`, `delete`. WebDAV, S3-style storage and Dropbox are the kinds so far. Others (network shares, the
  cloud drives) are other implementations, without changing the bridge, sync or the window.
- **Browsing copies nothing.** Each call goes to the server, with no local mirror. A workspace folder can also be kept in
  step with a drive folder both ways: see [Two-way sync](#two-way-sync-design).
- **Changes carry a version.** A write sends the ETag of the version it was based on (`If-Match`). If someone changed
  the file on the server since, the server answers 412 and Mobius says so (`conflict: true`) instead of writing over
  their change. A new file is sent with `If-None-Match: *`, so it never replaces one that appeared meanwhile. A move
  sends `Overwrite: F`, so it never replaces what is at the destination. A delete with a version is refused the same way.
- **Accounts** are kept in `drives.json` in the data folder; passwords in the system's secret store, only once the
  account was checked. Passwords go only to the same site, also after a redirect.
- **The bridge** (`drives.*`) is the person's own requests from the window. The agent has its own tools, below.

| Bridge call | Does |
| --- | --- |
| `list`, `add {name, server, username, password}`, `remove id` | The person's drives. For S3, `add {kind: "s3", name, server, bucket, folder?, region?, username, password}`: the service's address, the bucket, a folder in it, the access key id and its secret |
| `dropboxStatus`, `addDropbox {name?, folder?, again?}`, `dropboxCancel` | Dropbox: whether this build can sign in, and the sign-in page to open. The drive (or why not) arrives as `mobius:drive-sign-in { kind, ok, drive \| message }` |
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

## Dropbox

A folder in the person's Dropbox, or all of it, as a drive: browsing, copying and two-way sync work as on any other.

- **Sign-in** is Dropbox's own page in the browser, with PKCE and no client secret, back to
  `http://127.0.0.1:47613/dropbox` (`Callback::listen_on` in `loopback.rs`: Dropbox matches the redirect exactly, so
  the port is fixed; a second Mobius signing in at once is told the port is busy). Mobius asks for offline access, keeps
  the access and refresh tokens as the drive's secret, and refreshes the access token a few minutes before it runs out,
  or when Dropbox answers 401. A refused refresh asks the person to sign in again; `addDropbox {again: id}` renews that
  drive's tokens, and only for the same Dropbox account.
- **Accounts** are kind `dropbox`, with the folder as `dropbox:/Work/Plans` (`dropbox:/` for the whole Dropbox) and the
  email that signed in. A folder that isn't there yet is made when the drive is added.
- **Versions** are Dropbox's `rev`. A change uploads with `mode: update` and the rev it replaces, a new file with
  `mode: add` and `autorename: false`, so neither writes over a change made in Dropbox. A delete sends `parent_rev`.
  Moves use `move_v2` and never replace what is at the destination.
- **Paths** go in the `Dropbox-API-Arg` header for downloads and uploads, as JSON with everything past ASCII written as
  `\uXXXX`, as Dropbox requires.
- **Limits.** One upload request takes up to 150 MB; bigger files need an upload session, which comes later.
- **The app key** is built in from `MOBIUS_DROPBOX_APP_KEY` at build time. A build without it says Dropbox isn't set up
  in this build, and Files' Add drive form shows that under Dropbox. Registering Mobius with Dropbox is in
  [Drive and calendar sign-in](../reference/drive-sign-in.md#dropbox).
- **Tests.** `dropbox.rs` runs against a pretend Dropbox: sign-in, versions that refuse stale writes, a folder as a drive
  of its own, Drives keeping a new folder, and the two-way sync soak (`drive_sync::tests::soak`, the same one WebDAV and
  S3 pass).

## S3-style storage

Amazon S3, Cloudflare R2, Backblaze B2, Wasabi, MinIO and the rest of the services that speak the S3 API. The person
pastes an access key; nothing is registered with anyone.

- **Signing.** Every request is signed with AWS Signature Version 4 (`s3.rs`, checked against the GET example in the
  S3 API reference). A streamed body is sent as `UNSIGNED-PAYLOAD`; everything else carries its SHA-256.
- **Addresses.** An account keeps the path-style address of its folder, `https://host/bucket/folder/`, and the region.
  On `*.amazonaws.com` requests go to `bucket.host` (virtual-hosted), as AWS prefers; elsewhere the bucket is in the
  path. The region comes from the address where it names one (`s3.eu-west-2.amazonaws.com`, R2's `auto`), otherwise
  from the form, otherwise `us-east-1`.
- **Folders.** A bucket has only keys. A folder is every key under its path and a `/`; an empty one is kept as a
  zero-byte key ending in `/`, as the services' consoles make them. Listing uses ListObjectsV2 with `delimiter=/`,
  following continuation tokens.
- **Versions** are ETags, sent with `If-Match`, and `If-None-Match: *` for a new file (AWS, R2 and MinIO honour both).
  The version is also checked with a `HEAD` just before each change, so a service that ignores those headers still
  never writes over a file that changed since it was read, except in the moment between.
- **Moves** are a copy and a delete, key by key for a folder, and never over something already there. A single copy
  takes files up to 5 GB.
- **Big files** over 32 MB go up as a multipart upload in 32 MB parts, joined with the version condition. The upload is
  abandoned (`DELETE ?uploadId`) on any failure, so no parts are left to pay for.
- **Errors** come from S3's error code: a wrong key or secret says the server did not accept them (sync shows Sign in),
  a missing bucket names it, and a bucket in another region says to give its region.

## Google Drive (the files people pick)

Mobius asks Google only for `drive.file`: the files the person picks, and the ones Mobius makes. So Google Drive isn't a
drive in the list above, and has no browsing or sync. Files has **Open from Google Drive** instead
(`crates/mobius-host/src/google_drive.rs`, bridge namespace `googleDrive`):

1. **Sign in** on Google's page, with PKCE, back to a one-time page on `127.0.0.1` (`loopback.rs`). Google lets people
   untick the file access; a sign-in without it is refused with a sentence saying so.
2. **Pick.** Mobius serves Google's picker from a second page on that same port, at an unguessable path. The picked
   files' ids come back to the waiting page; closing the picker picks nothing.
3. **Open.** Each file is copied into the workspace (`Google Drive/` by default, never over a file already there) and
   remembered in `google-drive.json`: its Drive id and version, and where the copy is. The link follows the copy when
   it's renamed or moved in Files. Google Docs, Sheets, Slides and Drawings come in as Markdown, CSV, PDF and PNG copies.
4. **Save back** checks the file's version on Drive first. If it changed there, nothing is written and the answer has
   `conflict: true`. The copies of Google files aren't saved back.

The app's client ID, client secret and picker key are built in from `MOBIUS_GOOGLE_CLIENT_ID`,
`MOBIUS_GOOGLE_CLIENT_SECRET` and `MOBIUS_GOOGLE_PICKER_KEY` at build time (Google says a desktop app's secret can't be
kept secret). A build without them says Google Drive isn't set up. `tests/google_drive.rs` runs the whole flow against
a pretend Google. Files bigger than 32 MB aren't opened or saved back yet.

## Known limits and quirks

- **Big files.** Opening a drive file in an app, and the agent's `drives.*` tools, read and write a whole file in
  memory, up to 32 MB. Sync goes through files on disk a piece at a time (`Drive::read_into`, `Drive::write_from`),
  up to 16 GB. On Nextcloud and ownCloud a file over 32 MB goes up with chunked upload (v2): a folder at
  `remote.php/dav/uploads/<user>/mobius-<id>/`, numbered 32 MB pieces, then a `MOVE` of its `.file` onto the file, so a
  proxy's limit on one request (100 MB on Cloudflare) never stops it. The join compares no version, so the version is
  checked just before it; the folder is removed if anything fails. Other servers get one streamed `PUT`, limited by
  their own and their proxy's settings. A download that arrives short (a dropped connection) is never taken for the
  file: it is tried again next round.
- **Nextcloud's legacy path** `remote.php/webdav/` also works when given in full.
- **Weak ETags.** Some servers send `W/"…"`; Mobius sends the version back exactly as it got it.
- **ETags without quotes.** wsgidav and a few NAS boxes leave the quotes off `getetag` in a listing while their `ETag`
  header has them. Mobius adds them, so the same version never looks like a change and `If-Match` still matches.
- **ETags that change once a second.** wsgidav and Apache build an ETag from the file's time and size. On a server whose
  time is in whole seconds, an edit of the same size within the second keeps its ETag, so Mobius can miss it until the
  file changes again, and `If-Match` can't catch a write in that second. Nextcloud and ownCloud give each change a new
  ETag. The real-server soak test waits a second between rounds for this.
- **A new file in a missing folder.** RFC 4918 says 409; Nextcloud and ownCloud answer 404. A write with no version
  treats either as a missing folder, and sync makes the folders and writes again.
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
  (`*.mobius-tmp`), `.git` folders, and conflict copies (below). Files over 16 GB are listed as "too big to sync".
  They are skipped, never deleted.

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
- Nextcloud's sync-collection `REPORT` (RFC 6578) instead of walking.
- Line-by-line merge for text Mobius understands (notes, tasks, calendar).
- The agent reading the sync status.
