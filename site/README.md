# Mobius Workspace website

The website at **[mobiusworkspace.com](https://mobiusworkspace.com)**: the home page and the privacy policy. It is live.
Google needs both pages on a domain the publisher owns before Mobius can offer Sign in with Google (Drive first,
Calendar later).

Plain HTML, one stylesheet and one small script, with no build step, no trackers and nothing loaded from anyone else.

## Look at it on your computer

The pages use root paths (`/assets/style.css`), so open them through a small local server rather than by
double-clicking the file:

```
cd site
python -m http.server 8000      # or: npx serve .
```

Then open http://localhost:8000. Switch your system between light and dark to see both looks.

## Update it

1. Make the change in `site/` on a branch and open a pull request, like any other change.
2. Once it has merged, run **Actions › website › Run workflow** (`.github/workflows/pages.yml`). It only ever runs by
   hand, so nothing goes live by accident. The site is up a minute or two later.
3. If the change touches what Mobius does with data (a new Google scope, something new that leaves the computer, a
   paid service or an account), update `privacy/index.html` and its effective date in the same pull request.

### With each release

- Add the version to the top of `changelog/index.html`, in plain words for people who use Mobius, and change the
  version in the hero's "what's new in 0.1.N" line in `index.html`.
- The Download buttons point at `https://github.com/BevActual/mobius/releases/latest`, so they never need a new
  version number. Check the platform line under the hero ("Windows 10 and 11, 64-bit · macOS is on the way") when a
  new platform ships.
- If an app is added, folded or renamed, update the **Every app** section and the count ("23 apps") in the page, its
  description and the facts row.

### Pictures

The picture at the top is not a screenshot: it is Calendar in the panel look drawn as SVG inside `index.html`, coloured
from the stylesheet's tokens, so it stays sharp at any size and follows light and dark. It follows the Calendar review
(event fills at about 14 % on light and 22 % on dark with a solid left edge, the red now line, a Mobius event with a
dashed indigo edge and the Why · Discard · Try another · Keep bar under it). Change it when Calendar's look changes.
It is drawn by `scripts/site-hero.py`: edit that, run `python scripts/site-hero.py`, and paste its output over the
`<svg class="hero-mock">` in `index.html`.

The **Every app** section shows a screen for each app (Messages and Store have none yet, so they show their icon).
The screenshots in `assets/shots/` are WebP copies of the README's pictures in `docs/readme/` (light and dark),
cut to 1600 px wide. Several still show the look from before the panel look; retake each once its app is in the new
look (`npm run readme-shots` in `apps/desktop`), then convert:

```
python -c "from PIL import Image; im = Image.open('docs/readme/apps/music-dark.png').convert('RGB'); im.thumbnail((1600, 1600)); im.save('site/assets/shots/music-dark.webp', quality=82, method=6)"
```

`assets/social.png` is the picture shown when the site is shared (a copy of `docs/readme/social-dark.png`).
`assets/fonts/inter.woff2` is Inter, the app's own typeface, under the SIL Open Font License (`LICENSE-inter.txt`).

## Hosting

GitHub Pages serves the `site/` folder at the custom domain in `CNAME`, with **Settings › Pages › Source** set to
**GitHub Actions** (the workflow above deploys it). Keep **Enforce HTTPS** ticked there.

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
| `/download/` | Download and install guide (`download/index.html`) |
| `/changelog/` | Release notes, newest first (`changelog/index.html`) |
| `/privacy/` | Privacy policy (`privacy/index.html`) |
| `/assets/` | Stylesheet, script, font, mark and pictures shared by every page |

Later sections get their own folders beside these, such as `/docs/`, `/store/` and `/account/`, without moving anything
above. Links use root paths, so the site expects to be served at the root of its own domain.

`assets/style.css` uses the app's panel-look colours ([docs/design/panel-look.md](../docs/design/panel-look.md)):
a neutral frame, panels one step above it, ink for buttons, and indigo only for Mobius, with a dashed indigo edge for
what Mobius proposes. A plain page such as the privacy policy needs no classes: a `<main>` with a `<header>`, headings,
paragraphs and tables is styled as one readable column.

The privacy policy covers only what Mobius does today. Any paid service or account adds a section to it before launch.
