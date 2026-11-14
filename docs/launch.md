# Launch checklist

What has to be true before Mobius is shared beyond a few testers, and who does each part. Tick a box in the same pull
request that makes it true. Nothing is posted publicly until Andrew says so.

**The bar:** one workflow, Mail to Tasks to Calendar, works on real accounts from a fresh install, and an uncut 60 to 90
second video shows it. Mail, Calendar, Tasks, Notes and Docs are solid; the other apps are labelled "early".

## 1. The demo

The Kestrel P2 build at Northway Motors: an email from a supplier becomes tasks and a calendar event, all as changes you
keep or discard.

- [ ] The workflow passes end to end in the app (`e2e/demo-workflow.spec.ts` green on Windows). *Builder*
- [ ] It works on a real mail and calendar account, not only preview data. *Builder, Launch*
- [ ] A fresh install reaches the first useful answer in under 5 minutes, with a guided first run. *Builder*
- [ ] Record the uncut 60 to 90 second video on Andrew's PC. *Launch prepares the script, Andrew records*

## 2. README and docs

- [x] Every app's README picture retaken in the Instrument style, light and dark. *Launch*
- [x] README says the composer's permissions the new way (Ask each time, Review changes, Apply changes, Auto). *Launch*
- [x] `docs/` says the same: the guide, first run, shortcuts, glossary, troubleshooting and app pages. *Launch*
- [ ] The app says the same: the first-run screen, Settings › Approvals and safety, and Projects rules still say Ask
      first, Propose and Act, and per-app access says "Follow the mode". *Builder*
- [ ] Retake the pictures in `docs/` that show the old frame. *Launch*
- [ ] Mark the "early" apps in the README and the app guide. *Launch, with the Apps lead*
- [ ] "Where it stands" in the README matches the release that ships. *Launch*
- [ ] GitHub social preview image uploaded (Settings, General, Social preview; image in the project files under
      `github/`). *Andrew*

## 3. The release

- [ ] Decide what 0.1.0 is. The `v0.1.0` tag points at 1443e30 from 2026-11-11, before the new frame and the
      Instrument style, so its draft release would ship an old Mobius. *Andrew decides*
- [ ] Repository secrets for update signing: `TAURI_SIGNING_PRIVATE_KEY` and an empty
      `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. *Andrew*
- [ ] SignPath Foundation approved, `SIGNPATH_ORGANIZATION_ID` variable and `SIGNPATH_API_TOKEN` secret set, so the
      [Release workflow](../.github/workflows/release.yml) signs the installer. See the
      [code signing policy](CODE_SIGNING_POLICY.md). *Andrew*
- [ ] Install the built installer on a clean Windows account: no SmartScreen warning, the app opens, and an update from
      the previous version installs. *Launch, on Andrew's PC*
- [ ] Release notes written. *Launch*
- [ ] Publish the release. *Andrew*

## 4. Sharing, in three waves

- [ ] 10 to 30 testers, with a short form for what broke.
- [ ] Niche places: r/LocalLLaMA, r/selfhosted, the Hermes and Nous communities, short clips on X.
- [ ] Show HN, then Product Hunt.

Each wave waits for the one before it and for Andrew's go.
