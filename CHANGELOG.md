# Changelog

All notable changes to Speclog are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - Unreleased

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

### Not yet
- Clicking a commit copies its hash; opening it in VS Code's git view is planned for a later version.
