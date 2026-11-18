# Changelog

All notable changes to Speclog are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.2] - 2026-11-18 (pre-release)

### Added
- A **Sort** combobox next to View: Created or Last activity, oldest or newest first. The Time view
  groups by the chosen date, so `Last activity ↓` shows the day's branch work at the top. The property
  table shows **Last activity**.

## [0.1.1] - 2026-11-17 (pre-release)

### Added
- Published on Open VSX (VSCodium, Cursor, Windsurf, Antigravity and other editors that use it).

### Fixed
- Backlog.md items show their own task file in the property table and in the agent prompt, not the
  `backlog/` folder.

## [0.1.0] - 2026-11-16 (pre-release)

### Added
- One board for the tasks of all repositories in the workspace and in `speclog.roots`, with Program,
  Area and Time views, filter, search, property table and an Attention list.
- Task formats: `docs/tasks`, Backlog.md (tested with v1.55.3) and GitHub Spec Kit `tasks.md`
  (tested with v1.4.0).
- Status verified from git: `Task:` and `Task-Progress:` commit lines, Done when reachable from the main
  branch, On branch for unmerged work, `Task: Repo:id` across repositories.
- Unverified status for hand-written "done" without git evidence, the `speclog.unverifiedDone` setting
  and the per-repository "Trust current task files" cutoff.
- Task files are read from git, never modified; background `git fetch` of `origin` refs only.
- Commands: Open, Refresh, Install commit-msg hook (portable POSIX `sh`, warn-only), Trust / Stop
  trusting task files.
- Status bar summary, activity bar view, light / dark / high contrast themes, keyboard navigation.
- Runs in local, WSL, SSH and container workspaces (`extensionKind: workspace`).
- Send to agent: hand the selected item to a coding agent with a ready-made prompt (item, task file,
  dependencies, spec and the `Task:` closing rule), through VS Code chat, a terminal running
  `speclog.agent.terminalCommand`, or the clipboard (`speclog.agent.target`); a chat prompt is also
  copied to the clipboard. Item row context menu, property table button, and the commands
  **Send selected item to agent** and **Copy agent prompt**.
- `speclog.agent.terminalCommand` (per machine): the executable is a name on `PATH` or an absolute
  path; a relative path, an empty list or an empty executable is refused with a message.
- Confirmation before sending a pending decision, an item with open dependencies, work already on a
  branch, or an unverified done; done and dropped items cannot be sent.
- `speclog.agent.promptTemplate` for a custom prompt with placeholders.
- A `.cmd` / `.bat` launcher on Windows, or any prompt over 4,000 characters, gets the prompt through a
  file in Speclog's own storage (deleted after 7 days). Nothing is written into a repository, and nothing
  about sent items is stored.

### Not yet
- Clicking a commit copies its hash; opening it in VS Code's git view is planned for a later version.
