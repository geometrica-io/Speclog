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
  const byHash = new Map(snap.mainCommits.map((c) => [c.hash, c]));
  let c = byHash.get(snap.tipHash);
  while (c) {
    if (c.date <= day) return c.hash;
    c = c.parents.length > 0 ? byHash.get(c.parents[0]) : undefined;
  }
  return '';
}

/** Commits of snap.mainCommits reachable from hash (all parents), in mainCommits order. */
export function ancestorsOf(snap: RepoSnapshot, hash: string): CommitInfo[] {
  const byHash = new Map(snap.mainCommits.map((c) => [c.hash, c]));
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

/** Replays the live snapshots at days; one blob reader per repository, one shared parse cache. */
export class ReplaySession {
  private readonly readers = new Map<string, { reader: BlobReader; trees: TreeReader }>();
  private readonly cache: ParseCache = createParseCache();

  constructor(private readonly snapshots: readonly RepoSnapshot[], private readonly mode: UnverifiedMode,
    private readonly signal?: AbortSignal) {}

  private readerFor(path: string): { reader: BlobReader; trees: TreeReader } {
    let r = this.readers.get(path);
    if (!r) {
      const reader = new BlobReader(path, this.signal);
      r = { reader, trees: new TreeReader(reader) };
      this.readers.set(path, r);
    }
    return r;
  }

  async at(day: string): Promise<{ workspace: Workspace; error: string }> {
    let error = '';
    const replayed: RepoSnapshot[] = [];
    for (const live of this.snapshots) {
      if (this.signal?.aborted) {
        return { workspace: resolveAll(this.snapshots.map((s) => emptySnapshot(s.repo)), this.mode), error: 'cancelled' };
      }
      const c = commitAtDay(live, day);
      if (c === '') {
        replayed.push(emptySnapshot(live.repo));
        continue;
      }
      const { reader, trees } = this.readerFor(live.repo.path);
      const r = await readProgramsAt(reader, trees, c, ADAPTERS, this.cache);
      if (r.error && !error) error = r.error;
      replayed.push({
        ...emptySnapshot(live.repo),
        main: live.main, tipHash: c, programs: r.programs, mainCommits: ancestorsOf(live, c),
        trustCommit: live.trustCommit, programsAtTrust: live.programsAtTrust,
        sinceCommit: live.sinceCommit, programsAtSince: live.programsAtSince, hasSinceFile: live.hasSinceFile,
        formats: live.formats, hasTaskFiles: live.hasTaskFiles,
      });
    }
    if (this.signal?.aborted) error = 'cancelled';
    return { workspace: resolveAll(replayed, this.mode), error };
  }

  async close(): Promise<void> {
    const all = [...this.readers.values()];
    this.readers.clear();
    await Promise.all(all.map((r) => r.reader.close()));
  }
}
