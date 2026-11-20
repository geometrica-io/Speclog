# Reports
program: REP
spec: docs/superpowers/specs/2026-11-19-reports-design.md
area: Reports
created: 2026-11-19

## REP.1 Replay main at a date
status: open
size: M
note: Snapshot of every repository at the end of a day (first-parent main, reachable commits only, current trust cutoffs and .since), resolved together.

## REP.2 Report model
status: open
size: M
note: Pure core function: start/end progress per repository and program, curve points, Finished / In progress / Added / Remaining / Reopened-dropped-removed lists, main only.

## REP.3 Report editor tab
status: open
size: L
note: Speclog: Open Report command and top-bar button; period presets and From/To, repository selection, Refresh on newer data, cancellable computation.

## REP.4 HTML export with print stylesheet
status: open
size: M
note: Self-contained file, inline SVG curves, details for long lists, A4 print CSS.

## REP.5 Markdown export
status: open
size: S

## REP.6 Print / PDF through the system browser
status: open
size: S

## REP.7 README and CHANGELOG for reports
status: open
size: S
