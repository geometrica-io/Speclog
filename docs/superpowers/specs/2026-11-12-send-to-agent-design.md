# Speclog v1.1 — Send to agent

> **Status:** Approved by the user (2026-11-12). Extends `2026-11-11-speclog-design.md` (the "main spec"); section
> numbers like "main §4.4" refer to it. Target release: **v1.1**, after v1 ships. v1 scope and its
> acceptance criteria do not change.

## 1. What and why

The user picks one open item in the Speclog panel and runs **Send to agent**. Speclog opens a coding
agent's chat in the item's repository with a ready-made prompt: what the item is, where it is written,
what it depends on, and how to close it so that git can prove it (`Task: <id>`). The user stays at the
screen, answers the agent's questions in the agent's own chat, and later sees the result in Speclog:
the item turns **On branch**, then **Done** after merge — verified from git, as every other item.

Why: today the user copies the ID, opens the agent, and types "work on X, read its spec, close it with
a `Task:` line" by hand, and forgets parts of it (the closing line most often). Speclog already knows
every field needed for that prompt.

Positioning (user decision): this is a **convenience, not a headline feature**. Linear, Jira and Kiro
already let users hand an item to an agent; Backlog.md / Task Master / Spec Kit expect the user to point
the agent at a task by prompt or MCP. Speclog's message stays "Is your task list telling the truth?
Speclog asks git." — the README mentions Send to agent as one more step that git closes, not as a lead.

## 2. Goals

1. One item at a time, interactive: the agent runs in a chat the user can watch and answer. No
   background / unattended runs, no batch dispatch.
2. **Agent-independent.** The prompt carries the whole protocol, so any agent that accepts a text
   prompt works. Speclog ships a few delivery targets (§4) and a plain clipboard fallback.
3. The result is read back only through main §4.4 (git). Speclog keeps no record of "sent" items.
4. Works in every source format (main §4.2–§4.3), with closing rules that match the format (§3.2).

## 3. Non-goals / anti-goals

- **Speclog still never modifies a task file** (main §3). The agent may edit files; Speclog does not.
- No "Sent / In progress (agent)" status, no tracking of agent sessions, no reading agent transcripts.
  Anti-goal: a status that is not backed by git.
- No bundled agent, no API keys, no network calls of its own.
- No dependence on one vendor: a user without Claude Code / Copilot must still get value (clipboard).
- Not a CLI / MCP feature — those stay in v2 (main §7); they may later reuse the same prompt builder.

## 4. Delivery targets

Setting `speclog.agent.target` (default `"auto"`):

| Value | What happens |
|-------|--------------|
| `"chat"` | VS Code's chat view opens with the prompt pre-filled (`workbench.action.chat.open` with a query; not sent automatically, so the user can edit it and pick the agent/mode). Works for Copilot and any agent that plugs into VS Code chat. The prompt is also copied to the clipboard (the chat may have no agent provider behind it), and the information message says so. |
| `"terminal"` | A new integrated terminal named `Speclog: <id>` opens with `cwd` = the item's repository and runs the command in `speclog.agent.terminalCommand` (default `claude`) with the prompt as **one argument**. The terminal is created with `shellPath`/`shellArgs` (no shell string), so no quoting differs between PowerShell, cmd, bash and zsh. |
| `"clipboard"` | The prompt is copied; an information message says so ("Prompt for <id> copied — paste it into your agent"). Works in Cursor, Windsurf, Antigravity and any other agent. |
| `"auto"` | `chat` when the chat command exists in this editor, else `clipboard`. |

Whatever the target, the command palette also offers **Speclog: Copy agent prompt** for the selected
item, so the clipboard path is always one step away.

In remote workspaces (main §6, `extensionKind: ["workspace"]`) the terminal runs on the remote side,
where the repository is; the configured command must exist there.

**Terminal command and Windows launchers (my decision):** `speclog.agent.terminalCommand` is an array
— executable first, then fixed arguments (e.g. `["claude", "--model", "opus"]`); Speclog never splits a
string. The executable is a bare name (looked up on the absolute `PATH` entries) or an absolute path; a
relative path is refused with one message naming the setting, never resolved against the repository, and
an empty or malformed setting is refused the same way, never replaced by `claude`. The setting has
`"scope": "machine-overridable"`. The prompt is appended as the last argument. When the resolved executable is a batch launcher
(`.cmd` / `.bat`, as npm installs CLIs on Windows), cmd.exe would mangle `%`, `"`, `^` and newlines; in
that case — and whenever the prompt exceeds 4,000 characters — Speclog writes the full prompt to a file
in the extension's own storage (`globalStorageUri`, never inside a repository) and passes a one-line
argument instead: `Read the task in <file> and follow it.` Prompt files older than 7 days are deleted on
activation. Acceptance criterion 2 is met when the agent receives the full prompt text unchanged, either
directly or through that file.

**Repository not open in this window:** see §4.1.

### 4.1 Repository not open in this window (user decision, 2026-11-12)

Repositories found through `speclog.roots` are often not workspace folders, and a chat agent works in
the window's workspace, so `chat` may not reach the item's repository. Therefore `chat` (whether chosen
directly or by `auto`) is used only when the repository is inside a workspace folder of this window.
Otherwise Speclog copies the prompt and shows a message with an **Open repository in new window**
button (`vscode.openFolder` with `forceNewWindow`); the user pastes the prompt into the agent there.
`terminal` is unaffected (its `cwd` is the repository).

