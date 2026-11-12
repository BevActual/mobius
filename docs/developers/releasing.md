# Releases and updates

Mobius ships as a Windows installer through [GitHub Releases](https://github.com/BevActual/mobius/releases), and
updates itself from there.

## The installer

```
npm run package                       # the installer for this computer, at the version in the manifests
npm run package -- --version 0.2.0    # the same, as that version
```

This builds the interface, the core and the shell, then runs Tauri's bundler. On Windows the result is
`Mobius_<version>_x64-setup.exe`: a per-user NSIS installer of about 10 MB, with the core (`mobius-cored.exe`)
installed beside the app. Release-only settings are in `crates/mobius-shell/tauri.release.conf.json`.

The Chromium (CEF) build is not packaged yet (it would add about 330 MB); releases use the system web view (WebView2).

## Making a release

1. Push a version tag: `git tag v0.2.0 && git push origin v0.2.0`.
2. The **Release** workflow ([`release.yml`](../../.github/workflows/release.yml)) builds the installer on Windows,
   signs it through SignPath when that is set up, creates the updater files from the installer as shipped, and puts
   everything in a **draft** GitHub Release for the tag.
3. Check the draft and **Publish** it. The updater only sees published releases.

## Code signing

Windows installers are signed under the [code signing policy](../CODE_SIGNING_POLICY.md): free code signing provided by
SignPath.io, certificate by SignPath Foundation. Only installers built by the Release workflow from a tag in this
repository are signed, and each signing request must be approved.

The workflow needs the repository variable `SIGNPATH_ORGANIZATION_ID` and the secret `SIGNPATH_API_TOKEN`. Until the
variable is set, the installer is released unsigned and SmartScreen warns about it.

## The updater

Mobius uses `tauri-plugin-updater`, reading `releases/latest/download/latest.json` from this repository.

- The shell checks 20 seconds after start and then every four hours. When an update is ready, the toolbar shows
  **Update available · Restart to install**.
- **Settings › About › Software Update** shows the version and has **Check for Updates**. **Automatically install
  updates** (on by default) installs a downloaded update the next time Mobius quits.
- The updater is off in development builds, in tests, and when `MOBIUS_NO_UPDATES` is set.

### Updater signatures

Every update is signed with a key whose public half is in `crates/mobius-shell/tauri.conf.json`
(`plugins.updater.pubkey`). The Release workflow needs the secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty if the key has none). The updater signature is made **after** Authenticode
signing, because signing changes the file.

Locally, set the same two variables before `npm run package` to also build the updater files. Without them the
installer is still built.
