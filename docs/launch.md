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
     - [ ] Mark the "early" apps in the README and the app guide: any app whose moment in the
           [demo plan](reference/demo-plan.md) is still a Gap at launch. *With the Apps lead*
     - [ ] A clip beside each app (see step 4): its picture links to the clip, and the reel sits at the top.
3. - [ ] **Five-minute first run.** A fresh install reaches the first useful answer in under five minutes. *Builder,
       Launch times it*
4. - [ ] **A clip per app and a reel**, per the [demo plan](reference/demo-plan.md). Step 1 stays the cross-app run and
       its end-to-end test. *Launch writes the scripts and cuts; Andrew records the final takes or approves
       driver-recorded ones*
     - [x] The [demo workspace](../demo/README.md): one made-up team, the names from the end-to-end test.
     - [ ] Its mail, photos, footage and recording, and the "Demo workspace" profile. *Builder for the profile*
     - [ ] A clip per app: 10 to 15 seconds, uncut, light theme, 1440 by 900, from a driver script that doubles as
           the moment's test.
     - [ ] The reel: 60 to 90 seconds of the best six to eight clips, opening on Home and closing on Rewind.
5. - [ ] **Signed installer** with Azure Artifact Signing (Andrew chose it on 14 November 2026; testers get unsigned
       builds until it's in place). *Andrew sets up Azure, Launch wired the workflow*
     - [x] Release workflow signs the installer once its settings exist.
     - [ ] Artifact Signing account, identity validation, certificate profile, and the GitHub settings: the steps in
           [Setting up Azure Artifact Signing](reference/code-signing-options.md#setting-up-azure-artifact-signing).
           *Andrew*
     - [x] Update-signing secret `TAURI_SIGNING_PRIVATE_KEY` (Andrew, 14 November 2026).
     - [ ] Installed on a clean Windows account: no SmartScreen warning, the app opens, an update installs. *Launch*
6. - [ ] **v0.1.0 published** as an unsigned tester build. The tag moved to a811375 on 14 November 2026. *Andrew decides and publishes, Launch writes
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
