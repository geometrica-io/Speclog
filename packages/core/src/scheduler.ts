// Job timing and change probe: port of ProjectManager src/core/Scheduler.cpp, extended with the
// fetch switch and the worktree task files (their edits change the uncommitted flag).
import { promises as fsp } from 'fs';
import * as path from 'path';
import { ADAPTERS } from './adapters';

export interface RepoTimers {
  repo: string;
  lastFetchStartUnix: number;
  /** Probe result of the latest tick. */
  lastStamp: string;
  /** Stamp the shown snapshot was built from. */
  seenStamp: string;
  busy: boolean;
  /** != 0: rescan at this time even without a change (the last build failed). */
  retryAtUnix: number;
}

export type JobKind = 'fetch' | 'rescan';
export interface Job { repo: string; kind: JobKind; }

/** Busy repos get nothing; a repo can get a fetch then a rescan (stamp changed or retry due). */
export function dueJobs(t: RepoTimers[], nowUnix: number, fetchIntervalSec: number, fetchEnabled: boolean): Job[] {
  const jobs: Job[] = [];
  for (const r of t) {
    if (r.busy) continue;
    if (fetchEnabled && (r.lastFetchStartUnix === 0 || nowUnix - r.lastFetchStartUnix >= fetchIntervalSec)) {
      jobs.push({ repo: r.repo, kind: 'fetch' });
    }
    if (r.lastStamp !== r.seenStamp || (r.retryAtUnix !== 0 && nowUnix >= r.retryAtUnix)) {
      jobs.push({ repo: r.repo, kind: 'rescan' });
    }
  }
  return jobs;
}

/** Regular files under p (p itself if it is a file), as absolute paths; missing: none. */
async function filesUnder(p: string, out: string[]): Promise<void> {
  let st;
  try {
    st = await fsp.stat(p);
  } catch {
    return;
  }
  if (st.isFile()) {
    out.push(p);
    return;
  }
  if (!st.isDirectory()) return;
  let names: string[];
  try {
    names = await fsp.readdir(p);
  } catch {
    return;
  }
  for (const n of names) await filesUnder(path.join(p, n), out);
}

/**
 * mtimes + sizes of .git/HEAD, packed-refs, refs/** and of the worktree files under every
 * adapter's pathspecs ("" if there is no .git directory). Equal stamps: nothing to rescan.
 */
export async function probeStamp(repoPath: string): Promise<string> {
  const git = path.join(repoPath, '.git');
  try {
    if (!(await fsp.stat(git)).isDirectory()) return '';
  } catch {
    return '';
  }
  const files: string[] = [path.join(git, 'HEAD'), path.join(git, 'packed-refs')];
  await filesUnder(path.join(git, 'refs'), files);
  const specs = [...new Set(ADAPTERS.flatMap((a) => a.pathspecs))];
  for (const s of specs) await filesUnder(path.join(repoPath, s.replace(/\/+$/, '')), files);
  const rows: string[] = [];
  for (const f of files) {
    try {
      const st = await fsp.stat(f);
      if (!st.isFile()) continue;
      const rel = path.relative(repoPath, f).split(path.sep).join('/');
      rows.push(`${rel}|${st.mtimeMs}|${st.size};`);
    } catch {
      // vanished between listing and stat
    }
  }
  rows.sort();
  return rows.join('');
}
