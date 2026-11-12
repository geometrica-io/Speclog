// Per-repository snapshot: port of ProjectManager src/core/Snapshot.cpp, extended to every task
// file format (ADAPTERS) and the per-repository trust cutoff of Backlog.md / Spec Kit (spec §4.5).
// Everything is read from git (main tip + unmerged branches), never from the working tree.
import { ADAPTERS, docsTasksAdapter } from './adapters';
import type { SourceFile, TaskSourceAdapter } from './adapters';
import { mapLimit } from './discovery';
import {
  BranchTip, CommitInfo, MainRef, changedFilesSince, grepFixed, hasUncommittedChanges, listOtherBranches,
  listTree, logCommits, objectIds, readBlob, resolveCommit, resolveMain, revList,
} from './git/repo';
import { ParseIssue, Program, RECENT_DAYS, RepoInfo, SourceFormat } from './model';
import { dayNumber, trim } from './text';

export interface BranchData {
  tip: BranchTip;
  /** Read only for formats whose task files differ from main's; [] otherwise. */
  programs: Program[];
  /** Commits not on main, newest first. */
  commits: CommitInfo[];
}
export interface EvidenceResult { id: string; found: boolean; expectPresent: boolean; }

export interface RepoSnapshot {
  repo: RepoInfo;
  main: MainRef;
  /** Formats with at least one task file on the main tip, in ADAPTERS order. */
  formats: SourceFormat[];
  hasTaskFiles: boolean;
  /** From the main tip, in ADAPTERS order. */
  programs: Program[];
  /** Main + branch files (deduplicated by path, line, kind); also bad-evidence, bad-since, bad-trust. */
  issues: ParseIssue[];
  /** All reachable from main, newest first. */
  mainCommits: CommitInfo[];
  branches: BranchData[];
  /** Items with evidence, evaluated on the main tip. */
  evidence: EvidenceResult[];
  /** docs/tasks/.since commit, full hash; "" if absent or invalid. */
  sinceCommit: string;
  /** docs/tasks/.since exists on the main tip. */
  hasSinceFile: boolean;
  /** docs/tasks programs at sinceCommit. */
  programsAtSince: Program[];
  /** On main and not reachable from sinceCommit, or not reachable from trustCommit (either cutoff). */
  commitsAfterSince: Set<string>;
  /** The trust cutoff from settings, full hash; "" if not given or invalid. */
  trustCommit: string;
  /** Backlog.md / Spec Kit programs at trustCommit. */
  programsAtTrust: Program[];
  /** The working tree or index has changes under any adapter's pathspecs. */
  uncommittedTaskChanges: boolean;
  /** hash -> files, recent main commits only. */
  changedFiles: Map<string, string[]>;
  /** Non-empty if a git step failed (data then incomplete); "cancelled" for an aborted build. */
  error: string;
}

export interface SnapshotOptions {
  /** YYYY-MM-DD */
  today: string;
  recentDays?: number;
  /** Trust cutoff (Backlog.md / Spec Kit), any commit-ish hash prefix. */
  trustCommit?: string;
  /** Aborting kills a running git call; the build then returns with error "cancelled" and must be discarded. */
  signal?: AbortSignal;
}

const SINCE_FILE = 'docs/tasks/.since';
const TRUST_FORMATS: readonly SourceFormat[] = ['backlogMd', 'specKit'];
const BLOB_READ_CONCURRENCY = 8;

/** A snapshot with no data: the repository only. */
export function emptySnapshot(repo: RepoInfo): RepoSnapshot {
  return {
    repo, main: { name: '', tipRef: '', reachRefs: [] }, formats: [], hasTaskFiles: false, programs: [], issues: [],
    mainCommits: [], branches: [], evidence: [], sinceCommit: '', hasSinceFile: false, programsAtSince: [],
    commitsAfterSince: new Set(), trustCommit: '', programsAtTrust: [], uncommittedTaskChanges: false,
    changedFiles: new Map(), error: '',
  };
}

function pathspecsOf(adapters: readonly TaskSourceAdapter[]): string[] {
  return [...new Set(adapters.flatMap((a) => a.pathspecs))];
}