## 5. The prompt

Built in `packages/core` (pure function, unit-tested; no `vscode` import) from the item and its program:

- repository name and absolute path; the instruction to work only in that repository;
- item ID, title, status, size, priority, area;
- task file path and line; `note`; `evidence`;
- `depends` list, each with its current Speclog status;
- spec path (repository-relative) when the item or its program has one;
- **closing rules for the format** (§5.1);
- a closing request: "When done, tell me the branch and the commit(s)."

### 5.1 Closing rules per format

- `docs/tasks`: put `Task: <id>` in the body of the commit that finishes the item, `Task-Progress: <id>`
  in commits that only advance it; never write `status: done`; new follow-up work goes into
  `docs/tasks/` with a fresh ID.
- Backlog.md and Spec Kit: the same `Task:` / `Task-Progress:` lines, **and** mark the item done in its
  file the way the format expects (Backlog.md status field / Spec Kit `[x]`) in the same commit — so the
  item does not raise GitDoneFileOpen (main §4.5).
- An item of another repository is never sent from here: the prompt always targets the item's own
  repository, so the bare `Task: <id>` form is used.

### 5.1a Items not on the main branch (my decision)

Task files are read from git (main §4.2), so the item's file may not be in the checked-out folder. The
agent always starts in the repository's main folder (never in a worktree). The prompt cites the file as
`<branch>:<path>:<line>` with the branch it was read from:
- item on the main branch → `main:<path>` plus "start from an up-to-date main branch";
- branch-only item or `onBranch` item → names that branch and says "continue on branch <name>; check it
  out or create a worktree for it — ask me if the working tree has uncommitted changes".
The prompt builder therefore needs the source branch of the item and, for `onBranch`, the branch of the
closing commit; both are already in the snapshot.

### 5.2 Template

Setting `speclog.agent.promptTemplate` (string; empty = built-in). Placeholders: `{repo}`, `{repoPath}`,
`{id}`, `{title}`, `{status}`, `{size}`, `{priority}`, `{area}`, `{file}`, `{line}`, `{branch}`,
`{workBranch}`, `{note}`, `{evidence}`, `{depends}`, `{spec}`, `{closingRules}`, `{guards}`. Unknown
placeholders are left as-is and listed once in a warning. `{branch}` is the source branch (§5.1a);
`{workBranch}` is the branch to continue on (empty for items on main);
`{guards}` holds the extra lines from §7 (empty when none apply). **With a custom template, guard lines
are not appended automatically (my decision)** — appending text after a slash command could break it.
If a guard applies and the template lacks `{guards}`, the confirmation dialog says the agent will not
receive the "stop and ask first" line. Example use: a Claude Code user sets it to
`/gorev {repo}:{id}` to call their own skill instead of the long prompt. The built-in text is English.

## 6. Where the action appears

- Item row context menu and a button in the property table header: **Send to agent**.
- Command palette: **Speclog: Send selected item to agent**, **Speclog: Copy agent prompt**.
- Not on repository / program / group rows.

## 7. Guards

| Item state | Behavior |
|-----------|----------|
| `open`, `partial`, `bug`, `verify` | Send directly. |
| `decision` | Confirm first: "This item needs a decision; the agent should ask you before building." The prompt gets an extra line telling the agent to stop and ask before writing code. |
| A `depends` item not Done | Confirm first, listing the open dependencies. |
| `onBranch` | Confirm first: "Work for this item already exists on branch <name>." The prompt names that branch. |
| `unverified` (main §4.5) | Confirm first: "The file says done but git has no evidence." |
| `done`, `dropped` | Action disabled (tooltip says why). |
| Repository with a git error / not scanned yet | Action disabled. |

A `depends` item that is `dropped` counts as closed (like `done`). If the repository has not been scanned yet, the action is disabled ("Repository not scanned yet.").

## 8. Changes to the main spec and CLAUDE.md (made when v1.1 is implemented)

- Main §7: v1.1 line "Send to agent" pointing here (added with this spec).
- Main §3 / CLAUDE.md "Only write" constraint: still true for files; add that Speclog may open a
  terminal running the user-configured agent command and may write the clipboard, both only on an
  explicit user action.

## 9. Acceptance criteria

1. Prompt builder unit tests: every format, with/without spec, depends, note; `decision` and `onBranch`
   extras; template placeholders including unknown ones; Windows and POSIX paths.
2. Each target works in VS Code on Windows, macOS and Linux; `terminal` with a prompt containing
   quotes, `$`, backticks, `%` and newlines reaches the agent unchanged.
3. `auto` falls back to `clipboard` in an editor without the chat command (checked in Antigravity or
   VSCodium).
4. End to end on one real repository: send an item, let the agent finish it with a `Task:` commit on a
   branch → Speclog shows On branch without a manual refresh; after merge → Done.
5. Guards in §7 behave as listed; Speclog writes nothing into any repository.

## 10. Left to the builder

Exact prompt wording; placeholder names beyond those listed; icon; how the confirmation dialogs look
(VS Code modal message vs. webview); whether the terminal is reused for the same item; detection of the
chat command.
