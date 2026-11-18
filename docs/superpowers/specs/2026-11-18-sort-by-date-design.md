# Sort by created or last activity — design

**Status:** Approved by the user (2026-11-18).

## Intent

The user opens Speclog in the evening to see the day's work. The work is there (items closed or advanced
by `Task:` / `Task-Progress:` commits on today's branches show as On branch), but the Time view groups
items by the day they were **created**, so today's work sits under an old date (FIRE.5 / FIRE.6, created
2026-11-13, worked on 2026-11-18). The user wants to order items by date, created or last worked on,
in either direction.

## Goals

- A **Sort** combobox in the top bar, next to View, with four options:
  `Created ↑` (oldest first, default — today's behaviour), `Created ↓`, `Last activity ↑`, `Last activity ↓`.
- **Last activity** of an item = the newest of: its created date, the date of its newest commit that
  references it (`Task:` or `Task-Progress:`, on main or any branch Speclog reads — `ResolvedItem.commits`),
  and its done date. Items with no valid date have none and sort last in either direction.
- **Time view:** groups (month, day) are built from the chosen date and ordered in the chosen direction;
  items inside a day follow the same direction.
- **Program and Area views:** groups stay as they are; the items inside each group are ordered by the
  chosen date and direction. `Created ↑` keeps today's order exactly (file order) so nothing moves for
  users who never touch the combobox. Ties keep today's order.
- **Properties table:** a `Last activity` row next to `Created`.
- The choice is remembered per window like the View choice (workspaceState); invalid stored values fall
  back to the default.

## Non-goals

- No refresh button (the user chose the combobox instead; `Speclog: Refresh` and the periodic scan stay).
- No time-of-day precision; dates are days, as elsewhere in Speclog.
- No new statuses, no change to how commits are read.

## Approaches considered

1. A separate "Activity" view — rejected by the user: they want it in the existing views.
2. A Created / Last activity toggle on the Time view only — superseded by the user's combobox, which also
   gives the direction.
3. **Sort combobox for all views (chosen by the user).** My call: it applies to Program and Area views too
   (item order inside groups), because a sort control that only works in one view is confusing.

## Left to the builder

- Where the date logic lives: a pure core function (e.g. `lastActivity(r)`) next to the tree builder,
  unit-tested; the tree builder takes the sort as a parameter.
- Arrow glyphs in the option labels go through l10n like other strings.
