# Reports — design

**Status:** Approved by the user (2026-11-19).

Roadmap item "v1.x Reports" from `2026-11-11-speclog-design.md` §7.

## Intent

Speclog shows the state of many repositories *now*. The user wants to hand someone (a manager, a
customer, or themselves at the end of a month) a **report of a period**: how far each repository has
come, which work was finished in that period, what is in progress, what was added and what is left.
Not only numbers — the report lists the items themselves, so the reader sees *what* was done.

The numbers must be the ones Speclog itself would have shown on the board at those dates. A report that
goes to a customer cannot be approximately right.

## Goals

1. **Period.** Presets *This week*, *Last week*, *This month*, *Last month*, and a custom *From / To*
   range (dates, days precision). Weeks start on Monday. Default: *This week*.
2. **Progress per repository** at the start and at the end of the period, computed the way the board
   computes it: `total` = items not Dropped, `done` = items with status Done (Unverified is not done),
   `percent = done / total`. Shown as `start % (done/total) → end % (done/total)` and the change in
   percentage points, plus the number of items in each section below. A program breakdown under each
   repository (expandable in the editor tab, always present in exports).
3. **Progress curve** per repository (and one for the whole selection): the percentage at evenly spaced
   points across the period — every day for periods up to 31 days, otherwise at most 30 points.
4. **Item lists**, grouped by repository › program, each item with ID, title and the columns given:
   - **Finished** — Done at the end of the period and not Done at its start. Columns: closing date, closing
     commit (short hash, and subject in HTML as a tooltip/second line).
   - **In progress** — not Done at the end, and any of: status On branch at the end (only when the period
     ends today — see Constraints), status Partial at the end, or a `Task-Progress:` / `Task:` commit for it
     dated inside the period. Columns: why it is in progress (branch name(s) / "partial" / last progress
     commit date).
   - **Added** — present at the end, absent at the start. Column: created date (if any).
   - **Remaining** — every other item not Done and not Dropped at the end (Open, Bug, Verify, Decision,
     Unverified). Column: status. Long lists are collapsible in the editor tab and HTML export.
   - **Reopened / dropped / removed** — one short section, shown only when non-empty: Done at start but not
     at end; Dropped during the period; present at start and gone at end (deleted from the task files).
5. **Scope.** The report covers the repositories selected in the report tab. The selection starts as the
   repositories visible on the board (`hiddenRepos` respected) and can be changed in the tab without
   touching the board. Status / size / search filters of the board do **not** apply (a report that silently
   omits statuses would mislead).
