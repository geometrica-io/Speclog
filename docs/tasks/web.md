# Web support
program: W
area: Web
created: 2026-11-24

## W.1 GitBackend interface with the current git CLI as CliBackend
status: open
priority: 1
size: M
note: Turn the readers in core git/repo.ts (resolveMain, listOtherBranches, logCommits, revList, listFiles, listTreeBlobs, readBlob, grepFixed, resolveCommit, changedFiles, changedFilesSince, objectIds, hasUncommittedChanges, fetch) into a GitBackend interface; move the runGit code into CliBackend with no change in behavior, git arguments or results.

## W.2 Inject file system and path instead of importing fs and path in core
status: open
priority: 1
size: S
note: engine.ts, discovery.ts and scheduler.ts import fs and path; inject a FileSystemPort and use POSIX string helpers so the core bundles for a web worker. Desktop keeps a Node implementation of the port.

## W.3 GithubBackend for reading refs, trees and blobs over the GitHub API
status: open
priority: 1
size: L
depends: W.1, W.2
note: Implement the read side with an injected fetch: default_branch for resolveMain, git/trees?recursive=1 for ls-tree, git/blobs for readBlob, commits/{sha} for changedFiles, in-memory search for grepFixed. Cache immutable objects by SHA and send conditional requests with ETag so unchanged refreshes return 304. hasUncommittedChanges is always false (no working tree); fetch is a no-op. Read only: no API call writes anything.

## W.4 Branch and commit comparison over the GitHub API
status: open
priority: 2
size: M
depends: W.3
note: Map merge-base --is-ancestor, for-each-ref --no-merged, log and rev-list with excluded refs to the compare API (base...head, paginated past 250 commits) or GraphQL history; cache results by tip SHA; cap changedFilesSince to a bounded number of commits and report when the cap is hit.

## W.5 Web extension entry and browser bundle
status: open
priority: 2
size: M
depends: W.2
note: Add "browser": "./dist/web/extension.js" and a webworker esbuild bundle with core aliased to its web entry; set virtualWorkspaces to limited with a description; replace fs in host.ts, files.ts, settings.ts and reportPanel.ts with vscode.workspace.fs. Repositories come from vscode-vfs://github/<owner>/<repo> workspace folders and a speclog.repositories setting of owner/repo entries.

## W.6 GitHub sign-in, rate limit display and web-only feature gating
status: open
priority: 2
size: S
depends: W.3, W.5
note: Sign in with vscode.authentication.getSession('github', ['repo']): silent first, then a Sign in button in the view; no token is stored by Speclog. Re-read the session on onDidChangeSessions and treat 401 as signed out. Show the remaining API quota and stretch the refresh interval near the limit. Hide Install commit-msg hook and Send to agent in a terminal when isWeb; clipboard and prompt files under globalStorageUri still work.

## W.7 Contract tests for both backends and a web smoke test
status: open
priority: 2
size: M
depends: W.4, W.5
note: One scenario suite run against CliBackend on a fixture repository and against GithubBackend with recorded API responses; both must give the same status results. Add npm run test:web with @vscode/test-web.

## W.8 Document web support
status: open
priority: 3
size: S
depends: W.6, W.7
note: Explain in the README and Marketplace page what works on vscode.dev and github.dev (GitHub repositories only, pushed commits only, no hook or terminal) and that Codespaces and remote setups keep the full feature set.
