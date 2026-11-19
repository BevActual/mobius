# Accessibility

Every control in the shell and the shared library should be reachable by keyboard and show a visible focus. Each one
should have a name a screen reader reads, in the person's words and never a tool id. Contrast should be good in all four
themes: Light, Mid grey, Dark and Cool dark.

## The axe check

`apps/desktop/e2e/a11y.spec.ts` runs [axe](https://github.com/dequelabs/axe-core) (`axe-core`, a dev dependency) on
every pull request. It opens Home, the default apps (Notes, Tasks, Calendar, Mail, Docs, Files, Browser) and Settings,
with Mobius open beside them. It checks each against the WCAG 2.1 A and AA rules in Light, then checks colour contrast
again in Mid grey, Dark and Cool dark.

Each finding is listed in the run summary of the shard that ran the test (Actions › Windows end-to-end › the run ›
Summary), with where it was, how many elements and one example selector. Contrast findings are keyed by theme, for
example `color-contrast@dark`.

## Known findings

`apps/desktop/e2e/a11y-baseline.json` lists the findings already known, by place and rule, with how many elements each
had. Once `enforce` is true, a new finding, or a known one on more elements, fails the test. When a fix clears
a finding, lower its count or remove it, so it stays fixed. The test's log ends with every finding as JSON, ready to
paste.

The one known finding (19 November 2026) is kept on purpose. In Notes, a page row that shows a second line is named
by its title alone, and the second line is its description (`SidebarRow` with `sub`). A screen reader then reads the
title, followed by the line, without repeating it. Voice control still works, because the name is the first visible
words.
