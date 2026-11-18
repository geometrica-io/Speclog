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
