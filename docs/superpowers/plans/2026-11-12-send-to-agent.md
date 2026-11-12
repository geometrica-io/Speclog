# Speclog v1.1 Send to Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick one item in the Speclog panel and open a coding agent on it with a ready-made prompt, while the result is still read back only from git.

**Architecture:** A pure prompt builder and guard evaluator in `packages/core` (unit-tested, no `vscode`), and a thin delivery layer in `packages/vscode` that resolves the target (chat / terminal / clipboard), handles Windows batch launchers through a prompt file in extension storage, and wires the action into the v1 webview and command palette.

**Tech Stack:** TypeScript 5 (strict), vitest, VS Code extension API (`window.createTerminal`, `env.clipboard`, `commands.executeCommand('workbench.action.chat.open', …)`, `vscode.openFolder`), `@vscode/test-electron`.

**Spec:** `docs/superpowers/specs/2026-11-12-send-to-agent-design.md` (extends `docs/superpowers/specs/2026-11-11-speclog-design.md`).

**Precondition:** v1 (`docs/superpowers/plans/2026-11-11-speclog-v1.md`) is complete and merged to `main`. Start this plan on a branch from that `main`. Names below that come from v1 (`ResolvedItem`, `Workspace`, `RepoSnapshot`, `findDependency`, `SpeclogHost`, `protocol.ts`, `ItemDetailsDto`) are as v1 left them — if v1 renamed something, follow the code and note it in the task report.

## Global Constraints

- English only: UI strings, docs, comments, commit messages. UI strings go through `vscode.l10n.t` / `package.nls.json`.
- `packages/core` never imports `vscode`.
- Speclog never modifies a task file and writes nothing inside any repository. New in v1.1, each only on an explicit user action: open a terminal running the user-configured command, write the clipboard, write prompt files under the extension's `globalStorageUri/prompts/`.
- No network calls, no API keys, no tracking of sent items, no new status.
- Settings (defaults): `speclog.agent.target` = `"auto"` (`"auto" | "chat" | "terminal" | "clipboard"`), `speclog.agent.terminalCommand` = `["claude"]` (string array, executable first; never split a string), `speclog.agent.promptTemplate` = `""` (empty = built-in).
- Prompt file is used when the resolved executable ends in `.cmd` or `.bat` (case-insensitive) **or** the prompt is longer than **4,000** characters; then the only argument is `Read the task in <file> and follow it.` Prompt files older than **7 days** are deleted on activation.
- `chat` is used only when the item's repository is inside a workspace folder of this window; otherwise copy + message with **Open repository in new window** (`vscode.openFolder`, `{ forceNewWindow: true }`).
- LF line endings; short imperative commit messages; no `Co-Authored-By` line.

## Review Focus

1. **Spec Kit IDs contain `/`** (`001-photo-albums/T001`): prompt file names and terminal names must stay valid — Task 3 test `promptFileName sanitizes slashes`.
2. **Configured agent command not on PATH** (or `terminalCommand` is `[]`): the user gets one clear error naming the command, not a dead terminal — Task 3 test `resolveExecutable returns undefined for a missing command` + host check.
3. **Repository paths with spaces, non-ASCII (Turkish) characters, different drive-letter case on Windows**: the workspace-folder check must still match — Task 3 test `isInsideWorkspace handles case and spaces`.
4. **Custom template with literal braces** (`{ "json": 1 }`, `{{id}}`): only `{name}` with letters is a placeholder; other braces stay untouched — Task 2 test `template keeps non-placeholder braces`.
5. **Item changes between selection and click** (rescan removes it or it becomes Done): the host re-resolves the item at send time and refuses with a message if it is gone or now disabled — Task 4 test `sendToAgent re-resolves the item`.

---

## File map