/** A format is present when it selects a file; docs/tasks also when it holds any file (e.g. only .since). */
function isPresent(a: TaskSourceAdapter, paths: string[]): boolean {
  if (a.select(paths).length > 0) return true;
  return a === docsTasksAdapter && paths.some((p) => /^docs\/tasks\/[^/]+$/.test(p));
}

// evidence: present|absent "<text>" in <pathspec>
function parseEvidence(ev: string): { present: boolean; text: string; spec: string } | null {
  const s = trim(ev);
  const sp = s.search(/[ \t]/);
  if (sp === -1) return null;
  const kind = s.slice(0, sp);
  if (kind !== 'present' && kind !== 'absent') return null;
  const q1 = s.indexOf('"', sp);
  if (q1 === -1) return null;
  // Text may contain quotes: the closing one is the last quote followed by " in ".
  let q2 = -1;
  for (let p = s.indexOf('"', q1 + 1); p !== -1; p = s.indexOf('"', p + 1)) {
    const m = /^[ \t]+in[ \t]/.exec(s.slice(p + 1));
    if (m) q2 = p;
  }
  if (q2 === -1) return null;
  const text = s.slice(q1 + 1, q2);
  const spec = trim(s.slice(q2 + 1).replace(/^[ \t]+in/, ''));
  if (!text || !spec) return null;
  return { present: kind === 'present', text, spec };
}

/** First line of a .since blob, without a UTF-8 BOM and surrounding blanks. */
function sinceValue(text: string): string {
  const t = text.startsWith('﻿') ? text.slice(1) : text;
  const nl = t.search(/[\r\n]/);
  return trim(nl === -1 ? t : t.slice(0, nl));
}

function isHexPrefix(s: string): boolean {
  return s.length >= 4 && s.length <= 64 && /^[0-9a-fA-F]+$/.test(s);
}

/** "YYYY-MM-DD" of a day number (days since 1970-01-01). */
function dateOfDay(n: number): string {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}

