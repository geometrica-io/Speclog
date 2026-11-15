# Real-repository fixes (before 0.1.0) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Make Speclog usable on real public repositories before the first release. A dogfood scan
(REL.6, 2026-11-15) of six public repositories found:

- Every Backlog.md repository with a long task file name became a "Git error" repository on Windows,
  including Backlog.md's own repository. `git show <ref>:<path>` also stats the argument as a file and
  fails with "Filename too long" past the Windows path limit; `git cat-file` does not.
- Repositories with thousands of unmerged branches took more than 15 minutes and ended in
  "JavaScript heap out of memory" (2 GB). Agent-driven repositories open a branch per task, so this
  is Speclog's core audience. One `git show` runs per file per branch, and identical files are parsed
  again on every branch.
- A 19-branch Backlog.md repository with 785 task files still took 224 s, one process per file.
- New Backlog.md / Spec Kit users see hundreds of Attention rows (one per Unverified item, 637 in one
  repository).

**Decisions (user, 2026-11-15):** read only branches with a commit in the last 30 days (new setting
`speclog.branchDays`, default `30`, `0` = all branches); Attention shows one summary row per
repository for Unverified items instead of one row per item.

**Spec:** `docs/superpowers/specs/2026-11-11-speclog-design.md` (settings §, Attention §) — update it in
Task 2 and Task 3.

## Global Constraints

- English only; UI strings via `vscode.l10n.t` / `package.nls.json` (regenerate the l10n bundle).
- `packages/core` never imports `vscode`.
- Every git call keeps the v1 rules: `GIT_TERMINAL_PROMPT=0`, full ref names, `--end-of-options`
  where the command supports it, revision lists via `--stdin`, timeouts, cancellation.
- Reading task files never stats the working tree: no `git show <ref>:<path>`.
- LF; short imperative commit messages; no `Co-Authored-By` line; `Task-Progress: REL.6` in commit
  messages.

## Tasks

### Task 1: Read blobs through one `git cat-file --batch` process

**Files:** `packages/core/src/git/repo.ts` (or a new `packages/core/src/git/blobReader.ts`),
`packages/core/src/snapshot.ts`, tests in `packages/core/test/`.

- A blob reader per snapshot build: one long-lived `git cat-file --batch` process (stdin requests
  `<ref>:<path>` or an object id, stdout `<oid> <type> <size>\n<content>\n` or `<request> missing`).
  It honours the runner's rules (no prompt, abort signal, timeout, process-tree kill, never hangs on
  a dead child) and is closed when the build ends, also on error and cancel.
- Replace every `readBlob` / `git show` use in snapshot building with it.
- Parse each distinct blob once: cache parse results by blob object id for the duration of a build,
  so a file identical on many branches is parsed once (issues stay attributed as today).
- Tests (real git, the existing temp-repo helpers): a task file whose repository-relative path makes
  the full path longer than 260 characters is read on Windows (create it with
  `git update-index --add --cacheinfo` + `git hash-object -w`, so the working tree never holds it);
  missing paths return `null` without error; content with any bytes (CRLF, BOM, non-ASCII, a line
  `missing`) round-trips; cancel mid-read ends the process; the cache parses a shared blob once.

### Task 2: Branch window `speclog.branchDays`

**Files:** `packages/core/src/git/repo.ts` (`listOtherBranches`), `snapshot.ts`, engine config,
`packages/vscode/src/settings.ts`, `package.json`, `package.nls.json`, l10n bundle, README settings
table, spec settings list.

- Only unmerged branches whose tip commit date is within `branchDays` days of today are read
  (`0` = all). Filter in `for-each-ref` output (it already prints the committer date) before any
  per-branch git work.
- Setting `speclog.branchDays`: integer, default `30`, minimum `0`; description says what `0` does and
  that older branches neither add items nor show On branch.
- `staleBranch` Attention keeps working for branches inside the window.
- Tests: a 40-day-old branch is ignored at the default, read at `branchDays: 0`, read at `60`.

### Task 3: One Attention summary row for Unverified items

**Files:** `packages/core/src/attention.ts`, `packages/vscode` (strings, attention panel if it
renders `fileDoneNoGit`), README Attention paragraph, spec Attention section.

- Drop the per-item `fileDoneNoGit` rows; `unverifiedSummary` (already one row per repository with
  the count) stays and its UI text points at **Speclog: Trust current task files**.
- Items keep their Unverified badge in the tree; nothing else changes.
- Tests updated: no per-item rows; one summary row with the right count.

### Task 5: Address branches by tip hash

On Windows git fails with "Filename too long" when it resolves a very long ref name (for example
`refs/remotes/origin/dependabot/docker/...` in raphaeltm/simple-agent-manager): `for-each-ref` lists it from
packed-refs, but `rev-parse`/`log` stat the loose file. One such branch failed `git log --stdin` for the whole
repository. Everywhere a branch is passed to git after `for-each-ref` (log revisions, `<rev>:<path>` blob
requests, `ls-tree`), use the tip object id; the ref name stays only for display and keys.

### Task 4: Acceptance on the dogfood repositories

- Re-run the scan of the six repositories (MrLesk/Backlog.md, eser/stack, a2aproject/a2a-tck,
  pamburus/hl, raphaeltm/simple-agent-manager, re-cinq/lore) with the core, default settings.
- Pass: no repository errors, no out-of-memory, total under 60 s, and each repository under 20 s;
  record per-repository times, item counts by status and Attention counts in the task report.
- If a bound is missed, profile, report the hot spot and fix it within this branch.
