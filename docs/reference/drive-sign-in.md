# Drive and calendar sign-in: registering Mobius

Mobius signs in to Dropbox, Microsoft (OneDrive, Outlook calendar and mail) and Google (Drive and Calendar) on each
service's own page. That only works once Mobius is registered with each one, and only the owner of the project can do
that. This page lists what Andrew does, in one sitting, and what he hands back to the Builder.

Every registration is for a **desktop app with no server**. Mobius uses OAuth with PKCE and a redirect to its own
listener on the person's computer (`127.0.0.1` or `localhost`). Each sign-in's token is kept in the system's secret store. No
Mobius server ever sees it, and no client secret has to be kept secret.

Checked on 15 November 2026. These consoles change often, so if a screen looks different, the names below are the
ones to look for.

## In short

| Service | What it costs | How long | What it unlocks | Hand back |
| --- | --- | --- | --- | --- |
| [Dropbox](#dropbox) | Free | Minutes. Production review only starts once 50 people have linked | Dropbox in Files and sync | The app key |
| [Microsoft](#microsoft) | Free | Minutes. Publisher verification is optional and also free | OneDrive and SharePoint, Outlook calendar, Outlook mail | The application (client) ID |
| [Google](#google) | Free with `drive.file`. Full Drive access, or Gmail sign-in, adds a yearly paid security assessment (about $540 to $5,400 a year) | Minutes for testing. Google's review for the public takes days to weeks | Google Drive and Google Calendar (Gmail keeps app passwords) | The client ID and client secret |

**One decision first, for Google:** whether Mobius asks for all of a person's Drive, or only the files and folders
Mobius made or that the person picks. See [Google: which Drive access](#which-drive-access). The Builder recommends
the narrow one (`drive.file`) to start: it is free and needs only Google's basic review.

**Also needed for Google, and useful for the others:** a homepage and a privacy policy for Mobius, on a domain
Andrew owns, at two different addresses. Google checks both. Dropbox asks for a privacy policy before production.
The Docs lead can write the privacy policy. It is short, because Mobius keeps everything on the person's computer.

## Dropbox

1. Sign in at [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps) and choose **Create app**.
2. Choose **Scoped access**.
3. For access, choose **Full Dropbox**. Sync pairs any folder the person chooses, so App folder isn't enough. Dropbox
   reviews this choice at production time, so the reason goes in the request: "two-way sync of folders the person
   chooses, and browsing their files in Mobius's Files app."
4. Name it **Mobius**. A name can't be changed after production approval.
5. On the **Permissions** tab, tick these and choose **Submit**: `account_info.read`, `files.metadata.read`,
   `files.metadata.write`, `files.content.read` and `files.content.write`.
6. On the **Settings** tab, under **OAuth 2**:
   - add the redirect URI `http://127.0.0.1:47613/dropbox` (Dropbox matches it exactly, so Mobius listens on that port for Dropbox);
   - set **Allow public clients (Implicit Grant & PKCE)** to **Allow**.
7. On the **Branding** tab, add the Mobius icon (`/mnt/project-files/mobius-mark.png`).
8. **Hand back** the **App key** from the Settings tab. The app secret isn't needed: Mobius uses PKCE.

**While it is in development**, only the people listed under **Development users** can link. It works for up to 500
people. Once 50 have linked, Dropbox gives two weeks to get production approval, or new links stop. Choose
**Apply for production** on the Settings tab well before that. Dropbox only reviews a request after 50 people have
linked, unless the request asks for an early review and says why.

## Microsoft

One registration covers OneDrive, SharePoint, Outlook calendar and Outlook mail, for work, school and personal
accounts.

1. Sign in at [entra.microsoft.com](https://entra.microsoft.com). Use the account that holds the Azure signing account
   (`mobiussigning`), or any account with an Azure subscription.
2. Go to **Entra ID → App registrations → New registration**.
   - **Name:** Mobius.
   - **Supported account types:** **Any Entra ID Tenant + Personal Microsoft accounts**.
   - **Redirect URI:** leave it empty for now.
   - Choose **Register**.
3. Under **Manage → Authentication**:
   - choose **Add a platform → Mobile and desktop applications**, and add `http://localhost`;
   - under **Advanced settings**, set **Allow public client flows** to **Yes**, then **Save**.
4. Under **Manage → API permissions → Add a permission → Microsoft Graph → Delegated permissions**, add:
   `offline_access`, `User.Read`, `Files.ReadWrite.All`, `Calendars.ReadWrite`, `IMAP.AccessAsUser.All` and
   `SMTP.Send` (Mobius's Mail speaks IMAP and SMTP, so it needs those, not Graph's mail permissions).
   Don't grant admin consent: each person consents for themselves.
5. **Hand back** the **Application (client) ID** from the Overview page. No secret is needed.

**Publisher verification** (optional, free) adds a blue "verified" badge to the consent screen. Some workplaces only let
people consent to apps from verified publishers. Without verification, those people would need their IT admin to
allow Mobius. Verification needs three things:

- a Microsoft AI Cloud Partner Program account (free), with its Partner One ID;
- the app registered with a work or school account, not a personal Microsoft account;
- a domain of Andrew's own, verified in the tenant and used as the app's publisher domain.

Once those are in place, verification takes minutes. It can wait until someone reports being blocked.

## Google

### Which Drive access

Google sorts Drive access into tiers, and the tier decides the cost:

| Scope | What Mobius could reach | Google's review | Cost |
| --- | --- | --- | --- |
| `drive.file` | Files and folders Mobius made, and the ones the person opens or shares with it | Basic verification | Free |
| `drive` | The person's whole Drive | Restricted-scope review, plus a security assessment by an approved lab, **every year** | About $540 to $5,400 a year, paid to the lab (AL1 or AL2, Google decides which) |

With `drive.file`, sync works for a folder Mobius creates on the person's Drive ("Mobius/Notes"), and for files the
person opens in Mobius. It doesn't reach folders made elsewhere unless the person picks them. One solo developer with
a full-Drive app reported that saying "no server" didn't exempt them from the assessment: Google decides by the scope,
not by the architecture.

**Recommendation:** start with `drive.file`. Move to `drive` only if people ask for their existing folders, and then
budget for the yearly assessment.

Calendar scopes need Google's review too, but they aren't restricted, so there's no paid assessment. **Gmail is
different.** Mobius's Mail speaks IMAP, and IMAP with a Google sign-in needs `https://mail.google.com/`, which is
restricted: the same yearly assessment as full Drive. Gmail already works today with an app password (once 2-Step
Verification is on), so the Builder suggests leaving Gmail sign-in out of this registration and doing Drive and
Calendar only.

### Steps

1. At [console.cloud.google.com](https://console.cloud.google.com), create a project called **Mobius**.
2. **APIs & Services → Library:** enable the **Google Drive API** and the **Google Calendar API**.
3. **Google Auth Platform → Branding:**
   - App name **Mobius**, a support email, and the logo (square, 120 × 120 px, under 1 MB).
   - **Authorized domains:** Andrew's domain. Verify it in [Google Search Console](https://search.google.com/search-console)
     with the same Google account.
   - **Homepage** and **privacy policy** links, on that domain, at different addresses. The homepage must say what Mobius
     does (not only a sign-in page) and link the privacy policy.
   - Publish the branding. This check usually takes minutes.
4. **Audience:** choose **External**. Leave it in **Testing**, and add Andrew's and any testers' Google accounts as
   **test users** (up to 100).
5. **Data access:** add `openid`, `email`, `https://www.googleapis.com/auth/drive.file` (or `drive`, if that was the
   decision), and `https://www.googleapis.com/auth/calendar`.
6. **Clients → Create client → Desktop app**, named Mobius. Desktop clients use any `127.0.0.1` port, so no redirect URI
   needs adding.
7. **Hand back** the **client ID** and **client secret**. Google says a desktop app's secret can't be kept secret, so
   it ships inside Mobius like the ID. It still goes to the Builder in the thread, not into the repository by hand.

**While it is in testing**, only the listed test users can sign in, and each sign-in expires after seven days, so testers
sign in again weekly. That's enough to build and test everything.

**For everyone:** choose **Publish app** and submit for verification. Google asks for the scope justifications and a
short demonstration video (unlisted on YouTube, in English) of the whole sign-in, with the consent screen showing the
scopes. The Builder will write the justifications and record the video. Google doesn't publish a time for this review.
Expect days to a few weeks, with a round of questions or two. Full `drive` then adds the security assessment, which
takes 2 to 6 weeks a year.

## What the Builder does with them

The IDs aren't secrets. They go in the build as Mobius's own (`crates/mobius-host`, one constant per service). A
person can still put in their own ID in Settings, for a company that registers its own copy. The Builder then:

- adds the one OAuth piece every service shares (PKCE, the `127.0.0.1` redirect, tokens in the secret store);
- adds Dropbox, OneDrive and Google Drive behind the `Drive` interface, so Files and sync work on them;
- adds Google and Microsoft sign-in to Calendar, then Mail.

Until an ID arrives, each of those waits, and the [build plan](build-plan.md#drives) says so.

## Sources

- Google: [OAuth for desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app),
  [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) (updated 3 September 2026),
  [verification requirements](https://support.google.com/cloud/answer/13464321),
  [security assessment](https://support.google.com/cloud/answer/13465431),
  [app audience and test users](https://support.google.com/cloud/answer/15549945),
  [branding](https://support.google.com/cloud/answer/15549049).
- Assessment prices: [Secusy, October 2026](https://www.secusy.ai/blog/google-casa-assessment-cost),
  [DeepStrike, November 2026](https://deepstrike.io/blog/google-casa-security-assessment-2025),
  [one developer's account, July 2026](https://yurudeep.com/posts/aicoding/2026/20260717/en/).
- Microsoft: [registering an app](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app),
  [desktop app configuration](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-configuration),
  [publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview).
- Dropbox: [developer guide](https://docs.dropboxapi.com/dropbox-api/docs/developer-resources/developer-guide),
  [OAuth guide](https://docs.dropboxapi.com/dropbox-api/docs/oauth).
