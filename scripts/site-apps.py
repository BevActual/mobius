#!/usr/bin/env python3
"""Writes the website's app pages: site/apps/index.html and site/apps/<app>/index.html.

The words live in scripts/site-apps.json. Change them there, then run

    python scripts/site-apps.py

and commit the pages it writes. The site itself has no build step; this only saves typing the same page 23 times.
Icons and screenshot descriptions are read from site/index.html, so they stay the same as the home page's.
"""
import html
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
apps = json.loads((ROOT / "scripts" / "site-apps.json").read_text(encoding="utf-8"))
home = (SITE / "index.html").read_text(encoding="utf-8")

# Home's picture is the agent shot; Messages and Store have none yet.
SHOT = {"home": "agent", "messages": None, "store": None}
GROUPS = ["Assistant", "Write and plan", "Browse and find", "Create"]

symbols = {m.group(2): m.group(1) for m in re.finditer(r'(<symbol id="i-([a-z]+)".*?</symbol>)', home, re.S)}
alts = {}
for fig in home.split('<figure role="tabpanel"')[1:]:
    m = re.match(r'\s*id="ap-([a-z]+)".*?</figure>', fig, re.S)
    alt = m and re.search(r'alt="([^"]*)"', m.group(0))
    if alt:
        alts[m.group(1)] = html.unescape(alt.group(1))
by_key = {a["key"]: a for a in apps}
e = html.escape


def sprite(keys):
    keys = list(dict.fromkeys(keys + ["download", "github"]))
    body = "\n    ".join(symbols[k] for k in keys if k in symbols)
    return ('<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">\n'
            f'  <defs>\n    {body}\n  </defs>\n</svg>')


def icon(key):
    filled = " filled" if key == "home" else ""
    return f'<svg class="ico{filled}"><use href="#i-{key}"/></svg>'


def page(title, description, path, keys, body):
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{e(title)}</title>
  <meta name="description" content="{e(description)}">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#f3f3f4" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0e0e10" media="(prefers-color-scheme: dark)">
  <link rel="canonical" href="https://mobiusworkspace.com{path}">
  <link rel="icon" href="/assets/mark.svg" type="image/svg+xml">
  <link rel="preload" href="/assets/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/style.css">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Mobius Workspace">
  <meta property="og:title" content="{e(title)}">
  <meta property="og:description" content="{e(description)}">
  <meta property="og:url" content="https://mobiusworkspace.com{path}">
  <meta property="og:image" content="https://mobiusworkspace.com/assets/social.png">
</head>
<body>
<!-- Written by scripts/site-apps.py from scripts/site-apps.json. Edit those, not this file. -->

{sprite(keys)}

<a class="skip" href="#main">Skip to content</a>

<header class="nav">
  <div class="wrap nav-in">
    <a class="brand" href="/" aria-label="Mobius Workspace, home"><img src="/assets/mark.svg" alt="" width="24" height="24"><span>Mobius</span></a>
    <nav class="nav-links" aria-label="Sections">
      <a href="/#how">How it works</a>
      <a href="/apps/"{' aria-current="page"' if path == '/apps/' else ''}>Apps</a>
      <a href="/#ai">Your AI</a>
      <a href="/#open">Open source</a>
    </nav>
    <div class="nav-end">
      <a class="icon-link" href="https://github.com/BevActual/mobius" aria-label="Mobius on GitHub"><svg class="ico gh"><use href="#i-github"/></svg></a>
      <a class="btn btn-ink btn-sm" href="/download/">Download</a>
    </div>
  </div>
</header>

<main id="main" class="app-page">
{body}
</main>

<footer class="foot">
  <div class="wrap foot-in">
    <a class="brand" href="/"><img src="/assets/mark.svg" alt="" width="20" height="20"><span>Mobius Workspace</span></a>
    <nav aria-label="Footer">
      <a href="/apps/">Apps</a>
      <a href="/download/">Download</a>
      <a href="/changelog/">What's new</a>
      <a href="/privacy/">Privacy</a>
      <a href="https://github.com/BevActual/mobius">GitHub</a>
    </nav>
  </div>
</footer>

