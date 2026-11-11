# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by
[SignPath Foundation](https://signpath.org/).

## What is signed

Only the Windows installer of a Mobius release (`Mobius_<version>_x64-setup.exe`) is signed, and only when it is built
by the [Release workflow](../.github/workflows/release.yml) on GitHub Actions in this repository
([BevActual/mobius](https://github.com/BevActual/mobius)) from a version tag (`v1.2.3`). Builds made anywhere else
(on a developer's computer, in a fork, or from an unreviewed branch) are never signed.

Every signing request is submitted by that workflow to SignPath and has to be approved before the certificate is used.
The source of each signed release is the tagged commit in this repository, under the [MIT license](../LICENSE).

## Team roles

| Role      | Who                                                     |
|-----------|---------------------------------------------------------|
| Author    | Andrew Bevington ([@BevActual](https://github.com/BevActual)) |
| Reviewer  | Andrew Bevington ([@BevActual](https://github.com/BevActual)) |
| Approver  | Andrew Bevington ([@BevActual](https://github.com/BevActual)) |

Authors may change the source. Reviewers review changes from anyone else before they are merged. Approvers approve
each signing request. Everyone in these roles uses multi-factor authentication for GitHub and SignPath.

## Privacy

This program will not transfer any information to other networked systems unless specifically requested by the user or
the person installing or operating it, with one exception: it checks for updates.

- **Updates.** Shortly after it starts, and every few hours while it is open, Mobius asks GitHub for
  `https://github.com/BevActual/mobius/releases/latest/download/latest.json` to see whether a newer version exists, and
  downloads it from GitHub's release files if so. The request carries nothing about you or your work beyond what any
  download from GitHub does (your IP address and an ordinary HTTP request).
- **Everything else happens only after you set it up or ask for it:**
  - the model service you choose (for example OpenAI, Anthropic, OpenRouter, Groq, a server on your own network, or
    a model on this computer) receives your messages to Mobius and what you attach to them;
  - a speech service you choose (a server on this computer, or ElevenLabs) receives what you dictate or ask to hear;
  - the web pages you open in the browser, the mail and calendar accounts you sign in to, and the connectors (MCP
    servers) you add are reached as you use them;
  - a local model you choose to download comes from Hugging Face.
- Mobius has no analytics or telemetry, and no account with us. Your workspace, conversations and settings stay on
  your computer. Keys you enter are kept in the operating system's credential store.
