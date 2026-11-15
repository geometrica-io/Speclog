# First Marketplace release — pre-release checklist
program: REL
area: Release
created: 2026-11-14

## REL.1 Make the GitHub repository public
status: open
size: S
note: The Marketplace page links to the repository, issues and license; they 404 while it is private.
evidence: github.com/geometrica-io/Speclog is public (2026-11-15); README images load from raw/HEAD

## REL.2 Add a screenshot to the README
status: open
size: S
note: Replace "Screenshot pending." with a board screenshot (dark theme, several repositories). Use a generated demo workspace of fictional repositories and tasks (scripts/demo-workspace.mjs); never real repositories.

## REL.3 Set up the geometricaio publisher and tokens
status: open
size: S
note: Marketplace publisher geometricaio (display name Geometrica.io), VSCE_PAT and OVSX_PAT repository secrets, Open VSX namespace.

## REL.4 Dry-run the release workflow
status: open
size: S
depends: REL.3
note: Remove "private": true from packages/vscode/package.json if vsce publish refuses it; run release.yml on a test tag first.

## REL.5 Confirm CI is green on Windows, macOS and Linux
status: open
size: S
note: Attach the run for the release commit. CI now also runs the extension smoke tests (xvfb on Linux).
evidence: GitHub Actions run 43650329484 on 75ed1f1 — windows, macos, ubuntu green incl. test:ext

## REL.6 Dogfood on public Backlog.md and Spec Kit repositories
status: open
size: M
note: Clone two or three public repositories per format and use Speclog on them for a few days; v1 parity was only proven on docs/tasks.

## REL.7 Publish 0.1.0 as a pre-release
status: open
size: S
depends: REL.1, REL.2, REL.4, REL.5, REL.6
note: Marketplace and Open VSX with --pre-release; move to a regular release in 0.2 after first feedback.
