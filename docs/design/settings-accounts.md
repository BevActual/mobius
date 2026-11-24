# Settings: Accounts and Back and Forward

The look for two of the Settings additions Andrew picked on 24 November 2026: a full Accounts page with one account per
provider, and Back and Forward. The Apps lead builds them; this page is what they should look like. It follows the
[design guide](guide.md) and takes macOS Internet Accounts as its reference. Where the two disagree, the guide wins.

## Accounts

### The list

- **One row per account**, not one per kind. A Google account that serves Mail, Calendar and Drive is one row.
  Accounts sort by provider, then address. The old Mail, Calendars, Drives and Chat groups go.
- **One card**, as every Settings page: rows at least 44px tall, hairlines between them, a 16px inset.
- **A row** has the provider's mark (24px, rounded 6px, the mark Settings draws today), the address in ink, and one grey
  line under it naming what the account is on for, in the apps' own names: "Mail, Calendar, Contacts". A trailing
  chevron says the row opens. The whole row is the button.
- **An account that needs you** shows a red dot before its grey line, and the line says what's wrong in a few words:
  "Sign in again". Nothing else on the page turns red.
- **Add Account…** is the last row of the card: a plus glyph in the mark's place, the words in ink, no chevron. It opens
  a sheet with one row per provider (mark and name), and choosing one starts that provider's sign-in.
- **No accounts:** the card holds one grey line, "No accounts yet.", above the Add Account… row.
- **Find more in Store →** stays below the card, as now.

### An account's page

Choosing a row opens that account in the same column, as a page of its own. The breadcrumb reads
"Connections › Accounts › {address}" and Back returns to the list.

1. **The head:** the mark at 40px, the address as the page heading, and one grey line with the provider and its
   state ("Google · Connected", or "Google · Sign in again" with the red dot).
2. **Use this account for:** a small grey heading over one card with a row per app the provider can serve (Mail,
   Calendar, Contacts, Files, Messages, Models). Each row is the app's name with a switch at its trailing edge and no
   help line. Apps the provider can't serve aren't listed. Turning the last one off doesn't remove the account.
3. **When it needs you:** a card with one row, "Sign in again", and a plain button at its trailing edge.
4. **Remove Account…** in red text at the end of the page, alone, never a one-click icon. It asks first, in a sheet
   that names what goes (its mail, calendars and files stay with the provider) with Cancel and a red Remove button.

## Back and Forward

- **Where:** the first group in Settings' tool row, as in Files: Back and Forward, the same strip buttons and glyphs,
  tooltips "Back (Alt+Left)" and "Forward (Alt+Right)", and Cmd [ and Cmd ] on macOS. The mouse's back and forward
  buttons work too.
- **State:** a button that can't go anywhere is dimmed, not hidden, so the pair never jumps. Both are dimmed when
  Settings first opens.
- **What counts as a step:** opening a section, one of its pages, an account's page or a search result. Typing in the
  search box, or changing a setting, is not a step.
- Settings has no other tools, so the row holds only this pair.
