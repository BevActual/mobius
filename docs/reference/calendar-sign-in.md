# Calendar sign-in: what Mobius needs for Google and Microsoft

Mobius's Calendar already works with:

- its own calendars (`.ics` files in the workspace),
- subscribed calendar links (`webcal://` or `https://…ics`), which can be read but not changed,
- CalDAV accounts with an app password: iCloud, Fastmail, Nextcloud and other CalDAV servers.

Google and Microsoft (Outlook.com, Microsoft 365) do not take app passwords for calendars. Each needs the person to
sign in through the provider's own page (OAuth). To do that, Mobius needs to be **registered** with each provider, once,
by whoever publishes Mobius. Each registration gives an ID that ships inside Mobius. No secret has to be kept: both
providers treat a desktop app as a "public client" that proves itself with PKCE.

Until then, a Google or Outlook calendar can still be **subscribed to** (read only) through the private iCal address
each one offers in its calendar settings.

## Google (Google Calendar)

In the [Google Cloud console](https://console.cloud.google.com/):

1. **Create a project** (for example "Mobius").
2. **Enable the Google Calendar API and the CalDAV API**: APIs & Services › Library › each one › Enable. Mobius lists
   the calendars with the first and reads and changes events with the second.
3. **Set up Google Auth Platform** (APIs & Services › OAuth consent screen › Get started):
   - *Branding*: app name "Mobius", support email, logo, home page, privacy policy link.
   - *Audience*: **External**. While the app is in *Testing*, add the Google accounts that may sign in as test users.
   - *Data access*: add `openid`, `email` and `https://www.googleapis.com/auth/calendar`. Google's CalDAV endpoint
     takes only this whole-calendar scope.
4. **Create the client**: APIs & Services › Credentials › Create credentials › OAuth client ID › Application type
   **Desktop app**. Note the **client ID**. Google also shows a "client secret" for desktop apps. It is not treated as
   secret, but Google's token endpoint still asks for it, so it ships with the app.
5. Mobius signs in with the system browser and a loopback address (`http://127.0.0.1:<port>`). Desktop clients allow
   this without listing the address.

Things to know:

- Calendar scopes are **sensitive**. Before the app is published to everyone (Audience › Publish app), Google reviews
  it, and the review can take weeks. Until then, only test users can sign in. Google also limits the number of test
  users.
- In Testing, Google's refresh tokens **expire after 7 days**, so people have to sign in again each week until the app
  is published.

**What to send to Claude:** the client ID and the desktop "client secret".

## Microsoft (Outlook.com and Microsoft 365)

In the [Microsoft Entra admin center](https://entra.microsoft.com/) › Identity › Applications › **App registrations** ›
New registration:

1. **Name**: "Mobius".
2. **Supported account types**: *Accounts in any organizational directory and personal Microsoft accounts*. This covers
   both work accounts and Outlook.com.
3. **Redirect URI**: platform **Public client/native (mobile & desktop)**, value `http://localhost`. Mobius adds the
   port when it signs in, which Microsoft allows for `localhost`.
4. After it is made, open **Authentication**. Under Advanced settings, set **Allow public client flows** to **Yes**,
   then save.
5. **API permissions** › Add a permission › Microsoft Graph › Delegated: `Calendars.ReadWrite`, `offline_access`,
   `User.Read`. These need no admin consent for personal accounts. A work organisation may require its admin to approve
   Mobius before its people can sign in.
6. From **Overview**, note the **Application (client) ID**. No client secret is needed.

**What to send to Claude:** the Application (client) ID.

## What Mobius will do with them

- Sign in with the system browser (PKCE, loopback redirect). Keep the refresh token in the system secret store, as
  CalDAV passwords already are.
- **Google** (built, waiting on the registration): Settings › Calendar › Add a calendar › Google opens Google's page.
  Mobius lists the account's calendars with the Calendar API, then reads and writes each through Google's CalDAV
  endpoint (`https://apidata.googleusercontent.com/caldav/v2/<calendar>/events/`) with the access token, reusing the
  CalDAV mirroring and change code. Calendars shared to read only (such as holidays) show but can't be changed. When
  Google ends a sign-in (every 7 days while in Testing), the account stays and offers **Sign in again**. The client ID
  and secret are the ones Google Drive uses (`MOBIUS_GOOGLE_CLIENT_ID`, `MOBIUS_GOOGLE_CLIENT_SECRET`); Calendar keeps
  its own sign-in per account, apart from Drive's.
- **Microsoft** (built, waiting on the registration): Settings › Calendar › Add a calendar › Outlook or Microsoft 365
  opens Microsoft's page, with the same sign-in OneDrive uses, asking for `Calendars.ReadWrite` instead of the files.
  Mobius lists the calendars (`/me/calendars`, the default one first), reads each one's **calendar view** for the
  mirrored span (`/me/calendars/<id>/calendarView`, in UTC, notes as plain text), and keeps each occurrence under its
  Graph id, so changing one occurrence of a repeating event changes only that one, as in Outlook. A new event is POSTed
  (a repeating one with its pattern: daily, weekly on given days, monthly or yearly on the date), a change is PATCHed
  and a removal DELETEd, each with `If-Match` on the version read. Calendars Outlook won't let the person edit (such
  as Birthdays) show but can't be changed. The client ID is OneDrive's (`MOBIUS_MICROSOFT_CLIENT_ID`).
- The same rules as today: changes go to the server first and are refused if the event changed elsewhere meanwhile. The
  agent asks before adding to a calendar unless the person allowed it in Settings › Approvals and safety. Mobius never invites anyone.

Sources:
- Google: [Using OAuth 2.0 for desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app), [Google Auth Platform](https://support.google.com/cloud/answer/15544987)
- Microsoft: [Desktop app registration](https://learn.microsoft.com/entra/identity-platform/scenario-desktop-app-registration), [Graph calendar API](https://learn.microsoft.com/graph/api/resources/calendar)
