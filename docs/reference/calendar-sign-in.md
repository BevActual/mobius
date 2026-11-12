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
2. **Enable the Google Calendar API**: APIs & Services › Library › Google Calendar API › Enable.
3. **Set up Google Auth Platform** (APIs & Services › OAuth consent screen › Get started):
   - *Branding*: app name "Mobius", support email, logo, home page, privacy policy link.
   - *Audience*: **External**. While the app is in *Testing*, add the Google accounts that may sign in as test users.
   - *Data access*: add the scope `https://www.googleapis.com/auth/calendar.events` (read and change events). Add
     `https://www.googleapis.com/auth/calendar.readonly` too if Mobius should list calendars it cannot change.
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
- **Google**: read and write through Google's CalDAV endpoint
  (`https://apidata.googleusercontent.com/caldav/v2/<calendar>/events`) with the access token. The existing CalDAV
  mirroring and change code is reused.
- **Microsoft**: read and write through Microsoft Graph (`/me/calendars`, `/me/calendarView`, `/me/events`). Events
  are converted to and from the same mirror files.
- The same rules as today: changes go to the server first and are refused if the event changed elsewhere meanwhile. The
  agent asks before adding to a calendar unless the person allowed it in Settings › Safety. Mobius never invites anyone.

Sources:
- Google: [Using OAuth 2.0 for desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app), [Google Auth Platform](https://support.google.com/cloud/answer/15544987)
- Microsoft: [Desktop app registration](https://learn.microsoft.com/entra/identity-platform/scenario-desktop-app-registration), [Graph calendar API](https://learn.microsoft.com/graph/api/resources/calendar)
