// Replays main at a past day: the board as it stood at the end of that day (REP.1).
// Everything is read from git at the commit chosen for the day, never from the working tree.
import { ADAPTERS } from './adapters';
import type { ParseCache } from './adapters';
import { createParseCache } from './adapters/files';
import { BlobReader } from './git/blobReader';
import type { CommitInfo } from './git/repo';
import { TreeReader } from './git/treeReader';
import type { RepoSnapshot } from './snapshot';
import { emptySnapshot, readProgramsAt } from './snapshot';
import { resolveAll } from './status';
import type { UnverifiedMode, Workspace } from './status';

/**
 * The newest commit on main's first-parent chain (from the tip) dated on or before day
 * (YYYY-MM-DD); '' if none, or if the tip is empty or not among mainCommits.
 */
export function commitAtDay(snap: RepoSnapshot, day: string): string {
  return commitAtDayIn(indexOf(snap), snap.tipHash, day);
}

type CommitIndex = Map<string, CommitInfo>;
const indexOf = (snap: RepoSnapshot): CommitIndex => new Map(snap.mainCommits.map((c) => [c.hash, c]));

function commitAtDayIn(byHash: CommitIndex, tip: string, day: string): string {
  let c = byHash.get(tip);
  while (c) {
    if (c.date <= day) return c.hash;
    c = c.parents.length > 0 ? byHash.get(c.parents[0]) : undefined;
  }
  return '';
}

/** Commits of snap.mainCommits reachable from hash (all parents), in mainCommits order. */
export function ancestorsOf(snap: RepoSnapshot, hash: string): CommitInfo[] {
  return ancestorsIn(snap, indexOf(snap), hash);
}

function ancestorsIn(snap: RepoSnapshot, byHash: CommitIndex, hash: string): CommitInfo[] {
  const seen = new Set<string>();
  const stack = [hash];
  while (stack.length > 0) {
    const h = stack.pop()!;
    if (seen.has(h)) continue;
    const c = byHash.get(h);
    if (!c) continue;
    seen.add(h);
    stack.push(...c.parents);
  }
  return snap.mainCommits.filter((c) => seen.has(c.hash));
}

/** Something a report should mention about a repository's data (the report is still computed). */
export interface ReplayWarning { repo: string; repoPath: string; message: string; }

export interface ReplayOptions {
  /** Opens a repository's blob reader (tests: to count or watch readers); default: a new BlobReader. */
  openBlobReader?: (repoPath: string, signal?: AbortSignal) => BlobReader;
}

/** Replays the live snapshots at days; one blob reader per repository, one shared parse cache. */
export class ReplaySession {
  /** One per repository, opened lazily. A dead reader is not replaced within a session (a new session is made per report run). */
  private readonly readers = new Map<string, { reader: BlobReader; trees: TreeReader }>();
  private readonly cache: ParseCache = createParseCache();
  /** hash -> commit per live snapshot, built once. */
  private readonly indexes = new Map<RepoSnapshot, CommitIndex>();

  constructor(private readonly snapshots: readonly RepoSnapshot[], private readonly mode: UnverifiedMode,
    private readonly signal?: AbortSignal, private readonly opts: ReplayOptions = {}) {}

  private readerFor(path: string): { reader: BlobReader; trees: TreeReader } {
    let r = this.readers.get(path);
    if (!r) {
      const reader = this.opts.openBlobReader ? this.opts.openBlobReader(path, this.signal) : new BlobReader(path, this.signal);
      r = { reader, trees: new TreeReader(reader) };
      this.readers.set(path, r);
    }
    return r;
  }

  /**
   * The board at the end of day. error: a replay read failed ("<repository>: <git error>"), or "cancelled".
   * A live snapshot's own error (the engine kept its last good data) does not fail the replay: the data present
   * is replayed and the error comes back as a warning, as does a main tip missing from main's history.
   */
  async at(day: string): Promise<{ workspace: Workspace; error: string; warnings: ReplayWarning[] }> {
    let error = '';
    const warnings: ReplayWarning[] = [];
    const warn = (live: RepoSnapshot, message: string) => warnings.push({ repo: live.repo.name, repoPath: live.repo.path, message });
    const replayed: RepoSnapshot[] = [];
    for (const live of this.snapshots) {
      if (this.signal?.aborted) {
        return { workspace: resolveAll(this.snapshots.map((s) => emptySnapshot(s.repo)), this.mode), error: 'cancelled', warnings: [] };
      }
      if (live.error) warn(live, live.error);
      let idx = this.indexes.get(live);
      if (!idx) this.indexes.set(live, (idx = indexOf(live)));
      if (live.tipHash !== '' && !idx.has(live.tipHash)) {
        warn(live, `the main branch tip ${live.tipHash.slice(0, 7)} is not in its commit history; its items are left out`);
      }
      const c = commitAtDayIn(idx, live.tipHash, day);
      if (c === '') {
        replayed.push(emptySnapshot(live.repo));
        continue;
      }
      const { reader, trees } = this.readerFor(live.repo.path);
      const r = await readProgramsAt(reader, trees, c, ADAPTERS, this.cache);
      if (r.error && !error) error = `${live.repo.name}: ${r.error}`;
      replayed.push({
        ...emptySnapshot(live.repo),
        main: live.main, tipHash: c, programs: r.programs, mainCommits: ancestorsIn(live, idx, c),
        trustCommit: live.trustCommit, programsAtTrust: live.programsAtTrust,
        sinceCommit: live.sinceCommit, programsAtSince: live.programsAtSince, hasSinceFile: live.hasSinceFile,
        formats: live.formats, hasTaskFiles: live.hasTaskFiles,
      });
    }
    if (this.signal?.aborted) error = 'cancelled';
    return { workspace: resolveAll(replayed, this.mode), error, warnings };
  }

  async close(): Promise<void> {
    const all = [...this.readers.values()];
    this.readers.clear();
    await Promise.all(all.map((r) => r.reader.close()));
  }
}
