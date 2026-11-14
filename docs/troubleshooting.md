# Troubleshooting

Problems people run into, and what to do. If yours isn't here, [open an issue](https://github.com/BevActual/mobius/issues/new/choose)
with what you did, what you expected and what happened.

## Installing

**Windows says "Windows protected your PC".** Early installers aren't signed yet. Choose **More info**, check the file
came from the [releases page](https://github.com/BevActual/mobius/releases), then **Run anyway**. See
[Install Mobius](getting-started/install.md#windows-protected-your-pc).

## Models

**Mobius doesn't answer, or says it can't reach the model.**

1. Open **Settings › Gateways** and check the service you use is signed in or has a key.
2. For a model on this computer, check **Settings › Models › This computer › Running now**.
3. Set a **Second model** in **Settings › Models › Defaults**, so Mobius has somewhere to turn when the first is busy or
   down.

**A local model is slow or won't start.** Choose a smaller model, or lower **Context size**: both need to fit in your
graphics card's memory, shown under **Your computer**.

**Using a Claude plan says Claude Code is not installed.** The Claude plan works through the official Claude Code
program. Install it, sign in, then choose **Check again**. See
[Models and gateways](guide/models-and-gateways.md#sign-in-to-a-plan-you-already-have).

## Mobius and your work

**Mobius keeps asking before doing things.** Your permission is **Ask each time**, or the action is one that always asks. Change the
permission in the message box. See [Working with Mobius](guide/working-with-mobius.md).

**I don't want a change Mobius made.** Choose **Discard** in the app, or **Rewind to here** in the Activity
app to go back further. The [Review](apps/review.md) app lists everything Mobius changed.

**An app is missing.** It may not be added yet. Add it from [Abilities](guide/abilities.md#apps).

## Something isn't working

**Settings › About › Versions** says whether Mobius's core is running. If it isn't, quit and reopen Mobius.

When you report a problem, include the version from **Settings › About** and your Windows version.