export async function buildSnapshot(repo: RepoInfo, o: SnapshotOptions): Promise<RepoSnapshot> {
  const { signal } = o;
  const recentDays = o.recentDays ?? RECENT_DAYS;
  const snap = emptySnapshot(repo);
  let err = ''; // first git failure; becomes snap.error
  const fail = (e: string) => {
    if (e && !err) err = e;
  };
  const cancelled = (): boolean => {
    if (!signal?.aborted) return false;
    snap.error = 'cancelled';
    return true;
  };
  const settle = (): RepoSnapshot => {
    if (!cancelled() && !snap.error) snap.error = err;
    return snap;
  };

  /** Parses the files of adapters among paths at ref; a file that cannot be read sets the error. */
  const readPrograms = async (ref: string, paths: string[], adapters: readonly TaskSourceAdapter[]) => {
    const programs: Program[] = [];
    const issues: ParseIssue[] = [];
    for (const a of adapters) {
      const selected = a.select(paths);
      if (selected.length === 0) continue;
      const read = await mapLimit(selected, BLOB_READ_CONCURRENCY, async (path) => {
        const b = await readBlob(repo.path, ref, path, signal);
        if (b.error) fail(b.error);
        else if (b.value === null) fail(`could not read ${path} on ${ref}`);
        return b.value === null ? null : { path, text: b.value };
      });
      const r = a.parse(read.filter((f): f is SourceFile => f !== null));
      programs.push(...r.programs);
      issues.push(...r.issues);
    }
    return { programs, issues };
  };
  /** Lists the adapters' files at ref and parses them. */
  const readAt = async (ref: string, adapters: readonly TaskSourceAdapter[]) => {
    const l = await listTree(repo.path, ref, pathspecsOf(adapters), signal);
    fail(l.error);
    return readPrograms(ref, l.value, adapters);
  };

  const m = await resolveMain(repo.path, signal);
  snap.main = m.value;
  fail(m.error);
  if (cancelled()) return snap;
  if (err) return settle();

  const allSpecs = pathspecsOf(ADAPTERS);
  const u = await hasUncommittedChanges(repo.path, allSpecs, signal);
  fail(u.error);
  snap.uncommittedTaskChanges = u.value;
  if (cancelled()) return snap;
  if (!snap.main.name) return settle(); // no default branch (empty repo): not an error

  const tip = snap.main.tipRef;
  const listed = await listTree(repo.path, tip, allSpecs, signal);
  fail(listed.error);
  const paths = listed.value;
  snap.formats = ADAPTERS.filter((a) => isPresent(a, paths)).map((a) => a.format);
  snap.hasTaskFiles = snap.formats.length > 0;
  const main = await readPrograms(tip, paths, ADAPTERS);
  snap.programs = main.programs;
  snap.issues = main.issues;
  if (cancelled()) return snap;

  const log = await logCommits(repo.path, snap.main.reachRefs, [], '', false, signal);
  snap.mainCommits = log.value;
  const logErr = log.error;
  fail(logErr);
  if (cancelled()) return snap;

  // Branches not merged into main. A format's task files are read on a branch only when they
  // differ from main's (identical files add no items and no new issues).
  const other = await listOtherBranches(repo.path, snap.main, signal);
  fail(other.error);
  const tips = other.value;
  const specPaths = ADAPTERS.map((a) => a.pathspecs.map((p) => p.replace(/\/+$/, '')));
  const flat = specPaths.flat();
  const ids = await objectIds(repo.path, [tip, ...tips.map((t) => t.ref)].flatMap((ref) => flat.map((p) => `${ref}:${p}`)),
    signal);
  fail(ids.error);
  if (cancelled()) return snap;
  /** Object ids of adapter a's pathspecs at ref index k (0 = main). */
  const idsOf = (k: number, a: number): string[] => {
    const start = k * flat.length + specPaths.slice(0, a).reduce((n, s) => n + s.length, 0);
    return ids.value.slice(start, start + specPaths[a].length);
  };
  // Commits of all branches in one log; each branch takes those reachable from its tip.
  let branchCommits: CommitInfo[] = [];
  if (tips.length > 0) {
    const bl = await logCommits(repo.path, tips.map((t) => t.ref), snap.main.reachRefs, '', true, signal);
    fail(bl.error);
    branchCommits = bl.value;
  }
  const byHash = new Map<string, number>();
  branchCommits.forEach((c, k) => byHash.set(c.hash, k));
  const issueKey = (i: ParseIssue) => `${i.path}\0${i.line}\0${i.kind}`;
  const seen = new Set(snap.issues.map(issueKey));
  for (let k = 0; k < tips.length; ++k) {
    if (cancelled()) return snap;
    const bd: BranchData = { tip: tips[k], programs: [], commits: [] };
    const changed = ADAPTERS.filter((_, a) => {
      const own = idsOf(k + 1, a);
      const mains = idsOf(0, a);
      return own.some((id) => id !== '') && own.some((id, j) => id !== mains[j]);
    });
    if (changed.length > 0) {
      const r = await readAt(bd.tip.ref, changed);
      bd.programs = r.programs;
      for (const i of r.issues) {
        const key = issueKey(i);
        if (!seen.has(key)) {
          seen.add(key);
          snap.issues.push(i);
        }
      }
    }
    // Parents outside the set are on main, and so are all their ancestors.
    const reach = new Array<boolean>(branchCommits.length).fill(false);
    const stack = [bd.tip.hash];
    while (stack.length > 0) {
      const c = byHash.get(stack.pop()!);
      if (c === undefined || reach[c]) continue;
      reach[c] = true;
      stack.push(...branchCommits[c].parents);
    }
    bd.commits = branchCommits.filter((_, c) => reach[c]); // git's order, newest first
    snap.branches.push(bd);
  }

  // Evidence on the main tip.
  for (const p of snap.programs) {
    for (const it of p.items) {
      if (!it.evidence) continue;
      if (cancelled()) return snap;
      const ev = parseEvidence(it.evidence);
      if (!ev) {
        snap.issues.push({ path: p.path, line: it.line, kind: 'bad-evidence', detail: `${it.id}: ${it.evidence}` });
        continue;
      }
      const g = await grepFixed(repo.path, tip, ev.text, ev.spec, signal);
      if (g === 'error') fail(`git grep: could not check the evidence of ${it.id}`);
      snap.evidence.push({ id: it.id, found: g === 'found', expectPresent: ev.present });
    }
  }
  if (cancelled()) return snap;

  /**
   * Resolves a cutoff to a commit on main; reports a bad value with bad(); "" when it is not usable.
   * A git failure is an error, not a bad value.
   */
  const resolveCutoff = async (value: string, bad: (why: string) => void): Promise<string> => {
    if (!isHexPrefix(value)) {
      bad('not a commit hash');
      return '';
    }
    const r = await resolveCommit(repo.path, value, signal);
    if (r.error || logErr) {
      fail(r.error); // git failed: reported as an error, not as a bad cutoff
      return '';
    }
    if (!r.value) {
      bad('no such commit');
      return '';
    }
    if (!snap.mainCommits.some((c) => c.hash === r.value)) {
      bad('not on the main branch');
      return '';
    }
    return r.value;
  };
  const cutoffs: string[] = [];

  // docs/tasks/.since history cut: a commit on the main branch.
  snap.hasSinceFile = paths.includes(SINCE_FILE);
  if (snap.hasSinceFile) {
    const b = await readBlob(repo.path, tip, SINCE_FILE, signal);
    if (b.error || b.value === null) {
      fail(b.error || `could not read ${SINCE_FILE} on ${tip}`);
    } else {
      const value = sinceValue(b.value);
      const full = await resolveCutoff(value, (why) => snap.issues.push(
        { path: SINCE_FILE, line: 1, kind: 'bad-since', detail: value ? `${value}: ${why}` : why }));
      if (full) {
        snap.sinceCommit = full;
        snap.programsAtSince = (await readAt(full, [docsTasksAdapter])).programs;
        cutoffs.push(full);
      }
    }
  }
  if (cancelled()) return snap;

  // Trust cutoff of Backlog.md / Spec Kit (from settings): a commit on the main branch.
  const trustValue = trim(o.trustCommit ?? '');
  if (trustValue) {
    const full = await resolveCutoff(trustValue, (why) => snap.issues.push(
      { path: '', line: 0, kind: 'bad-trust', detail: `${trustValue}: ${why}` }));
    if (full) {
      snap.trustCommit = full;
      snap.programsAtTrust = (await readAt(full, ADAPTERS.filter((a) => TRUST_FORMATS.includes(a.format)))).programs;
      cutoffs.push(full);
    }
  }
  if (cancelled()) return snap;

  // Commits after either cutoff.
  for (const c of [...new Set(cutoffs)]) {
    const r = await revList(repo.path, snap.main.reachRefs, [c], signal);
    fail(r.error);
    for (const h of r.value) snap.commitsAfterSince.add(h);
  }
  if (cancelled()) return snap;

  // Changed files for recent main commits only: one log from two days before the window
  // (git's --since is a timestamp in local time, commit dates may carry any zone), then the
  // date rule on the committer date.
  const todayN = dayNumber(o.today);
  if (!Number.isNaN(todayN)) {
    const ch = await changedFilesSince(repo.path, snap.main.reachRefs, dateOfDay(todayN - recentDays - 2), signal);
    fail(ch.error);
    for (const c of snap.mainCommits) {
      const cn = dayNumber(c.date);
      if (Number.isNaN(cn) || todayN - cn > recentDays) continue;
      snap.changedFiles.set(c.hash, ch.value.get(c.hash) ?? []);
    }
  }
  return settle();
}

/**
 * What to show after a rebuild: a failed build (error set) does not replace earlier data, so the
 * previous snapshot is kept with the new error attached; with no previous one, an error-only
 * snapshot (repo, main ref, error; no programs, commits or issues), so partial data never shows.
 * A successful build is returned as is.
 */
export function keepLastGood(previous: RepoSnapshot | undefined, fresh: RepoSnapshot): RepoSnapshot {
  if (!fresh.error) return fresh;
  if (previous) return { ...previous, error: fresh.error };
  // Nothing earlier: partial data (items without their closing commits) could disagree with
  // git, so only the repo and the error are shown.
  return { ...emptySnapshot(fresh.repo), main: fresh.main, error: fresh.error };
}
