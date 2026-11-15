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
- **The bridge** (`drives.*`) is the person's own requests from the window. The agent's drive tools are a separate step;
  every change they make on a server asks first, whatever the permission mode.

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

## Notes for two-way sync (later)

Written down as the drives work went in, for the decision on syncing workspace folders with a drive:

- The per-file ETag gives safe single-file writes, but sync needs to find what changed in a whole folder. Nextcloud
  offers `oc:etag` on folders (changes when anything below changes) and a sync-collection `REPORT` (RFC 6578); plain
  WebDAV servers need a full `PROPFIND` walk and a stored ETag per file.
- A conflict is both sides changing the same file since the last sync. Two ways to settle it: keep both (the
  server's copy beside the person's as `name (conflict from <server>).ext`, as Nextcloud's own client does), or ask in
  the review bar. Text files Mobius understands (notes, tasks, calendar) could merge line by line instead.
- A delete on one side and a change on the other should keep the changed file, never lose it.
- Moves cannot be told from a delete plus a new file over plain WebDAV; a rename on the server looks like both. The
  workspace's checkpoints already record moves, so moves made in Mobius can be sent as `MOVE`.
- Checkpoints give an undo for what sync changed locally; nothing gives one on the server, so a sync that would delete
  many files there should ask first.
