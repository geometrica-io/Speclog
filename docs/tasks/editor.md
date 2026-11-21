# Editor integration
program: ED
area: Editor
created: 2026-11-22

## ED.1 CodeLens with the git-verified status on task items
status: open
priority: 1
size: M
note: Above each item heading in a task file show its status from git (Done with closing commit and date, On branch with branch name, Unverified) and a Send to agent action; items not yet committed show "not committed yet", since Speclog reads task files from git, not the working tree.

## ED.2 Editor diagnostics for task file format issues
status: open
priority: 2
size: S
note: Show the format issues the Attention list already reports (invalid status, duplicate ID, unknown field) as squiggles on the line in the editor, parsed from the working tree so they appear while typing.

## ED.3 Status bar summary
status: open
priority: 3
size: S
note: A single percentage means little across many repositories; show the Attention count and the active repository's progress, and open the board on click.
