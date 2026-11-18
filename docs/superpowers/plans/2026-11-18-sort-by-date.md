# Sort by Created or Last Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Sort combobox (Created / Last activity, ↑ / ↓) that orders the tree in every view and makes the Time view group by the chosen date, so today's branch work shows under today.

**Architecture:** Core gets a pure `lastActivity(r)` and a `SortOrder` parameter on `buildTree`; the default reproduces today's trees exactly. The extension adds the combobox to the top bar, keeps the choice in workspaceState next to the view, and shows a `Last activity` property row.

**Tech Stack:** TypeScript (strict), vitest, VS Code webview.

**Spec:** `docs/superpowers/specs/2026-11-18-sort-by-date-design.md`

## Global Constraints

- English only; every UI string through `vscode.l10n.t` / `package.nls.json`; regenerate the l10n bundle (bundle tests must pass).
- `packages/core` never imports `vscode`.
- Dates are `YYYY-MM-DD` days; no time of day.
- Default sort `created-asc` must leave every existing tree byte-for-byte as today (existing viewTree tests pass unchanged).
- Commits: LF, short imperative, `Task-Progress: FIX.2` (the last one `Task: FIX.2`), no `Co-Authored-By`.

## Review Focus

- Items with no valid created date and no commits: sort last in both directions, Time view keeps `(no date)` last.
- Ties (same date): keep today's order (stable sort), in every view.
- An item whose only commits are on an unmerged branch (On branch / branch-only): its branch commit date counts as last activity.
- A stored sort value from an older or tampered workspaceState: falls back to `created-asc`.
- Switching sort keeps the expanded/selected rows of the current view where their keys still exist (Time view keys change with the date; that is acceptable).

---

### Task 1: Core — last activity and sorted trees

**Files:**
- Modify: `packages/core/src/viewTree.ts` (`buildTree`, `buildTime`, leaf ordering in program/area/time)
- Test: `packages/core/test/viewTree.test.ts`

**Interfaces:**
- Produces:
  - `export type SortOrder = 'created-asc' | 'created-desc' | 'activity-asc' | 'activity-desc';`
  - `export const SORT_ORDERS: readonly SortOrder[]` (in that order) and `export const DEFAULT_SORT: SortOrder = 'created-asc';`
  - `export function lastActivity(r: ResolvedItem): string` — newest valid date of `r.item.created`, every `r.commits[].date`, `r.doneDate`; `''` when none is valid.
  - `buildTree(ws, mode, f, sort: SortOrder = DEFAULT_SORT): TreeNode`

- [ ] **Step 1: Write failing tests** in `viewTree.test.ts`:
  - `lastActivity picks the newest of created, commit dates and done date` — created `2026-11-13`, commits `2026-11-15`, `2026-11-18` → `'2026-11-18'`; no valid dates → `''`; invalid commit date ignored.
  - `default sort leaves every view unchanged` — for each mode, `buildTree(w, m, f)` deep-equals `buildTree(w, m, f, 'created-asc')`.
  - `time view groups by last activity` — item created `2026-11-13` with a branch commit `2026-11-18` lands under `t/2026-11/2026-11-18` with `activity-*`, under `2026-11-13` with `created-*`.
  - `descending orders newest group first and (no date) last` — `created-desc` root children: `2026-11` before `2026-10`, `(no date)` last; days within a month newest first.
  - `program and area views order items inside a group by the chosen date` — two items in one program, A created `2026-11-01`, B created `2026-11-05` with a commit `2026-11-18`: `activity-desc` → B, A; `created-asc` → file order; equal dates keep file order.
- [ ] **Step 2:** `npx vitest run --root packages/core test/viewTree.test.ts` → FAIL (`lastActivity`/sort not defined).
- [ ] **Step 3: Implement** in `viewTree.ts`: date key per item = `created` for `created-*`, `lastActivity(r)` for `activity-*`; `buildTime` groups by that key; after building, stable-sort leaf siblings by the key (direction from the order; empty key last), skipping the re-sort for `created-asc` so today's order is untouched; group (month/day) order follows the direction, `(no date)` / `(no area)` stay last. Export the new names from `index.ts` if it does not re-export the module already.
- [ ] **Step 4:** same command → PASS; `npm run build && npm test` green.
- [ ] **Step 5: Commit** `Sort the tree by created or last activity` (`Task-Progress: FIX.2`).

### Task 2: Extension — Sort combobox, state and property row

**Files:**
- Modify: `packages/vscode/src/protocol.ts` (`setSort` message, `sort` in state, string keys), `packages/vscode/src/uiState.ts` (persist + validate `sort`), `packages/vscode/src/host.ts` (handle `setSort`, pass `this.ui.sort` to both `buildTree` calls), `packages/vscode/src/dto.ts` (`lastActivity` on item details), `packages/vscode/src/strings.ts`, `packages/vscode/webview/topBar.ts` (combobox after View), `packages/vscode/webview/viewModel.ts` (`Last activity` row after `Created`), `packages/vscode/l10n/bundle.l10n.json`, `README.md` (one line under the views), `CHANGELOG.md` (`[Unreleased] → Added`)
- Test: `packages/vscode/test/uiState.test.ts`, `packages/vscode/test/viewModel.test.ts`, `packages/vscode/test/smoke.test.ts`

**Interfaces:**
- Consumes: `SortOrder`, `SORT_ORDERS`, `DEFAULT_SORT`, `lastActivity`, `buildTree(ws, mode, f, sort)` from Task 1.
- Produces: `WebviewToHost` `{ type: 'setSort'; sort: SortOrder }`; state message field `sort: SortOrder`; `ItemDetailsDto.lastActivity: string`; string keys `sort`, `sort.created-asc` = `Created ↑`, `sort.created-desc` = `Created ↓`, `sort.activity-asc` = `Last activity ↑`, `sort.activity-desc` = `Last activity ↓`, `row.lastActivity` = `Last activity`.

- [ ] **Step 1: Write failing tests:**
  - `uiState`: missing or invalid `sort` (`'x'`, `3`) reads as `created-asc`; a valid one round-trips.
  - `viewModel`: item details show a `Last activity` row with the DTO value right after `Created`.
  - `smoke`: post `setSort` `activity-desc` → the next state message has `sort: 'activity-desc'` and a Time tree whose first day group is the newest last-activity date in the sample workspace.
- [ ] **Step 2:** `npm test -w packages/vscode` and `npm run test:ext` → the new tests FAIL.
- [ ] **Step 3: Implement** the files above; the combobox mirrors the View combobox (same widget, keyboard, `--vscode-*` theme variables), label `Sort`; `setSort` is validated in the host like `setView` (reject unknown values); the choice is stored in workspaceState and survives reload; regenerate the l10n bundle.
- [ ] **Step 4:** `npm run build && npm test && npm run test:ext` → PASS.
- [ ] **Step 5: Commit** `Add a Sort combobox with created and last activity` (`Task: FIX.2`).