6. **Where it lives.** Command `Speclog: Open Report` (and a button in the board's top bar) opens a
   **Speclog Report** editor tab (a second webview panel). It has the period picker, the repository
   selection, and export buttons. The tab recomputes when the period or selection changes; it does not
   follow every background rescan automatically, but shows "Data changed — Refresh" when a newer engine
   state is published.
7. **Exports.**
   - **HTML** — one self-contained file (inline CSS, inline SVG curves, no scripts needed to read it; the
     collapsible lists use `<details>`). Includes a print stylesheet: A4, no collapsing in print, page
     breaks between repositories when long.
   - **Markdown** — tables for the summary and each list; the curve is omitted (a one-line
     `start % → end %` stays).
   - **PDF** — writes the HTML export to a temporary file and opens it in the system browser
     (`vscode.env.openExternal`), where the user prints / saves as PDF. The button is labeled
     "Print / PDF…". No PDF library and no native binary.
   - Save dialogs default to `speclog-report-<from>-<to>.<ext>` in the first workspace folder.
8. **Header** of every report: title "Speclog report", the period, generation date and time, the
   repositories included, and the Speclog version.
9. **Language.** English, like every Speclog string; all text goes through `vscode.l10n.t` / the existing
   strings mechanism so it can be translated later. No Turkish.

## Non-goals

- No scheduled or automatic report generation, no e-mail, no upload.
- No per-person breakdown (Speclog does not track who did the work).
- No time estimates, burndown forecasts or velocity.
- No history of branches: On branch is known only for "now".
- No new task-file fields, no change to how statuses are resolved.
- No PDF library, no headless browser.

## Anti-goals

- Numbers that differ from what the board showed (or would have shown) on that date for items on main
  (branch-only items are deliberately outside the totals — see the rules below).
- A report that leaks repositories the user did not select.
- A slow report that blocks the board or the extension host.

## Constraints

- **Status of the past = replay of git.** For a date `D` and a repository, the state is Speclog's normal
  resolution applied to main *as it was at the end of `D`* (local time): the last first-parent commit of
  main with committer date ≤ end of `D`. Task files are read from that commit; only commits reachable from
  it count as evidence; no branches are read. Repositories are replayed together (a `Task: Repo:Id` line
  in one repository resolves against the other repositories' state at the same date), then `resolveAll`
  runs on the replayed snapshots with the current `unverifiedDone` mode and trust cutoffs.
- **The end state when the period ends today is the board's own state** (the current `EngineState`),
  restricted to items on main (see "Main only" below). When the period ends before today, the end state
  is a replay too, and On branch does not exist in it (the report says so in one line).
- A repository with no main commit at a date (not yet created) has no items at that date.
- Everything is read from git, never the working tree (as today).
- Core stays VS Code independent and unit-tested; git tests use real temporary repositories (as today).
- Replay must be cancellable and must not run on the engine's scan path; changing the period cancels the
  running computation.

## Approaches considered

1. **Replay git at each date (chosen by the user).** Accurate (same numbers as the board), handles deleted,
   dropped and renamed items and items without a `created` date. Cost: one tree listing + parses per
   repository per date; the parse cache makes unchanged files free, so a 30-point curve stays cheap.
2. **Estimate from today's data** (`created ≤ D` for total, `doneDate ≤ D` for done) — rejected: wrong for
   deleted / dropped items and for formats without `created`; not acceptable for a customer report.
3. **Record daily snapshots from now on** — rejected: no history before the feature ships.

PDF:

1. **Print-ready HTML opened in the browser (chosen by the user).** No dependencies; Unicode and SVG work.
2. **Bundled PDF library (jsPDF etc.)** — rejected: bigger package, font embedding for Unicode, charts drawn
   twice.

## Rules settled after the builder check (my calls)

- **Period bounds.** The start state is the state at the end of the day before *From*; the end state is the
  state at the end of *To*. *To* is clamped to today (presets like *This week* end today while the week is
  running); the curve never has future points.
- **Days.** A commit's day is its own committer date as Speclog already reads it (`%cs`), everywhere
  (board and report agree). "Main at the end of `D`" = the last commit on the first-parent history of the
  main tip Speclog already uses (`snap.main.tipRef`) whose `%cs` ≤ `D`. Commits reachable from it are the
  evidence.
- **Main only.** Percentages, the curve and the lists are computed over items on **main**. Items that exist
  only on an unmerged branch are not in any total; when the period ends today they are listed under
  *In progress* ("new on branch <name>"). On branch items (on main, closing commit on a branch) count as
  not done, as on the board. Consequence: the end % equals the board's percentage whenever no branch-only
  items exist; otherwise it is lower-total than the board by those items. The report footer says
  "Counts cover main; work on branches is listed under In progress."
- **Trust cutoffs and `.since`** are settings, not history: the current values are used for every date. A
  Backlog.md / Spec Kit item done in the file at `D` counts as trusted when it is also done in the file at
  the current trust commit (the same rule as today, with "now" replaced by `D`); `.since` is the one on
  today's main tip. So an item does not jump from Unverified to Done merely because the cutoff is newer
  than `D`.
- **Evidence across repositories.** All repositories Speclog knows are replayed (so `Task: Repo:Id` lines
  resolve as on the board); only the selected ones are shown or exported. Replay of the others never leaves
  memory.
- **Lists.** Finished, In progress and Remaining are disjoint (every item at the end is in exactly one, or in
  Reopened/dropped/removed). *Added* is a cross-cutting list: its items also appear in their state list, and
  are marked "new" there; the summary shows the Added count separately and never adds it to the others.

## Decided by me (the user may correct)

- Board counting rules for total / done (Dropped excluded, Unverified not done) — so start/end match the
  board.
- "In progress" includes items with a `Task-Progress:` commit in the period, not only Partial / On branch.
- Board's status / size / search filters do not apply to the report; only the repository selection.
- Report tab does not auto-refresh on every rescan; it offers a Refresh.
- Week starts Monday; curve at most 30 points.

## Left to the builder

- Core API shape, e.g. `buildSnapshotAt(repo, date, opts)` (snapshot with `programs` at the commit,
  `mainCommits` limited to its ancestors, no branches) and a pure `buildReport(start: Workspace,
  end: Workspace, curve: …, period)` returning a report model that the editor tab, HTML and Markdown
  renderers all consume.
- How to find the commit at a date (`git rev-list -1 --first-parent --before=…` or from the already-read
  `mainCommits`).
- Webview layout details, within the existing look of the board (VS Code theme colors; the HTML export
  uses a neutral light theme of its own).
- Concurrency limits and progress indication while replaying.
