# Install Mobius

Mobius runs on **64-bit Windows 10 and 11**. A macOS build is compiled in CI but not released yet.

## Download

1. Open the [latest release](https://github.com/BevActual/mobius/releases/latest) on GitHub.
2. Download `Mobius_<version>_x64-setup.exe` (about 10 MB).
3. Run it. Mobius installs for your Windows account only, so it does not need administrator rights.

The installer puts the app and its core (`mobius-cored.exe`) side by side and adds Mobius to the Start menu.

### "Windows protected your PC"

Until code signing is in place (see the [code signing policy](../CODE_SIGNING_POLICY.md)), early installers are not
signed and Microsoft Defender SmartScreen may warn you. Choose **More info**, check that the file came from the
BevActual/mobius releases page, then choose **Run anyway**.

## Updates

Mobius checks for a new version shortly after it starts and then every four hours. When one is ready you'll see
**Update available · Restart to install** in the toolbar.

- **Settings › About › Software Update** shows the version you have and has **Check for Updates**.
- **Automatically install updates** (on by default) installs a downloaded update the next time Mobius quits.

Updates are signed, and Mobius only installs an update whose signature matches the key built into it.

## Where your things are kept

Everything stays on your computer, in the Mobius data folder:

| What | Where |
| --- | --- |
| Settings, approvals, conversations | `%APPDATA%\app.mobius.shell\` |
| Your notes, documents, tasks and other files | `workspace\` inside that folder |
| Checkpoints used to undo Mobius's changes | `checkpoints\` inside that folder |
| API keys | Windows Credential Manager, never in a file |

**Settings › About › Data folder** shows the exact path on your computer.

## Uninstall

Use **Settings › Apps › Installed apps** in Windows, find Mobius and choose **Uninstall**. The uninstaller offers to
delete the application data as well. Leave that unticked to keep your data folder, so a reinstall brings your work back.

## Build from source

To run the newest code, see [Development setup](../developers/dev-setup.md).

Next: [Your first run](first-run.md).
