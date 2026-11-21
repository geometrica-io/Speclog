# Small fixes
program: FIX
area: Maintenance
created: 2026-11-16

## FIX.1 Backlog.md items show their own task file
status: bug
size: S
note: The property table and the agent prompt showed the backlog/ folder instead of the item's file.

## FIX.2 Sort items by created or last activity
status: open
size: M
spec: docs/superpowers/specs/2026-11-18-sort-by-date-design.md
note: Today's branch work showed under the item's creation date in the Time view; add a Sort combobox (Created / Last activity, both directions).

## FIX.3 Make the terminal agent smoke test independent of machine load
status: bug
size: S
note: "timed out waiting for the agent command to write arg.txt" failed once and passed on rerun (2026-11-18), under load.

## FIX.4 Windows CI: the git dying test kills only the git launcher
status: bug
size: S
note: On GitHub's Windows runner git is Git's cmd\git.exe launcher; the test killed only its pid, so the real git kept answering and no read failed (red since 2026-11-18).
