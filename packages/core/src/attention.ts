// Attention list: port of ProjectManager src/core/Attention.cpp, extended with the Backlog.md /
// Spec Kit rows (spec §4.5-§4.6). Everything that threatens "the screen tells the truth" is listed here.
import { ADAPTERS } from './adapters';
import type { SourceFormat } from './model';
import type { EvidenceResult, RepoSnapshot } from './snapshot';
import { ResolvedItem, Workspace, findItem } from './status';
import { daysBetween } from './text';

export type AttentionKind = 'staleBranch' | 'untaggedCommit' | 'evidenceConflict' | 'unknownRef' | 'formatIssue' |
  'duplicateId' | 'noTaskFiles' | 'historyDoneAfterSince' | 'fetchFailing' | 'gitError' |
  'fileDoneNoGit' | 'gitDoneFileOpen' | 'unverifiedSummary' | 'uncommittedTaskChanges' | 'ambiguousRepoRef';

/** Output order of the kinds. */
const KIND_ORDER: readonly AttentionKind[] = [
  'staleBranch', 'untaggedCommit', 'evidenceConflict', 'unknownRef', 'formatIssue', 'duplicateId', 'noTaskFiles',
  'historyDoneAfterSince', 'fetchFailing', 'gitError', 'fileDoneNoGit', 'gitDoneFileOpen', 'unverifiedSummary',
  'uncommittedTaskChanges', 'ambiguousRepoRef',
];

/** detail is the English one-line text (--check); the UI builds its own text from the fields. */
export interface AttentionItem {
  kind: AttentionKind;
  repo: string;
  /** RepoInfo.path of the repository (unique per clone); the repository's name when it cannot be told. */
  repoPath: string;
  /** Branch, hash, item id or path. */
  ref: string;
  detail: string;
  line: number;
  /** staleBranch: branch tip age. */
  days: number;
  /** evidenceConflict: polarity. */
  expectPresent: boolean;
  /** evidenceConflict: grep result. */
  found: boolean;
  /** formatIssue: parse-issue kind; evidenceConflict: "present" / "absent"; staleBranch: comma-separated task ids. */
  code: string;
  /** unverifiedSummary: number of unverified items. */
  count: number;
}
export interface AttentionConfig {
  /** YYYY-MM-DD */
  today: string;
  staleBranchDays: number;
  /** Untagged commits older than this are not listed. */
  recentDays: number;
  fetchFailSeconds: number;
}
export interface FetchState { repo: string; lastOkUnix: number; firstFailUnix: number; lastError: string; }

const HAND_WRITTEN = ['backlogMd', 'specKit'];

function row(kind: AttentionKind, s: RepoSnapshot | { name: string; path: string }, ref: string, detail: string,
  over: Partial<AttentionItem> = {}): AttentionItem {
  const repo = 'repo' in s ? s.repo.name : s.name;
  const repoPath = 'repo' in s ? s.repo.path : s.path;
  return { kind, repo, repoPath, ref, detail, line: 0, days: 0, expectPresent: false, found: false, code: '', count: 0, ...over };
}

/** docs/ is never code (ProjectManager parity); a directory pathspec ends in "/", others name one file. */
const DOCS = 'docs/';

/** Drops duplicates and pathspecs inside another directory pathspec of the list. */
function minimal(specs: string[]): string[] {
  const out: string[] = [];
  for (const p of specs) {
    if (out.includes(p) || out.some((d) => d.endsWith('/') && p.startsWith(d))) continue;
    out.push(p);
  }
  return out;
}

/**
 * Every path that is task bookkeeping in some format: docs/ plus every adapter's pathspecs. The
 * shipped commit-msg hook (packages/vscode/assets/hook/commit-msg) exempts exactly this list; a
 * test keeps the two in step.
 */
export const TASK_PATHSPECS: readonly string[] = minimal([DOCS, ...ADAPTERS.flatMap((a) => a.pathspecs)]);