```
packages/core/src/agentPrompt.ts     guards + prompt builder + template (pure)
packages/core/src/index.ts           export the above
packages/core/test/agentPrompt.test.ts
packages/vscode/src/agent.ts         target resolution, executable lookup, prompt files, delivery
packages/vscode/src/agentPure.ts     DOM/vscode-free helpers of agent.ts (unit-tested)
packages/vscode/test/agentPure.test.ts
packages/vscode/src/protocol.ts      + sendToAgent message, + agent field on item details
packages/vscode/src/host.ts          handle sendToAgent, confirmations
packages/vscode/src/commands.ts      speclog.sendToAgent, speclog.copyAgentPrompt
packages/vscode/webview/properties.ts, tree.ts   button + context menu entry
packages/vscode/package.json, package.nls.json   commands, settings, menus
README.md, CHANGELOG.md, CLAUDE.md, docs/superpowers/specs/2026-11-11-speclog-design.md (§3 note)
```

---

### Task 1: Guards

**Files:** Create `packages/core/src/agentPrompt.ts`, `packages/core/test/agentPrompt.test.ts`; Modify `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `ResolvedItem`, `Workspace`, `findDependency(w, fromRepo, dep)` (v1 `status.ts`), `RepoSnapshot.error`, `RepoSnapshot.main`, `RepoSnapshot.branches[].tip`, `BranchData.programs`.
- Produces:
```ts
export type GuardKind = 'decision' | 'openDepends' | 'onBranch' | 'unverified';
export interface Guard { kind: GuardKind; message: string; promptLine: string; }
export interface AgentAvailability { enabled: boolean; reason: string; guards: Guard[]; }
export function agentAvailability(w: Workspace, r: ResolvedItem): AgentAvailability;
export function sourceBranch(w: Workspace, r: ResolvedItem): string;
```
`sourceBranch`: the branch whose `programs` contains `r.program` (object identity) when `r.branchOnly`, else the snapshot's main branch name. `reason` is non-empty only when `enabled` is false.

- [ ] **Step 1: Write failing tests** (build `ResolvedItem`s with a local `resolved(partial)` factory in the test file; a tiny `Workspace` with one snapshot):
  - `done and dropped are disabled` → `enabled === false`, `reason` mentions the status.
  - `git error disables` → snapshot `error: 'fatal: x'` → `enabled === false`.
  - `open item has no guards` → `enabled`, `guards.length === 0`; same for `partial`, `bug`, `verify`.
  - `decision adds a guard` → one guard `decision`, `promptLine` contains `ask me before writing code`.
  - `open dependency adds a guard` → depends `['A.1', 'A.2']`, A.1 done, A.2 open → guard `openDepends`, message lists `A.2` and not `A.1`; an unresolvable dependency is listed as `A.9 (not found)`.
  - `onBranch names the branch` → `status: 'onBranch'`, `branches: ['feature/x']` → guard message and promptLine contain `feature/x`.
  - `unverified adds a guard` → message contains `no evidence in git`.
  - `guards combine` → decision + open dependency → two guards, in the order decision, openDepends, onBranch, unverified.
  - `sourceBranch` → main item → `main`; branch-only item whose program sits in branch `feature/y` → `feature/y`.
- [ ] **Step 2:** `npm test -w packages/core -- agentPrompt` → FAIL (module missing).
- [ ] **Step 3:** Implement `agentAvailability` and `sourceBranch` in `agentPrompt.ts`; export from `index.ts`.
- [ ] **Step 4:** Same command → PASS; `npm test` all green.
- [ ] **Step 5:** Commit `Decide when an item may be sent to an agent`.

---

### Task 2: Prompt builder and template

**Files:** Modify `packages/core/src/agentPrompt.ts`, `packages/core/test/agentPrompt.test.ts`

**Interfaces:**
- Consumes: Task 1 (`agentAvailability`, `sourceBranch`).
- Produces:
```ts
export interface AgentPrompt { text: string; unknownPlaceholders: string[]; guardsOmitted: boolean; }
export function closingRules(format: SourceFormat, id: string): string;
export function placeholderValues(w: Workspace, r: ResolvedItem): Record<string, string>;
export function buildAgentPrompt(w: Workspace, r: ResolvedItem, template: string): AgentPrompt;
```
Placeholders (exact names): `repo`, `repoPath`, `id`, `title`, `status`, `size`, `priority`, `area`, `file` (repo-relative `program.path`, forward slashes), `line`, `branch` (`sourceBranch`), `note`, `evidence`, `depends` (`A.1 (done), A.2 (open)`), `spec` (`item.spec || program.spec`, empty if none), `closingRules`, `guards` (guard `promptLine`s joined by newlines, empty if none). Placeholder syntax: `\{([A-Za-z]+)\}`; unknown names are left as-is and returned once each in `unknownPlaceholders`. Empty `template` = built-in English template, which always contains every section the spec lists (§5) including `{guards}`; built-in → `guardsOmitted` is always false. Custom template → `guardsOmitted` = guards exist and the template has no `{guards}`; nothing is appended to a custom template.

Fixed copy for `closingRules` (spec §5.1):
- `docsTasks`: `Put "Task: <id>" in the body of the commit that finishes this item, and "Task-Progress: <id>" in commits that only advance it. Never write "status: done" in the task file. Add new follow-up work to docs/tasks/ with a fresh ID.`
- `backlogMd` / `specKit`: the same first sentence, then `In the same commit, mark the item done in its file the way the format expects (Backlog.md: the status field; Spec Kit: [x]).`

The built-in prompt cites the file as `<branch>:<file>:<line>`; for an item on main it adds `Start from an up-to-date <branch> branch.`; for a branch-only or `onBranch` item it adds `Continue on branch <name>; check it out or create a worktree for it — ask me if the working tree has uncommitted changes.`; it ends with `When done, tell me the branch and the commit(s).` and states `Work only in the repository at <repoPath>.`

- [ ] **Step 1: Write failing tests:**
  - `built-in prompt for a docs/tasks item` → contains `BL52.2`, the title, `main:docs/tasks/bl-52.md:7`, `Work only in the repository at`, `Task: BL52.2`, `Never write "status: done"`, `When done, tell me the branch`.
  - `backlog and spec kit closing rules mention marking the file` → `closingRules('backlogMd','task-12')` contains `Task: task-12` and `status field`; specKit contains `[x]`.
  - `spec line only when a spec exists` → item without spec → text does not contain `Spec:`; with program spec `docs/specs/x.md` → contains it.
  - `depends with statuses` → `{depends}` = `A.1 (done), A.2 (open)`.
  - `branch-only item cites its branch` → contains `feature/y:docs/tasks/` and `Continue on branch feature/y`.
  - `onBranch item cites the closing branch` → contains `Continue on branch feature/x`.
  - `decision guard reaches the built-in prompt` → contains `ask me before writing code`.
  - `custom template substitutes and reports unknowns` → template `/gorev {repo}:{id} {nope}` → text `/gorev SFEA:BL52.2 {nope}`, `unknownPlaceholders` = `['nope']`.
  - `custom template without guards placeholder` → decision item, template `/gorev {id}` → `guardsOmitted === true`, text exactly `/gorev BL52.2`.
  - `template keeps non-placeholder braces` → template `{ "a": 1 } {{id}}` → text `{ "a": 1 } {BL52.2}`, no unknowns.
  - `paths pass through` → `repoPath` `C:\Users\Ali Ş\repo` appears unchanged; `file` uses `/`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the three functions.
- [ ] **Step 4:** Run → PASS; `npm test` green.
- [ ] **Step 5:** Commit `Build the agent prompt from an item and an optional template`.

---

### Task 3: Delivery helpers

**Files:** Create `packages/vscode/src/agentPure.ts`, `packages/vscode/test/agentPure.test.ts` (vitest, same runner as v1 webview helper tests)

**Interfaces:**
- Produces:
```ts
export type AgentTarget = 'auto' | 'chat' | 'terminal' | 'clipboard';
export type Delivery = 'chat' | 'terminal' | 'clipboard' | 'clipboardOpenWindow';
export function resolveDelivery(setting: AgentTarget, chatAvailable: boolean, repoInWorkspace: boolean): Delivery;
export function isInsideWorkspace(repoPath: string, folders: string[], platform: NodeJS.Platform): boolean;
export function resolveExecutable(cmd: string, envPath: string, pathExt: string, platform: NodeJS.Platform, exists: (p: string) => boolean): string | undefined;
export function needsPromptFile(executable: string, prompt: string): boolean;
export function promptFileName(repo: string, id: string, now: Date): string;
export function staleFiles(files: { name: string; mtimeMs: number }[], nowMs: number): string[];
export const PROMPT_FILE_ARG = (file: string) => `Read the task in ${file} and follow it.`;
```
`resolveDelivery`: `chat` / `auto` → `chat` only if `chatAvailable && repoInWorkspace`; `chat`/`auto` with chat available but repo outside → `clipboardOpenWindow`; `auto` without chat → `clipboard` if repo inside, else `clipboardOpenWindow`; explicit `chat` without chat available → `clipboardOpenWindow`/`clipboard` by the same repo rule; `terminal` → `terminal`; `clipboard` → `clipboard`. `isInsideWorkspace`: path-prefix match on normalized paths (separator-aware, so `C:\a\repo2` is not inside `C:\a\repo`); case-insensitive on `win32`. `resolveExecutable`: absolute/relative path with separator → checked as-is; else PATH search; on `win32` tries each `PATHEXT` extension when `cmd` has none. `promptFileName`: `<repo>-<id>-<yyyyMMdd-HHmmss>.md` with every char outside `[A-Za-z0-9._-]` replaced by `_`. `staleFiles`: names older than 7 days.

- [ ] **Step 1: Write failing tests:**
  - `resolveDelivery` table: every (setting × chatAvailable × repoInWorkspace) case with the expected `Delivery` above (16 rows).
  - `isInsideWorkspace handles case and spaces` → `C:\Users\Ali Ş\Repo` inside `c:\users\ali ş` on win32 → true; same on linux with differing case → false; `C:\a\repo2` vs folder `C:\a\repo` → false; equal paths → true.
  - `resolveExecutable returns undefined for a missing command`; finds `claude.cmd` via PATHEXT on win32; finds `/usr/local/bin/claude` on linux; `[]`-equivalent empty string → undefined.
  - `needsPromptFile` → `x.CMD` → true; `x.bat` → true; `x.exe` short prompt → false; `x.exe` with 4,001 chars → true; 4,000 → false.
  - `promptFileName sanitizes slashes` → repo `My Repo`, id `001-photo-albums/T001` → `My_Repo-001-photo-albums_T001-20261112-093005.md`.
  - `staleFiles` → 8-day-old file listed, 6-day-old not.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `Resolve where and how an agent prompt is delivered`.

---

### Task 4: Wire the action into the extension

**Files:** Create `packages/vscode/src/agent.ts`; Modify `packages/vscode/src/{protocol.ts,host.ts,commands.ts}`, `packages/vscode/webview/{properties.ts,tree.ts}`, `packages/vscode/package.json`, `packages/vscode/package.nls.json`, `packages/vscode/test/smoke.test.ts`, `README.md`, `CHANGELOG.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-11-11-speclog-design.md`

**Interfaces:**
- Consumes: Tasks 1–3; v1 `SpeclogHost`, `HostToWebview` / `WebviewToHost`, `ItemDetailsDto`.
- Produces:
  - `protocol.ts`: `WebviewToHost` gains `{ type: 'sendToAgent'; key: string }`; `ItemDetailsDto` gains `agent: { enabled: boolean; reason: string }`.
  - `agent.ts`: `export async function sendToAgent(ctx: vscode.ExtensionContext, w: Workspace, key: string): Promise<'sent' | 'cancelled' | 'refused'>` and `export async function copyAgentPrompt(w: Workspace, key: string): Promise<void>`; `export async function cleanPromptFiles(ctx: vscode.ExtensionContext): Promise<void>` (called on activation).
  - Commands `speclog.sendToAgent` ("Speclog: Send selected item to agent"), `speclog.copyAgentPrompt` ("Speclog: Copy agent prompt"); the three settings from Global Constraints in `package.json` with descriptions in `package.nls.json`.

Behavior of `sendToAgent` (spec §4, §6, §7): re-resolve the item from `key` in the current `Workspace`; gone → info message, `refused`; `agentAvailability` disabled → info message with `reason`, `refused`; guards → one modal warning listing each guard `message` (plus the "agent will not receive the stop-and-ask line" sentence when `guardsOmitted`), Continue / Cancel; unknown placeholders → one warning naming them (does not block). Then by `resolveDelivery`: `chat` → `workbench.action.chat.open` with `{ query: text, isPartialQuery: true }`; `terminal` → `resolveExecutable` (missing → error `Agent command "<cmd>" was not found on PATH.`, `refused`), prompt file if `needsPromptFile`, `createTerminal({ name: 'Speclog: <id>', cwd: repoPath, shellPath: exe, shellArgs: [...fixedArgs, arg] })`, `show()`; `clipboard` → copy + info `Prompt for <id> copied — paste it into your agent.`; `clipboardOpenWindow` → copy + info with button **Open repository in new window** → `vscode.openFolder` with `{ forceNewWindow: true }`. Chat availability: `(await vscode.commands.getCommands(true)).includes('workbench.action.chat.open')`.

UI: item row context menu entry and a button in the property table header, both **Send to agent**, disabled with tooltip = `reason` when `agent.enabled` is false; not shown on repository / program / group rows.

- [ ] **Step 1: Write failing tests** in `smoke.test.ts` (sample workspace with TestRepo, v1 helpers):
  - `sendToAgent re-resolves the item` → send a key that no longer exists → result `refused`, no terminal created.
  - `done item is refused` → `refused`.
  - `clipboard target copies the prompt` → setting `clipboard`, open item → `sent`, `vscode.env.clipboard.readText()` contains the item ID and `Task: <id>`.
  - `terminal target opens a terminal in the repository` → setting `terminal`, `terminalCommand` = `['node', '-e', `require("fs").writeFileSync(${JSON.stringify(outFile)}, process.argv.at(-1))`]` (`outFile` a temp path; `node` from PATH, not `process.execPath`, which is Electron) → terminal named `Speclog: <id>` appears; the file receives the full prompt unchanged, including a prompt with quotes, `$`, backticks, `%` and a newline in the item note.
  - `missing agent command is reported` → `terminalCommand` = `['no-such-agent-xyz']` → `refused`, no terminal.
  - `details carry agent availability` → `details` message for a done item has `agent.enabled === false`.
- [ ] **Step 2:** `npm run test:ext` → FAIL.
- [ ] **Step 3:** Implement `agent.ts`, protocol/host/commands/webview changes, `package.json` contributions; call `cleanPromptFiles` on activation.
- [ ] **Step 4:** `npm run build && npm test && npm run test:ext` → PASS.
- [ ] **Step 5:** Docs: README section "Send to agent" (a short how-to under the existing features, not in the intro or tagline; settings table rows; the `.cmd` prompt-file note); CHANGELOG `## 1.1.0` entry; CLAUDE.md "Only write" line extended with the three user-triggered actions from Global Constraints; main spec §3 first bullet gets the same note and "v1.1" mention.
- [ ] **Step 6: Manual acceptance** (record results in the task report): Windows, macOS, Linux — each target once; `auto` in Antigravity or VSCodium falls back to clipboard; `claude.cmd` on Windows goes through a prompt file; end to end on one real repository: send an item, let the agent finish it with a `Task:` commit on a branch → Speclog shows On branch without manual refresh; after merge → Done.
- [ ] **Step 7:** Commit `Send a selected item to an agent from the panel`.
