# Mobius website (draft)

The home page and the privacy policy. Google needs both on a domain the publisher owns before Mobius can offer Sign in
with Google (Drive first, Calendar later).

**Not published.** Nothing deploys this folder yet. Before it goes live:

1. Andrew registers a domain and says to publish.
2. Fill in the placeholders in `privacy/index.html`: `[DATE]`, `[PUBLISHER NAME]` and `[CONTACT EMAIL]`.
3. Check that the policy still matches the app, including which Google scopes Mobius asks for and anything new that
   leaves the computer.
4. Add a GitHub Pages workflow that publishes `site/` at the root of the domain, and a `CNAME` file with the domain.
5. Give Google the home page and privacy policy addresses on the OAuth consent screen.

## The domain

Choose the domain for Mobius as a whole, not only for sign-in. This site is meant to grow into Mobius's home on the web:
docs, and later paid things such as sound packs and plugins for Music, add-ons for other apps, and a Mobius AI service
(build plan, #483). Those are ideas for later, and none of them is built yet.

## Layout

The addresses of the pages below stay put as the site grows, because Google and the app link to them.

| Path | What |
| --- | --- |
| `/` | Home page (`index.html`) |
| `/privacy/` | Privacy policy (`privacy/index.html`) |
| `/assets/` | Stylesheet, mark and pictures shared by every page |

Later sections get their own folders beside these, such as `/docs/`, `/store/` and `/account/`, without moving anything
above. Links use root paths (`/assets/style.css`), so the site expects to be served at the root of its own domain.

The privacy policy covers only what Mobius does today. Any paid service or account adds a section to it before launch.

Plain HTML and one stylesheet, with no build step. The pictures are copies of `docs/readme/` files.
