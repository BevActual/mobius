# Mobius website (draft)

A two-page site: a home page saying what Mobius is, and the privacy policy. Google needs both on a domain the publisher
owns before Mobius can offer Sign in with Google (Drive first, Calendar later).

**Not published.** Nothing deploys this folder yet. Before it goes live:

1. Andrew registers a domain and says to publish.
2. Fill in the placeholders in `privacy.html`: `[DATE]`, `[PUBLISHER NAME]` and `[CONTACT EMAIL]`.
3. Check the policy still matches the app: which Google scopes Mobius asks for, and anything new that leaves the computer.
4. Add a GitHub Pages workflow that publishes `site/`, and a `CNAME` file with the domain.
5. Give Google the home page and privacy policy addresses on the OAuth consent screen.

Plain HTML and one stylesheet, no build step. The pictures are copies of `docs/readme/` files.
