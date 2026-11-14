# Code signing options for Windows

Mobius ships a Windows installer built by Tauri (NSIS). Signing it with an Authenticode certificate tells Windows who
published it. This page compares the ways to do that for an open-source app, so Andrew can choose. SignPath is on
hold until he does (see the [launch checklist](../launch.md)).

Checked 14 November 2026. Prices change; check the linked pages before buying.

## Two facts that shape the choice

- **No certificate skips SmartScreen any more.** Since Microsoft's 2024 change, EV certificates no longer get instant
  reputation. Every signed installer, OV, EV or cloud, builds reputation as people download and run it. The first
  downloads of a new app show the "Windows protected your PC" screen whichever option is chosen; signing makes that
  reputation build up and stick to the publisher across versions. ([ToDesktop](https://www.todesktop.com/blog/posts/windows-apps-psa-ev-certs-do-not-grant-immediate-reputation-anymore),
  [Microsoft](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation))
- **Keys can't live in a file.** Code signing keys must sit on a hardware token or a cloud HSM, and certificates issued
  since 1 March 2026 last at most 460 days. Signing in GitHub Actions therefore needs a cloud service.
  ([sslinsights](https://sslinsights.com/code-signing-certificate-validity-reduced-460-days/))

Separate from all of this, the in-app updater already checks its own signature (the Tauri updater key), so updates
are safe whichever option is chosen.

## The options

| Option | Cost | Publisher shown | Signs in CI | Setup for Andrew |
| --- | --- | --- | --- | --- |
| **Unsigned** | Free | "Unknown publisher" | n/a | Nothing |
| **SignPath Foundation** | Free for open source | SignPath Foundation | Yes, already wired into `release.yml` | Apply, set up the project, add a token and org id, MFA. Each release is approved in SignPath. |
| **Azure Artifact Signing** (was Trusted Signing) | About $10 a month (Basic, 5,000 signatures) | Andrew's name or company | Yes, official GitHub action | Azure account, identity check (1 to 20 business days). **Individuals only in the US and Canada**; organizations also in the UK, EU, Australia and others. |
| **Certum Open Source (cloud)** | €49 a year | "Open Source Developer, Andrew Bevington" | Awkward: SimplySign needs a phone code per session | Order, send ID, install SimplySign on phone and PC. |
| **OV or EV certificate from a CA** (DigiCert, Sectigo, SSL.com) | About $200 to $600 a year, plus cloud key storage | Andrew's name or company | Yes, with the CA's cloud signing (extra fee) | Buy, identity check, set up cloud signing. EV needs a registered company and gives no SmartScreen advantage now. |

Sources: [Artifact Signing quickstart](https://learn.microsoft.com/azure/artifact-signing/quickstart),
[Artifact Signing pricing](https://azure.microsoft.com/pricing/details/artifact-signing/),
[Certum Open Source on SimplySign](https://shop.certum.eu/open-source-code-signing-on-simplysign.html),
[SignPath Foundation](https://signpath.org/).

### Unsigned

Testers see "Windows protected your PC", choose **More info** then **Run anyway**. Some will stop there, and on new
Windows 11 installs with Smart App Control turned on, an unsigned installer can be blocked outright. Fine for ten to
thirty invited testers who are told what to expect; not for Show HN.

### SignPath Foundation

Free and already built into our release workflow, so the fastest to finish. The trade-offs: the publisher reads
"SignPath Foundation", not Mobius or Andrew; the project must keep meeting their open-source rules (public repo, MIT,
builds only from CI); and approval is on their timeline.

### Azure Artifact Signing

Microsoft's own service, cheap, CI-friendly, and the certificate renews itself (no 460-day chore). The catch is
eligibility: as an individual, Andrew must be in the US or Canada. In the UK or another listed country it works through
a registered business with a website and an email on its domain.

### Certum Open Source

The cheapest certificate in Andrew's own name. Signing is easy by hand on his PC and hard to automate in GitHub
Actions, because SimplySign asks for a code from the phone app.

### OV or EV from a CA

The traditional route. It costs the most, and EV no longer buys anything for SmartScreen. Only worth it if a company
name in the publisher field matters and Artifact Signing isn't available.

## Recommendation

1. **Now, for the first testers:** ship unsigned and tell them about the SmartScreen screen. It costs nothing and
   blocks nothing at this stage.
2. **Before the public waves:** use **Azure Artifact Signing** if Andrew qualifies (in the US or Canada, or with a
   registered business in a listed country). It is about $10 a month, signs in CI, shows his own name, and needs no
   renewals.
3. **If he doesn't qualify:** **SignPath Foundation**, which is free and already wired in, accepting their name as
   the publisher. Pick **Certum** instead only if his own name as publisher matters more than signing in CI.

Whichever is chosen, start signing early: SmartScreen reputation builds with downloads, so the sooner signed builds go
out, the quieter the warning is by launch.
