"""Draws the website's hero (site/index.html): Calendar in the panel look as inline SVG coloured from site/assets/style.css."""
W, H = 1440, 880
o = []
a = o.append

def t(x, y, s, cls="m-t", anchor=None, size=None, weight=None):
    attrs = f' x="{x}" y="{y}" class="{cls}"'
    if anchor: attrs += f' text-anchor="{anchor}"'
    st = []
    if size: st.append(f"font-size:{size}px")
    if weight: st.append(f"font-weight:{weight}")
    if st: attrs += f' style="{";".join(st)}"'
    a(f"<text{attrs}>{s}</text>")

def r(x, y, w, h, cls, rx=0, extra=""):
    a(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" class="{cls}"{extra}/>')

def icon(href, x, y, s=16, cls="m-ico"):
    a(f'<use href="#{href}" x="{x}" y="{y}" width="{s}" height="{s}" class="{cls}"/>')

# Frame
r(0, 0, W, H, "m-frame")

# Title row
icon("i-calendar", 18, 10, 16, "m-ico m-ink2")
for i, m in enumerate(["File", "Edit", "View", "Go", "Calendar", "Window", "Help"]):
    t(48 + [0, 34, 68, 106, 134, 200, 260][i], 23, m, "m-t m-ink2", size=12.5)
a(f'<text x="{W/2}" y="23" text-anchor="middle" class="m-t" style="font-size:12.5px"><tspan style="font-weight:560">Calendar</tspan><tspan class="m-ink3" dx="7">Nov 23 – 29</tspan></text>')
for i, glyph in enumerate(["M0 5h10", "M0 0h10v10h-10z", "M0 0l10 10M10 0l-10 10"]):
    a(f'<path d="{glyph}" transform="translate({1336 + i * 34} 13)" class="m-stroke"/>')

# Tool row (centred group)
gx = W / 2 - 190
r(gx, 40, 380, 32, "m-tool", 8)
t(gx + 30, 61, "Today", "m-t", "middle", 12.5, 520)
a(f'<path d="M{gx+70} 50l-5 6 5 6M{gx+92} 50l5 6-5 6" class="m-stroke"/>')
a(f'<line x1="{gx+112}" y1="48" x2="{gx+112}" y2="64" class="m-hair"/>')
sx = gx + 122
r(sx, 44, 204, 24, "m-seg", 6)
for i, v in enumerate(["Day", "Week", "Month", "Year"]):
    cx = sx + 25.5 + i * 51
    if v == "Week":
        r(sx + 2 + i * 51, 46, 47, 20, "m-seg-on", 5)
    t(cx, 60, v, "m-t" if v == "Week" else "m-t m-ink2", "middle", 12, 520 if v == "Week" else None)
a(f'<line x1="{gx+338}" y1="48" x2="{gx+338}" y2="64" class="m-hair"/>')
a(f'<path d="M{gx+359} 50v12M{gx+353} 56h12" class="m-stroke"/>')
# Comments + Mobius icons at the right
a('<path d="M1370 47h16a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-9l-5 4v-4h-2a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3z" class="m-stroke"/>')
r(1398, 42, 28, 28, "m-mob-btn", 7)
icon("i-home", 1404, 48, 16, "m-mob-fill")

# Panels
P_TOP, P_BOT = 80, H - 8
def panel(x, w):
    r(x, P_TOP, w, P_BOT - P_TOP, "m-panel", 10)
panel(8, 232); panel(248, 856); panel(1112, 320)

# --- Calendars panel ---
t(24, 106, "Calendars", "m-t", size=13, weight=600)
a('<path d="M206 94v12M200 100h12" class="m-stroke"/>')
t(24, 138, "November 2026", "m-t", size=12.5, weight=560)
a('<path d="M196 129l-4 5 4 5M214 129l4 5-4 5" class="m-stroke"/>')
for i, d in enumerate("MTWTFSS"):
    t(36 + i * 28, 162, d, "m-t m-ink3", "middle", 11)
weeks = [[26, 27, 28, 29, 30, 31, 1], [2, 3, 4, 5, 6, 7, 8], [9, 10, 11, 12, 13, 14, 15],
         [16, 17, 18, 19, 20, 21, 22], [23, 24, 25, 26, 27, 28, 29], [30, 1, 2, 3, 4, 5, 6]]
for wi, wk in enumerate(weeks):
    y = 186 + wi * 24
    if wi == 4:
        r(20, y - 15, 200, 22, "m-sel", 6)
    for di, d in enumerate(wk):
        out = (wi == 0 and di < 6) or (wi == 5 and di > 0)
        cx = 36 + di * 28
        if d == 24 and wi == 4:
            a(f'<circle cx="{cx}" cy="{y-4}" r="10" class="m-ink-fill"/>')
            t(cx, y, "24", "m-t m-on-ink", "middle", 11.5, 600)
        else:
            t(cx, y, str(d), "m-t m-ink3" if out else "m-t", "middle", 11.5)
t(24, 352, "This computer", "m-t m-ink3", size=11.5, weight=560)
cals = [("Kestrel P2", "m-c-teal"), ("Work", "m-c-blue"), ("Home", "m-c-amber"), ("Tasks with due dates", "m-c-grey")]
for i, (name, c) in enumerate(cals):
    y = 380 + i * 28
    r(26, y - 9, 10, 10, c, 2.5)
    t(46, y, name, "m-t", size=12.5)
t(24, 508, "From Mobius", "m-t m-ink3", size=11.5, weight=560)
icon("i-home", 24, 524, 14, "m-mob-fill")
t(46, 536, "Suggested events", "m-t", size=12.5)
t(222, 536, "1", "m-t m-ink3", "end", 12)

# --- Week grid ---
GX, CW, Y0, HH = 312, 112, 176, 62   # gutter edge, column width, 8 AM, hour height
days = ["Mon 23", "Tue 24", "Wed 25", "Thu 26", "Fri 27", "Sat 28", "Sun 29"]
for i, d in enumerate(days):
    cx = GX + i * CW + 12
    name, num = d.split()
    t(cx, 110, name, "m-t m-ink2", size=12)
    if num == "24":
        a(f'<circle cx="{cx+42}" cy="106" r="12" class="m-ink-fill"/>')
        t(cx + 42, 110.5, num, "m-t m-on-ink", "middle", 12.5, 600)
    else:
        t(cx + 42, 110.5, num, "m-t", "middle", 12.5, 560)
a(f'<line x1="{GX}" y1="128" x2="{GX+7*CW}" y2="128" class="m-hair"/>')
# all-day row
t(GX - 10, 148, "all-day", "m-t m-ink3", "end", 10.5)
def ev(day, start, end, title, sub, c, allday=False, row=0):
    x = GX + day * CW + 3
    w = CW - 6
    if allday:
        y, h = 134 + row * 0, 20
    else:
        y = Y0 + (start - 8) * HH + 1
        h = (end - start) * HH - 2
    r(x, y, w, h, f"m-ev {c}", 5)
    r(x, y, 3, h, f"m-edge {c}", 1.5)
    t(x + 10, y + (14 if allday else 16), title, "m-t", size=11.5, weight=560)
    if sub and h > 34:
        t(x + 10, y + 31, sub, "m-t m-ink2", size=10.5)
# Build week bar Mon–Fri
x0 = GX + 3
r(x0, 134, 5 * CW - 6, 20, "m-ev m-c-teal", 5)
r(x0, 134, 3, 20, "m-edge m-c-teal", 1.5)
t(x0 + 10, 148, "Build week · Kestrel P2", "m-t", size=11.5, weight=560)
# task on Sat
a(f'<circle cx="{GX+5*CW+14}" cy="144" r="5" class="m-stroke"/>')
t(GX + 5 * CW + 24, 148, "Book the sled", "m-t m-ink2", size=11)
a(f'<line x1="{GX}" y1="160" x2="{GX+7*CW}" y2="160" class="m-hair"/>')
# hour lines
labels = ["8 AM", "9 AM", "10 AM", "11 AM", "12 PM", "1 PM", "2 PM", "3 PM", "4 PM", "5 PM", "6 PM"]
for i, lab in enumerate(labels):
    y = Y0 + i * HH
    a(f'<line x1="{GX}" y1="{y}" x2="{GX+7*CW}" y2="{y}" class="m-hair"/>')
    t(GX - 10, y + 4, lab, "m-t m-ink3", "end", 10.5)
for i in range(1, 7):
    x = GX + i * CW
    a(f'<line x1="{x}" y1="128" x2="{x}" y2="{P_BOT}" class="m-hair"/>')
# events
ev(0, 9, 9.5, "Standup", "", "m-c-blue")
ev(1, 8.67, 9.67, "Packs arrive", "8:40 AM · Dock 2", "m-c-teal")
ev(1, 9.75, 10.17, "Standup", "", "m-c-blue")
ev(1, 13, 14.5, "Design review", "1:00 PM · Sam", "m-c-blue")
ev(2, 10, 11, "Motor call", "10:00 AM · Axion", "m-c-blue")
ev(3, 12.5, 13.5, "Lunch with Priya", "12:30 PM", "m-c-amber")
ev(3, 9, 9.5, "Standup", "", "m-c-blue")
ev(4, 9, 12, "Crash test", "9:00 AM · Bay 1", "m-c-teal")
ev(4, 15, 16, "Supplier review", "3:00 PM", "m-c-blue")
ev(0, 17.5, 18.8, "Gym", "5:30 PM", "m-c-amber")
ev(5, 10, 12.5, "Sled run", "10:00 AM", "m-c-teal")

# Mobius-made event: Wed 2–3 PM, dashed indigo until kept
mx, my = GX + 2 * CW + 3, Y0 + 6 * HH + 1
r(mx, my, CW - 6, HH - 2, "m-mob-ev", 5)
t(mx + 9, my + 16, "Prep the bay", "m-t m-mob-ink", size=11.5, weight=560)
t(mx + 9, my + 31, "2:00 PM · Sam", "m-t m-ink2", size=10.5)

# Now line, Tue 10:20
ny = Y0 + (10 + 20 / 60 - 8) * HH
a(f'<line x1="{GX}" y1="{ny}" x2="{GX+7*CW}" y2="{ny}" class="m-now"/>')
a(f'<circle cx="{GX}" cy="{ny}" r="4" class="m-now-dot"/>')
t(GX - 10, ny + 4, "10:20", "m-t m-now-ink", "end", 10.5, 600)

# Floating change bar under the Mobius event
bx, by, bw = mx - 104, my + HH + 10, 330
a('<g class="m-float">')
r(bx, by, bw, 62, "m-bar", 10)
a('</g>')
icon("i-home", bx + 12, by + 10, 14, "m-mob-fill")
t(bx + 32, by + 21.5, "1 change", "m-t m-mob-ink", size=12, weight=560)
btns = [("Why", 100), ("Discard", 136), ("Try another", 194)]
for label, x in btns:
    t(bx + x, by + 21.5, label, "m-t m-ink2", size=12)
r(bx + bw - 56, by + 7, 46, 22, "m-ink-fill", 6)
t(bx + bw - 33, by + 22, "Keep", "m-t m-on-ink", "middle", 12, 600)
a(f'<line x1="{bx+10}" y1="{by+36}" x2="{bx+bw-10}" y2="{by+36}" class="m-hair"/>')
t(bx + 12, by + 52, "You asked: “Find an hour to prep the bay before Friday”", "m-t m-ink2", size=11.5)

# --- Mobius panel ---
PX = 1112
t(PX + 16, 106, "Prep before the crash test", "m-t", size=13, weight=600)
a(f'<path d="M{PX+266} 94v12M{PX+260} 100h12" class="m-stroke"/>')
a(f'<path d="M{PX+290} 95h-4v10h10v-4M{PX+292} 93h6v6M{PX+298} 93l-7 7" class="m-stroke"/>')
# your message, grey bubble on the right
r(PX + 64, 130, 240, 58, "m-sel", 14)
t(PX + 80, 153, "Find an hour for Sam and me to", "m-t", size=12.5)
t(PX + 80, 172, "prep the bay before Friday", "m-t", size=12.5)
# folded steps
a(f'<path d="M{PX+18} 214l3 3 5-6" class="m-stroke"/>')
t(PX + 34, 218, "Checked your calendar and Sam’s  ›", "m-t m-ink3", size=12)
# reply, plain text
for i, line in enumerate(["Wednesday 2 to 3 PM is free for both", "of you. I put it on Kestrel P2, so you", "can keep it or have me try another."]):
    t(PX + 16, 246 + i * 20, line, "m-t", size=12.5)
# object row for the change
r(PX + 16, 306, 288, 52, "m-mob-row", 9)
r(PX + 28, 318, 28, 28, "m-sub", 7)
icon("i-calendar", PX + 34, 324, 16, "m-ico")
t(PX + 66, 328, "Prep the bay", "m-t", size=12.5, weight=560)
t(PX + 66, 345, "Calendar · not kept yet", "m-t m-ink3", size=11)
r(PX + 244, 319, 48, 26, "m-btn", 7)
t(PX + 268, 336, "Open", "m-t", "middle", 12)
# waiting for you
t(PX + 16, 398, "Waiting for you · 1", "m-t m-ink3", size=11.5, weight=560)
r(PX + 16, 410, 288, 52, "m-card", 9)
r(PX + 28, 422, 28, 28, "m-sub", 7)
icon("i-mail", PX + 34, 428, 16, "m-ico")
t(PX + 66, 432, "Reply to Priya Nair", "m-t", size=12.5, weight=560)
t(PX + 66, 449, "Draft ready · P2 build dates", "m-t m-ink3", size=11)
r(PX + 244, 423, 48, 26, "m-btn", 7)
t(PX + 268, 440, "Open", "m-t", "middle", 12)
# chips above the composer
chips = [("What is coming up?", 16), ("Plan my week", 156)]
for label, x in chips:
    w = 8 + len(label) * 7
    r(PX + x, 736, w, 26, "m-btn", 13)
    t(PX + x + w / 2, 753, label, "m-t m-ink2", "middle", 11.5)
# composer
r(PX + 12, 772, 296, 84, "m-card", 11)
t(PX + 26, 798, "Ask about your calendar", "m-t m-ink3", size=12.5)
t(PX + 26, 840, "+", "m-t m-ink2", size=14)
t(PX + 44, 840, "Agent ▾", "m-t m-ink2", size=11.5)
t(PX + 98, 840, "Review ▾", "m-t m-ink2", size=11.5)
t(PX + 266, 840, "Best fit ▾", "m-t m-ink3", "end", 11.5)
a(f'<circle cx="{PX+288}" cy="836" r="11" class="m-sub-fill"/>')
a(f'<path d="M{PX+288} 841v-10M{PX+283} 836l5-5 5 5" class="m-stroke"/>')

svg = (f'<svg class="hero-mock" viewBox="0 0 {W} {H}" role="img" aria-labelledby="hero-mock-t">'
       '<title id="hero-mock-t">Mobius in Calendar. You asked for an hour to prep the bay before Friday; Mobius '
       'found Wednesday at 2 PM, added it with a dashed edge, and waits for you to keep it, discard it or try another.</title>'
       + "".join(o) + "</svg>")
print(svg)