/** docs/ plus the pathspecs of the formats a repository uses. */
function taskPathspecs(formats: readonly SourceFormat[]): string[] {
  return minimal([DOCS, ...ADAPTERS.filter((a) => formats.includes(a.format)).flatMap((a) => a.pathspecs)]);
}

const isUnder = (f: string, specs: readonly string[]) => specs.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p));

/** One row per branch name: a local branch and its origin copy are the same branch. */
function staleBranches(s: RepoSnapshot, cfg: AttentionConfig, out: AttentionItem[]): void {
  const rows = new Map<string, { ref: string; age: number; ids: Set<string> }>();
  for (const b of s.branches) {
    const ids = new Set<string>();
    for (const c of b.commits) {
      for (const r of [...c.refs.done, ...c.refs.progress]) ids.add(r.repo ? `${r.repo}:${r.id}` : r.id);
    }
    if (ids.size === 0) continue;
    const remote = b.tip.name.startsWith('origin/');
    const key = remote ? b.tip.name.slice(7) : b.tip.name;
    const age = daysBetween(b.tip.date, cfg.today);
    const r = rows.get(key);
    if (!r) {
      rows.set(key, { ref: b.tip.name, age, ids });
      continue;
    }
    r.age = Math.min(r.age, age); // the newer copy decides
    for (const id of ids) r.ids.add(id);
    if (!remote) r.ref = b.tip.name; // show the local name
  }
  for (const r of rows.values()) {
    if (r.age <= cfg.staleBranchDays) continue;
    const ids = [...r.ids].sort().join(', ');
    out.push(row('staleBranch', s, r.ref, `${r.age} days; ${ids}`, { days: r.age, code: ids }));
  }
}

/** Main commits after a cutoff (.since or trust), within cfg.recentDays, that carry no Task trailer. */
function untaggedCommits(s: RepoSnapshot, cfg: AttentionConfig, out: AttentionItem[]): void {
  if (!s.sinceCommit && !s.trustCommit) return;
  const exempt = taskPathspecs(s.formats);
  for (const c of s.mainCommits) {
    if (!s.commitsAfterSince.has(c.hash)) continue;
    if (daysBetween(c.date, cfg.today) > cfg.recentDays) continue;
    const files = s.changedFiles.get(c.hash);
    if (!files) continue;
    if (c.parents.length > 1 || c.refs.done.length > 0 || c.refs.progress.length > 0) continue;
    if (files.some((p) => !isUnder(p, exempt))) out.push(row('untaggedCommit', s, c.hash, c.subject));
  }
}

/** Evidence result contradicts the item's status; dropped items never conflict. */
export function evidenceConflicts(r: ResolvedItem, e: EvidenceResult): boolean {
  if (r.status === 'dropped') return false;
  const done = r.status === 'done';
  return e.expectPresent ? e.found !== done : e.found === done;
}

function evidenceRows(w: Workspace, s: RepoSnapshot, out: AttentionItem[]): void {
  for (const e of s.evidence) {
    const r = findItem(w, s.repo.path, e.id);
    if (!r || !evidenceConflicts(r, e)) continue;
    out.push(row('evidenceConflict', s, e.id, `${e.expectPresent ? 'present' : 'absent'}${e.found ? ': found' : ': not found'}`,
      { expectPresent: e.expectPresent, found: e.found, code: e.expectPresent ? 'present' : 'absent' }));
  }
}

/**
 * docs/tasks only: status: done must come from the conversion commit (.since). Without a .since file
 * every such item is unverifiable: one format row per repo lists them.
 */
function historyDone(s: RepoSnapshot, out: AttentionItem[]): void {
  const programs = s.programs.filter((p) => p.format === 'docsTasks');
  if (!s.hasSinceFile) {
    const ids: string[] = [];
    let first: { path: string; line: number } | null = null;
    for (const p of programs) {
      for (const i of p.items) {
        if (i.stored !== 'done') continue;
        ids.push(i.id);
        first ??= { path: p.path, line: i.line };
      }
    }
    if (!first) return;
    out.push(row('formatIssue', s, first.path, `done-without-since: ${ids.join(', ')}`,
      { line: first.line, code: 'done-without-since' }));
    return;
  }
  if (!s.sinceCommit) return; // a bad .since is reported as its own issue
  const doneAtSince = new Set<string>();
  for (const p of s.programsAtSince) for (const i of p.items) if (i.stored === 'done') doneAtSince.add(i.id);
  for (const p of programs) {
    for (const i of p.items) if (i.stored === 'done' && !doneAtSince.has(i.id)) out.push(row('historyDoneAfterSince', s, i.id, p.path));
  }
}

