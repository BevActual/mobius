# Privacy, safety and profiles

Mobius is a local app. Your notes, documents, tasks, mail and settings are files on your computer, and the only things
that leave it are the requests you send to the model services you chose.

## Where your data goes

| What | Where it goes |
| --- | --- |
| Your files, conversations, memory | Stay in the [data folder](../getting-started/install.md#where-your-things-are-kept) on this computer |
| What you ask, and what Mobius reads to answer | To the model service you chose. With a [local model](models-and-gateways.md#models-on-this-computer), nowhere |
| API keys | The Windows credential store. Each key is only ever sent to its own service |
| Mail | Mirrored from your mail account to this computer. Email is shown without scripts or remote images, so no tracking pixels load |

## The privacy report

**Settings › Privacy › Privacy report** shows what Mobius read and changed in the last seven days, by app, and where
your requests were answered.

**Key storage** says whether your keys are stored encrypted by Windows or, where that isn't possible, kept only until
you quit.

## The activity log

**Settings › Approvals and safety › Activity** is a record of what was asked, allowed and run. It never contains what
was typed or read. The [Activity app](../apps/assistant.md#activity) shows the same log as plain sentences, a day at a time.

## Safety rules

The rules that decide what Mobius may do are enforced by its core, not by the window, so a bug or a hostile page in the
interface cannot get around them. See [Working with Mobius](working-with-mobius.md) for the modes, and these settings:

- **Settings › Browser › Sites**: sites the agent may open without asking.
- **Settings › Browser › Network › Local addresses**: off by default, so a web page cannot steer Mobius at your router
  or a service on your network.
- **Settings › Advanced › Agent › Steps per request**: the most model calls one request may use before it is stopped. It
  applies as soon as you press Enter or leave the field.
- **Settings › Privacy › Remove my data** deletes everything Mobius keeps on this computer, then closes. It asks twice.

## Profiles

**Settings › Advanced › Profiles** keeps parts of your life apart, such as work and personal. Each profile has its own
conversations, notes, tasks, memory, schedules and settings. Downloaded local models are shared between profiles.

## Notifications

**Settings › Notifications** chooses when Mobius may tell you something while you are in another window: when it needs
you, when a request finishes, and when a download finishes. **Keep the computer awake while working** (Settings ›
General) stops the computer sleeping while Mobius is working on a request.

## Reporting a security problem

Please don't report security problems in public issues. Use
[GitHub's private vulnerability reporting](https://github.com/BevActual/mobius/security/advisories/new).
