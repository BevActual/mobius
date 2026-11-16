# Mobius Workspace website

The home page and the privacy policy. Google needs both on a domain the publisher owns before Mobius can offer Sign in
with Google (Drive first, Calendar later).

**Not published yet.** The site is for **mobiusworkspace.com**, the public name being Mobius Workspace (build plan,
#496). The domain is registered at Cloudflare, with its DNS pointing at GitHub Pages. To publish:

1. Check that `privacy/index.html` still matches the app (its date and publisher are filled in),
   including which Google scopes Mobius asks for and anything new that leaves the computer.
2. In the repository's **Settings › Pages**, set **Source** to **GitHub Actions** and the custom domain to
   `mobiusworkspace.com`, then tick **Enforce HTTPS** once the certificate is ready.
3. Run **Actions › website › Run workflow** (`.github/workflows/pages.yml`). It only ever runs by hand.
4. Give Google the home page and privacy policy addresses on the OAuth consent screen.

DNS at Cloudflare, all set to DNS only (grey cloud) so GitHub can issue the certificate: four `A` records for `@`
(185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153) and a `CNAME` for `www` to `bevactual.github.io`.
Email Routing forwards `hello@mobiusworkspace.com`, the contact address in the privacy policy.

## The domain

The domain is for Mobius as a whole, not only for sign-in. This site is meant to grow into Mobius's home on the web:
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