/** Hand-written status formats: file says done without git evidence, or git says done while the file is open. */
function handWrittenRows(w: Workspace, out: AttentionItem[]): void {
  const unverified = new Map<string, { s: { name: string; path: string }; n: number }>();
  for (const r of w.items) {
    const who = { name: r.repo, path: r.repoPath };
    if (r.status === 'unverified' || r.flaggedUnverified) {
      out.push(row('fileDoneNoGit', who, r.item.id, r.item.fileStatusText));
      const u = unverified.get(r.repoPath) ?? { s: who, n: 0 };
      u.n++;
      unverified.set(r.repoPath, u);
    } else if (HAND_WRITTEN.includes(r.program.format) && r.status === 'done' && !r.trustedFromFile && !r.item.fileDone) {
      out.push(row('gitDoneFileOpen', who, r.item.id, r.item.fileStatusText));
    }
  }
  for (const u of unverified.values()) out.push(row('unverifiedSummary', u.s, '', `${u.n} unverified`, { count: u.n }));
}

export function computeAttention(ws: Workspace, cfg: AttentionConfig, fetch: FetchState[], nowUnix: number): AttentionItem[] {
  const out: AttentionItem[] = [];
  /** Path of the first repository of that name (the workspace's unknown / duplicate records carry only names). */
  const pathOfName = (name: string) => ws.snapshots.find((s) => s.repo.name === name)?.repo.path ?? name;
  for (const s of ws.snapshots) {
    if (s.error) out.push(row('gitError', s, '', s.error));
    else if (!s.hasTaskFiles) out.push(row('noTaskFiles', s, '', ''));
    for (const i of s.issues) out.push(row('formatIssue', s, i.path, `${i.kind}: ${i.detail}`, { line: i.line, code: i.kind }));
    if (s.uncommittedTaskChanges) out.push(row('uncommittedTaskChanges', s, '', ''));
    staleBranches(s, cfg, out);
    untaggedCommits(s, cfg, out);
    evidenceRows(ws, s, out);
    historyDone(s, out);
  }
  handWrittenRows(ws, out);
  for (const u of ws.unknownRefs) {
    out.push(row('unknownRef', { name: u.repo, path: pathOfName(u.repo) }, u.hash, u.refRepo ? `${u.refRepo}:${u.refId}` : u.refId));
  }
  for (const d of ws.duplicates) out.push(row('duplicateId', { name: d.repo, path: pathOfName(d.repo) }, d.id, d.paths.join(', ')));
  for (const a of ws.ambiguousRepoRefs) out.push(row('ambiguousRepoRef', { name: a.repo, path: pathOfName(a.repo) }, a.hash, a.refRepo));
  for (const f of fetch) {
    if (f.firstFailUnix === 0 || nowUnix - f.firstFailUnix <= cfg.fetchFailSeconds || f.lastOkUnix >= f.firstFailUnix) continue;
    const s = ws.snapshots.find((x) => x.repo.path === f.repo || x.repo.key === f.repo || x.repo.name === f.repo);
    out.push(row('fetchFailing', s ? s.repo : { name: f.repo, path: f.repo }, '', f.lastError));
  }

  const order = (k: AttentionKind) => KIND_ORDER.indexOf(k);
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return out
    .map((a, i) => ({ a, i }))
    .sort((x, y) => order(x.a.kind) - order(y.a.kind) || cmp(x.a.repo, y.a.repo) || cmp(x.a.ref, y.a.ref) || x.i - y.i)
    .map((x) => x.a);
}
