# Speclog — Design

> **Status:** Approved by the user (2026-11-11). English translation of the approved Turkish design;
> later decision: product and repository are English-only (UI, README, docs).
> Repo: `github.com/geometrica-io/Speclog` (private; public with v1). License: MIT, copyright "Geometrica.io".
> Predecessor: `github.com/ovasoft41/ProjectManager` (C++/ImGui, personal use; "PM" in this document).

## 1. What and why

**Speclog** is an open-source overview board that shows the tasks of all of a developer's repositories
on one screen and verifies each task's status **by asking git**. Tasks are read from formats people
already use: Speclog's own `docs/tasks` format, **Backlog.md**, and **GitHub Spec Kit** `tasks.md`.

Tagline: **"Is your task list telling the truth? Speclog asks git."**

Why: developers working with AI coding agents keep their tasks in the repository (Backlog.md ~7k,
Task Master ~28k, Spec Kit ~110k stars; 2026). In those tools "done" is written into the file by a
person or an agent; an item can show "Done" before the work reaches `main`, or finished work can stay
"To Do". None of them shows several repositories on one screen (for Backlog.md it is only a feature
request: issue #1069). PM solved this for the author's 11 repositories (835 items); Speclog opens it up
to everyone.

Audience: developers working on their own independent projects, usually with AI agents, across several
repositories. Managers / team leads / customers are not a v1 target; later versions give them
**exported reports** (§7).

## 2. Goals (v1)

1. An extension for VS Code and VS Code-based editors (Google Antigravity, Cursor, Windsurf, VSCodium),
   published on the **VS Code Marketplace** and **Open VSX**.
2. Windows, macOS and Linux (WSL included) — the extension is platform-independent (pure TypeScript).
3. The equivalent of the PM screen: tree (Program / Area / Time views via a combobox), a property table
   for the selected item, filter + search, Attention list (§5).
4. Three source formats through an adapter layer: `docs/tasks` (PM format, unchanged), Backlog.md,
   Spec Kit `tasks.md` (§4).
5. Status is computed from git: `Task:` / `Task-Progress:` commit lines, "On branch", the reachable-from-
   `main` rule (§4.4). For formats whose status is written by hand (Backlog.md, Spec Kit) the file's
   status is shown as well and **flagged** when it contradicts git (§4.5).
6. The author's 11 repositories work without conversion and give **the same numbers** as PM
   (acceptance criterion, §9).

## 3. Non-goals / anti-goals

- **Speclog does not modify task files.** v1 is read-only; the only write is the "install hook" command
  the user runs explicitly. A Backlog.md / Spec Kit user's files are never touched. v1.1 (Send to agent,
  `2026-11-12-send-to-agent-design.md`) adds, each only on an explicit user action: opening a terminal
  that runs the user-configured agent command, writing the clipboard, and writing prompt files in the
  extension's own storage (`globalStorageUri/prompts/`, never inside a repository).
- Asking users to change format (anti-goal: "move your files to use Speclog").
- Requiring a server, an account or internet access (network optional, for fetch).
- Showing "Done" in the `docs/tasks` format without git evidence (failure criterion).
- In v1: reports, GitHub sign-in / cloning, CLI, MCP, advanced code evidence, agent report (§7).
- ImGui / native window: the UI is TypeScript + HTML (VS Code webview). PM lives on separately (§10).

## 4. Data model and rules

### 4.1 Common model

Every adapter converts to the same model:
`Program { path, title, id, area, created, spec, groups, items }`,
`Item { id, title, group, storedStatus, fileStatusText, size, priority, area, created, note,
depends[], spec, evidence, historyDate, historyCommit, line }`,
statuses: `open, partial, bug, verify, decision, dropped, done, onBranch` (same meaning as PM)
+ `unverified`, only for formats with hand-written status (§4.5).
IDs are unique within a repository; adapters add a prefix where needed (§4.3). ID characters:
`[A-Za-z0-9._/-]` (`/` added for Spec Kit).

### 4.2 `docs/tasks` adapter (PM format)

