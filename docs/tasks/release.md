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
note: Marketplace publisher geometricaio (display name Geometrica.io), VSCE_PAT and OVSX_PAT repository secrets. The Open VSX namespace is created by release.yml on the first release if missing.
evidence: Marketplace publisher geometricaio exists; GitHub secrets VSCE_PAT and OVSX_PAT set (2026-11-15); Open VSX agreement signed

## REL.4 Dry-run the release workflow
status: open
size: S
depends: REL.3
note: Run release.yml manually (workflow_dispatch = dry run): build, test, package, verify the Marketplace token and the Open VSX trusted publisher (OIDC, no OVSX_PAT), publish nothing. vsce does not check "private": true. Needs the trusted publisher set up on open-vsx.org for geometrica-io/Speclog + release.yml.
evidence: dry run 43741604524 on fd6148f green (build, test, package, Marketplace token verified; nothing published; Open VSX gated by OVSX_TRUSTED until REL.8)

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

## REL.8 Publish to Open VSX
status: open
size: S
depends: REL.7
note: Claim the geometricaio namespace on open-vsx.org (Claim Ownership), then register the trusted publisher (geometrica-io/Speclog, release.yml), set the repository variable OVSX_TRUSTED=true, and rerun the release for the published version.