</body>
</html>
"""


def screen(a):
    shot = SHOT.get(a["key"], a["key"])
    if not shot:
        return (f'<div class="sc-empty">{icon(a["key"])}<span>A picture of {e(a["name"])} is on the way.</span></div>')
    alt = alts.get(a["key"], f'{a["name"]} in Mobius.')
    return (f'<picture><source media="(prefers-color-scheme: dark)" srcset="/assets/shots/{shot}-dark.webp">'
            f'<img src="/assets/shots/{shot}-light.webp" width="1600" height="1000" alt="{e(alt)}"></picture>')


def card(a):
    return (f'<a class="app-card" href="/apps/{a["key"]}/"><span class="app-tile">{icon(a["key"])}</span>'
            f'<span><b>{e(a["name"])}</b>{e(a["tagline"])}</span></a>')


def app_page(i, a):
    prev, nxt = apps[i - 1], apps[(i + 1) % len(apps)]
    feats = "\n".join(
        f'        <li><h3>{e(f["title"])}</h3><p>{e(f["text"])}</p></li>' for f in a["features"])
    aside = []
    if a.get("mobius"):
        aside.append(f'<div class="app-note mob"><img src="/assets/mark.svg" alt="" width="18" height="18">'
                     f'<p><b>With Mobius</b>{e(a["mobius"])}</p></div>')
    if a.get("kept"):
        aside.append(f'<div class="app-note">{icon("files")}<p><b>Where it\'s kept</b>{e(a["kept"])}</p></div>')
    related = [by_key[k] for k in a.get("related", []) if k in by_key]
    rel = ""
    if related:
        rel = ('\n  <section class="app-section">\n    <div class="wrap">\n      <h2 class="app-h2">Works well with</h2>\n'
               '      <div class="app-grid">' + "".join(card(r) for r in related) + '</div>\n    </div>\n  </section>')
    body = f"""  <section class="app-hero">
    <div class="wrap">
      <p class="crumbs"><a href="/apps/">Apps</a><span aria-hidden="true">/</span>{e(a["group"])}</p>
      <div class="app-title"><span class="app-tile lg">{icon(a["key"])}</span><h1>{e(a["name"])}</h1></div>
      <p class="app-tagline">{e(a["tagline"])}</p>
      <p class="sub">{e(a["intro"])}</p>
    </div>
    <div class="wrap-wide">
      <figure class="window app-shot">{screen(a)}</figure>
    </div>
  </section>

  <section class="app-section">
    <div class="wrap">
      <h2 class="app-h2">What you can do</h2>
      <ul class="app-features">
{feats}
      </ul>
      {''.join(aside) and '<div class="app-notes">' + ''.join(aside) + '</div>'}
    </div>
  </section>
{rel}
  <nav class="wrap app-pager" aria-label="More apps">
    <a href="/apps/{prev["key"]}/"><span>Previous</span>{icon(prev["key"])}{e(prev["name"])}</a>
    <a href="/apps/"><span>All</span>Every app</a>
    <a href="/apps/{nxt["key"]}/"><span>Next</span>{icon(nxt["key"])}{e(nxt["name"])}</a>
  </nav>"""
    keys = [a["key"], prev["key"], nxt["key"], "files"] + [r["key"] for r in related]
    return page(f'{a["name"]} · Mobius Workspace', f'{a["name"]} in Mobius Workspace: {a["tagline"]}',
                f'/apps/{a["key"]}/', keys, body)


def index_page():
    groups = []
    for g in GROUPS:
        cards = "".join(card(a) for a in apps if a["group"] == g)
        groups.append(f'      <h2 class="app-h2">{e(g)}</h2>\n      <div class="app-grid">{cards}</div>')
    body = f"""  <section class="app-hero">
    <div class="wrap">
      <p class="kicker">Every app</p>
      <h1 class="apps-h1">{len(apps)} apps. One look. One agent.</h1>
      <p class="sub">Every app in Mobius, and what each one does. Start with the everyday six and add the rest from
        Store when you want them. Pick one to see its features.</p>
    </div>
  </section>

  <section class="app-section">
    <div class="wrap">
{chr(10).join(groups)}
    </div>
  </section>"""
    return page("Apps · Mobius Workspace", f"The {len(apps)} apps in Mobius Workspace and what each one does.",
                "/apps/", [a["key"] for a in apps], body)


out = SITE / "apps"
out.mkdir(exist_ok=True)
(out / "index.html").write_text(index_page(), encoding="utf-8")
for i, a in enumerate(apps):
    d = out / a["key"]
    d.mkdir(exist_ok=True)
    (d / "index.html").write_text(app_page(i, a), encoding="utf-8")
print(f"Wrote site/apps/ and {len(apps)} app pages.")