PM spec §4.1–§4.4 apply unchanged (file format, field table, `###` groups, inheritance, `status: done`
+ `done:` only for history, `.since` = full hash of the conversion commit). PM's parser tests are
ported to this adapter's tests. Files are read from git (not the working tree): the main-branch tip
plus branch-only items on unmerged branches (PM §4.2a).

### 4.3 Backlog.md and Spec Kit adapters

- **Backlog.md:** `backlog/tasks/*.md` (+ `backlog/completed/`; archive/draft folders read or skipped
  per the builder's reading of the current version) — YAML front matter: `id`, `title`, `status`,
  `labels`, `dependencies`, `created_date` … Status names come from `backlog/config.yml`. Mapping:
  first status (e.g. "To Do") → `open`, middle statuses (e.g. "In Progress") → `partial`, last status
  (e.g. "Done") → "done in the file". The ID is the file's `id` (e.g. `task-12`). `labels` → area
  (first label). Program: a single "Backlog" program (milestones as groups, if any). The builder records
  the supported Backlog.md version range in the docs and tests (the format may change).
- **Spec Kit:** `specs/<feature-folder>/tasks.md` — each feature folder is a program (title: folder
  name / `spec.md` title, `spec:` = the `spec.md` in the same folder). `## Phase …` headings are groups.
  `- [ ] T001 [P] [US1] Description` lines are items; `[x]` → "done in the file". ID
  `<feature-folder>/T001` (T-numbers repeat across features). `[P]`, `[USn]` markers go to note/labels.
- A repository using several formats is read in all of them; an ID clash goes to Attention.

### 4.4 Status from git (same as PM §4.3)

- `Task: <id>` in a commit body finishes an item, `Task-Progress: <id>` links it. For another repository
  `Task: <RepoName>:<id>`. Line rules identical to PM.
- Main branch: the branch `origin/HEAD` points to; otherwise `main`, then `master`. A commit counts as
  on main if reachable from `origin/<d>` **or** the local `<d>`.
- Order: closing commit on main → **Done** (date = newest closing commit); else a closing commit on an
  unmerged branch → **On branch**; else the file's status.
- Every edge case fixed in PM's final reviews is kept: full ref names, `--end-of-options`, batched git
  calls (`for-each-ref --no-merged`, `cat-file --batch-check`, one `log --name-only`, `--stdin`), keeping
  the last good data on a git error while showing GitError, showing only the error when the first scan
  fails, `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, `credential.interactive=false`, low-speed limits.
- Minimum git: 2.31 (`log --diff-merges=first-parent`; `rev-parse --end-of-options` needs 2.30). An
  older or missing git gives one clear error instead of a scan.

### 4.5 Conflict with hand-written status (Backlog.md, Spec Kit)

The status on screen always comes from §4.4. The file's status appears in the property table as a
"In file" row.

**Done in the file, no evidence in git (user decision, 2026-11-11):** a new status, **Unverified**
(`unverified`) — its own color (a calm amber, not warning red), its own filter checkbox and count
("Done 12 · Unverified 42 · Open 30"). Not counted as finished in totals.
Setting `speclog.unverifiedDone`:
- `"unverified"` — **default**, as above;
- `"done"` — count as Done, only flag it and list it in Attention (soft);
- `"open"` — ignore the file's "done", show as open (strict mode).
Does not affect the `docs/tasks` format (it has no unproven "done").

Two Attention kinds:
- **UnverifiedSummary:** done in the file, but no closing commit on main. Shown as a single **summary
  row** per repository, never one row per item (decision 2026-11-15: a Backlog.md / Spec Kit repository
  without `Task:` lines had 637 rows). The row names the count and points at **Speclog: Trust current
  task files**. The items keep their Unverified badge in the tree; in `"done"` mode they are also covered
  by this row.
- **GitDoneFileOpen:** a closing commit on main, but the file still does not say done.

In a repository that has never used `Task:` lines, every "Done" item is unverified on first open ("42
items are done in the files of this repo but have no evidence in git — how to link them"), and the user can set a per-repository
"trust file statuses before this point" cutoff (the `.since` equivalent; stored in Speclog settings, not
written to files). Items done in the file before the cutoff show as **Done (from file)** and are not
conflicts.

**Cutoff (my decision, 2026-11-11):** the cutoff is a **commit** (like PM's `.since`), not a date. When
the user runs "Speclog: Trust current task files in this repository", the current main-branch tip hash
is stored in Speclog settings (keyed by repository, §6). "Done in the file before the cutoff" = done in
the task files **as they were at that commit**. The untagged-work-commit and manual-`done`-after-cutoff
checks run **only in repositories with a cutoff** (so Backlog.md / Spec Kit users' Attention list does
not fill up before they start using `Task:`).

**Read source (my decision):** Backlog.md and Spec Kit files are also read from git (main-branch tip +
branch-only items on unmerged branches), not from the working tree — one rule: the screen shows git. If
a repository has uncommitted changes in task files, its repo row shows an info mark + one Attention row
"uncommitted task changes" (does not affect status).

**ID matching (my decision):** `docs/tasks` and Spec Kit IDs are case-sensitive; Backlog.md IDs are
case-insensitive (`task-12` = `TASK-12`); subtasks (`task-12.1`) are separate items. The supported
Backlog.md version range is the range the builder tested, stated in the README.

### 4.6 Attention list

Every PM §7 kind (stale branch, untagged work commit, evidence conflict, unknown ID, format issues,
duplicate ID, repository without task files, manual `done` after `.since`, fetch failure, git error)
+ the two kinds in §4.5. An untagged work commit is one that changes a file outside `docs/` and the task
folders of the formats the repository uses (`backlog/`, `.backlog/`, `backlog.config.yml`, `specs/`). The
shipped commit-msg hook does not know the formats: it exempts the full shared list (`docs/` and every
format's folders) in every repository. So in a repository that does not use Backlog.md, a commit that
only touches `backlog/` gets no hook warning but is listed in Attention.

## 5. Screen (v1)

- **Speclog icon in the activity bar** → opens one webview panel in the editor area ("Speclog").
  Summary in the status bar: `Speclog: 235/599 · ⚠ 1` (click opens the panel).
- Panel layout identical to PM's approved screen: top bar (View combobox, search, Filter, summary,
  Attention button), tree on the left (branch rows show `done / total`, item rows show ID · title ·
  right-aligned colored status pill), property table on the right (groups: Item, Description, Source and
  trace [+ "In file" row], Evidence), Attention panel at the bottom. All text the same size.
- Filter: status checkboxes + counts, presets (All, Open work, Done, On branch, Bugs), hidden repositories,
  size. View, filter, open branches and selection are remembered.
- Colors and fonts come from the VS Code theme (`--vscode-*` variables); readable in light / dark / high
  contrast. Keyboard navigable.
- The spec link and the task file open in VS Code (paths that stay inside the repository). Clicking a
  commit copies its hash. Opening the commit in VS Code's built-in git view is planned for later (§7).
- Language: **English only** in v1. Strings go through VS Code `l10n` so translations can be added
  later without code changes.

## 6. Sources, refresh, settings

- Scanned repositories: workspace folders open in VS Code (that are a repository or have repositories
  as direct children) + direct children of folders in the `speclog.roots` setting (PM's `C:\Antigravity`
  behavior). `speclog.exclude` (folder names), `speclog.originFilter` (empty = all; e.g.
  `github.com/ovasoft41/`). Worktrees whose `.git` is a file are not separate repositories. Roots are
  absolute paths (`~` expands to the home folder; relative entries are ignored).
- Refresh: same as PM — ref/HEAD changes are watched, a changed repository is rescanned, the UI never
  freezes (scanning is asynchronous in the extension process; heavy work may move to a worker).
- `speclog.fetch.enabled` (default on), `speclog.fetch.intervalSeconds` (300). Fetch only updates
  `origin` remote refs; never touches the working tree. A repository without `origin` is never fetched
  and shows no fetch state.
- `speclog.branchDays` (default 30, `0` = all): only unmerged branches whose tip commit is at most this many days old
  are read (inclusive); older branches are invisible (no items, no On branch, no stale row). Agent-driven repositories
  can hold thousands of unmerged branches, and reading them all ran out of memory.
- Settings in VS Code settings; UI state in `workspaceState`/`globalState`. Nothing is written to repositories.
- **Repository name and key (my decision):** the repository name is the repo name in the `origin` URL
  (e.g. `StructuralFEASuite`); without `origin`, the folder name. `Task: <Name>:<id>` resolves by name,
  case-insensitive; if two repositories share a name, `Task: <owner>/<name>:<id>` is also accepted and an
  ambiguous bare name goes to Attention. Per-repository settings (cutoff, hiding) are keyed by the
  `origin` URL (otherwise the absolute path).
- **Remote development (my decision):** the extension is `extensionKind: ["workspace"]` — it runs where
  the workspace is: local, Remote-WSL, Remote-SSH, Dev Containers. So repositories in a container
  without a display also appear on the VS Code client's screen. Scanning `\\wsl$` paths from Windows is
  not supported (use a window opened inside WSL).
- Commands: "Speclog: Open", "Speclog: Refresh", "Speclog: Install commit-msg hook in this repository"
  (a platform-independent POSIX `sh` version of PM's hook; an existing hook is kept and chained; if
  `core.hooksPath` is set it warns and does not install).

## 7. Roadmap (after v1, brief)

- **v1.x Reports:** weekly / monthly / chosen range — items closed, opened, waiting on branches;
  breakdown by repository / program / area; progress percentage and its curve over time (history
  recomputed from the git state at that date). Export: single-file HTML, PDF, Markdown. Shareable with
  managers / customers.
- **v1.1 Send to agent:** pick one item, open an agent's chat in its repository with a ready prompt
  (ID, file, note, depends, spec, `Task:` closing rule); the result is read back from git as usual.
  A convenience, not a headline. Design: `2026-11-12-send-to-agent-design.md`.
- **v2 GitHub:** sign-in through VS Code's built-in GitHub authentication provider, repository list +
  selection, lightweight clone (`--filter=blob:none`) of the selected ones into the extension's own storage.
- **v2 Agents:** `speclog` CLI (npm) and an MCP server — same core; "what is open?", "what closed in
  this session?".
- Later: open a commit in VS Code's built-in git view from the property table (v1 copies the hash),
  advanced code evidence, agent session report, progress timeline, more formats (by adding adapters).

## 8. Architecture

- Language: **TypeScript** (core + extension). Monorepo: `packages/core` (independent of VS Code, `git`
  via Node `child_process`), `packages/vscode` (extension + webview). `packages/cli` in v2.
- The core is a translation of PM's core: TaskFile → adapters, GitRunner, GitRepo, Snapshot,
  StatusEngine, Attention, ViewTree, Scheduler. Rules and **tests** are ported from PM (PM has 168 doctest
  cases + hook tests); git tests use real repositories in temporary folders.
- The extension is a single ("universal") package; no native binaries.
- CI: GitHub Actions — tests on Windows / macOS / Linux; on a tag, publish with `vsce` and `ovsx`
  (publisher ID `geometricaio`, display name "Geometrica.io").

## 9. Acceptance criteria (v1)

1. On the author's `C:\Antigravity` root, Speclog gives the same numbers as PM's `--check` output (done /
   total per repository, and the Attention count for kinds PM also has). Baseline: PM with the origin
   filter fix (§10); both tools look at the same set of repositories (Speclog's repository included).
   Attention kinds that exist only in Speclog are not compared; every other difference is either fixed
   or explained, stating which tool is right and why.
2. A sample Backlog.md repository and a sample Spec Kit repository (generated in tests) open without
   configuration, items appear, and §4.5 conflicts are flagged correctly.
3. Tests are green in CI on Windows, macOS, Linux; the extension opens in VS Code and Antigravity.
4. In a workspace of 11 repositories / ~850 items the UI does not freeze during a scan.

## 10. Relationship with PM

PM is frozen: bug fixes only. When Speclog meets §9.1, the PM repository is archived with the note
"archived, replaced by Speclog". Pending small PM fix: add a second account (`github.com/geometrica-io/`)
to the origin filter, so Speclog's own `docs/tasks` show up in PM.

## 11. Left to the builder

Webview UI library (framework-free TS or a light library), test framework, monorepo tool, bundler, exact
status color values (from VS Code theme variables), which Backlog.md folders to read (per the version's
docs), file watching method.
