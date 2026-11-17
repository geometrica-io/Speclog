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
evidence: scan of six public repos (MrLesk/Backlog.md, eser/stack, a2aproject/a2a-tck, pamburus/hl, raphaeltm/simple-agent-manager, re-cinq/lore) found and fixed RR.1-RR.5; final scan 2026-11-15: no errors, every repo under 7 s (was out of memory after 15 min)

## REL.7 Publish 0.1.0 as a pre-release
status: open
size: S
depends: REL.1, REL.2, REL.4, REL.5, REL.6
note: Marketplace with --pre-release (release.yml: odd minor = pre-release, even = regular; 0.1.x is pre-release); Open VSX follows in REL.8. Tag v0.1.0 to publish. Move to a regular release in 0.2 after first feedback.
evidence: tag v0.1.0, release run 43933846968 — "Published geometricaio.speclog v0.1.0." as a pre-release on the VS Code Marketplace (2026-11-16)

## REL.8 Publish to Open VSX
status: open
size: S
depends: REL.7
note: Claim the geometricaio namespace on open-vsx.org (Claim Ownership), then register the trusted publisher (geometrica-io/Speclog, release.yml), set the repository variable OVSX_TRUSTED=true, and rerun the release for the published version.
evidence: tag v0.1.1, release run 44172509376 published with OVSX_PAT; open-vsx.org/api/geometricaio/speclog returns 0.1.1, preRelease true, verified true (2026-11-18)

## REL.9 Switch Open VSX publishing to the trusted publisher
status: open
size: S
depends: REL.8
note: Open VSX registers a trusted publisher only for an extension that already has a version there, so 0.1.1 went out with OVSX_PAT. On open-vsx.org register the trusted publisher (geometrica-io/Speclog, release.yml), set the repository variable OVSX_TRUSTED=true, run release.yml manually (dry run verifies it), then delete the OVSX_PAT secret.
evidence: trusted publisher registered on open-vsx.org; OVSX_TRUSTED=true; dry run 44186307597 green ("Open VSX trusted publisher is set up for geometricaio.speclog"); OVSX_PAT secret deleted (2026-11-18)
