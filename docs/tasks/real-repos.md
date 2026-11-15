# Real-repository fixes before 0.1.0
program: RR
spec: docs/superpowers/plans/2026-11-15-real-repo-fixes.md
area: Core/Git
created: 2026-11-15

## RR.1 Read blobs through one git cat-file --batch process
status: bug
size: M
note: git show fails with "Filename too long" on Windows for long Backlog.md file names; one process per file is slow.

## RR.2 Branch window speclog.branchDays
status: open
size: S
note: Default 30 days, 0 = all; repositories with thousands of agent branches ran out of memory.

## RR.3 One Attention summary row for Unverified items
status: open
size: S

## RR.4 Acceptance on six public repositories
status: open
size: S
depends: RR.1, RR.2, RR.3, RR.5

## RR.5 Address branches by tip hash
status: bug
size: S
note: A ref name too long for a Windows path made git fail ("Filename too long"), and one such branch failed the whole repository's git log.
