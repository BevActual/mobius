# Launch checklist

What has to be true before Mobius is shared beyond a few testers, and who does each part. The order and the reasons
are in the [build plan](reference/build-plan.md#launch); this page only tracks the steps. Tick a box in the same pull
request that makes it true. Nothing is posted publicly until Andrew says so.

## In order

1. - [ ] **Launch workflow end to end on real accounts.** Mail to Tasks to Calendar: the Kestrel P2 supplier email
       becomes tasks and a calendar event, as changes you keep or discard. `e2e/demo-workflow.spec.ts` green on
       Windows, then the same on a real mail and calendar account. *Builder, Apps lead (Mail round), Launch checks*
2. - [ ] **README with every app.** *Launch*
     - [x] Every app's picture retaken in the Instrument style, light and dark.
     - [x] README and `docs/` say Mode (Agent, Ask, Plan) and Permission (Ask each time, Review changes, Apply
           changes, Auto), and Instrument as the look.
     - [ ] The app says the same: the first-run screen, Settings › Approvals and safety and Projects rules still say
           Ask first, Propose and Act, and per-app access says "Follow the mode". *Builder*
     - [ ] Retake the pictures in `docs/` that show the old frame.
     - [ ] Mark the "early" apps in the README and the app guide. *With the Apps lead*
3. - [ ] **Five-minute first run.** A fresh install reaches the first useful answer in under five minutes. *Builder,
       Launch times it*
4. - [ ] **A 60 to 90 second uncut video** of the launch workflow. Waits on app modes (Builder) and the Mail round
       (Apps lead). *Launch writes the script, Andrew records on his PC*
5. - [ ] **Signed installer.** *Builder, waiting on Andrew's SignPath application*
     - [ ] SignPath Foundation approved, `SIGNPATH_ORGANIZATION_ID` variable and `SIGNPATH_API_TOKEN` secret set, so
           the [Release workflow](../.github/workflows/release.yml) signs the installer. See the
           [code signing policy](CODE_SIGNING_POLICY.md).
     - [ ] Update-signing secrets: `TAURI_SIGNING_PRIVATE_KEY` and an empty `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
     - [ ] Installed on a clean Windows account: no SmartScreen warning, the app opens, an update installs. *Launch*
6. - [ ] **v0.1.0 published.** The `v0.1.0` tag points at 1443e30 from 2026-11-11, before the new frame and
       Instrument, so its draft is stale and the tag moves to main first. *Andrew decides and publishes, Launch writes
       the release notes and updates "Where it stands" in the README*
7. - [ ] **Calendar sign-in** (Google and Microsoft) so the workflow runs on the accounts people already have. *Builder, waiting on Andrew registering
       Mobius with each*

## Housekeeping

- [ ] GitHub social preview image uploaded (Settings, General, Social preview; image in the project files under
      `github/`). *Andrew*

## After launch: sharing, in three waves

1. 10 to 30 testers, with a short form for what broke.
2. Niche places: r/LocalLLaMA, r/selfhosted, the Hermes and Nous communities, short clips on X.
3. Show HN, then Product Hunt.

Each wave waits for the one before it and for Andrew's go.
