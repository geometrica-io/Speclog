# CLAUDE.md

Speclog is an open-source VS Code extension (TypeScript) that shows tasks from
several git repositories and verifies their status from git.

## Layout

- `packages/core` - pure logic (parsers, git evidence, status rules). Never imports `vscode`; tests link only the core.
- `packages/vscode` - the extension (UI, webview, commands). Thin layer over core.

## Global Constraints

- English only: UI strings, docs, comments, commit messages. UI strings go through `vscode.l10n.t` / `package.nls.json`.
- Speclog never modifies a task file; tasks are read from git, not the working tree.
- Only write: the "Install commit-msg hook" command. Only writing git command: `git fetch --prune origin`.
  Send to agent (v1.1) adds, each only on an explicit user action: opening a terminal that runs the
  user-configured agent command, writing the clipboard, and writing prompt files under
  `globalStorageUri/prompts/` (never inside a repository).
- Every git call sets `GIT_TERMINAL_PROMPT=0`; use full ref names and `--end-of-options`.
- LF line endings; short imperative commit messages; no `Co-Authored-By` line.

## Commands

- `npm ci` - install
- `npm run build` - compile all packages
- `npm test` - core vitest tests
- `npm run test:ext` - extension smoke test
- `npm run package` - build the vsix
