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

/**
 * Adds "rel|mtime|size;" for every regular file under p (p itself if it is a file) to rows.
 * Symbolic links are not followed (a link loop cannot hang the probe); a link itself counts as an
 * entry with its own mtime and size. Missing: nothing.
 */
async function walk(root: string, p: string, rows: string[]): Promise<void> {
  let st;
  try {
    st = await fsp.lstat(p);
  } catch {
    return;
  }
  if (st.isFile() || st.isSymbolicLink()) {
    rows.push(`${path.relative(root, p).split(path.sep).join('/')}|${st.mtimeMs}|${st.size};`);
    return;
  }
  if (!st.isDirectory()) return;
  let names: string[];
  try {
    names = await fsp.readdir(p);
  } catch {
    return;
  }
  for (const n of names) await walk(root, path.join(p, n), rows);
}

export interface ProbeOptions {
  /** Walk the worktree's specs/ folder (Spec Kit); default true. */
  includeSpecs?: boolean;
}

/**
 * mtimes + sizes of .git/HEAD, packed-refs, refs/** and of the worktree files under every
 * adapter's pathspecs ("" if there is no .git directory). Equal stamps: nothing to rescan.
 */
export async function probeStamp(repoPath: string, o: ProbeOptions = {}): Promise<string> {
  const git = path.join(repoPath, '.git');
  try {
    if (!(await fsp.lstat(git)).isDirectory()) return '';
  } catch {
    return '';
  }
  const rows: string[] = [];
  for (const f of ['HEAD', 'packed-refs', 'refs']) await walk(repoPath, path.join(git, f), rows);
  const specs = [...new Set(ADAPTERS.flatMap((a) => a.pathspecs))]
    .map((s) => s.replace(/\/+$/, ''))
    .filter((s) => o.includeSpecs !== false || s !== 'specs');
  for (const s of specs) await walk(repoPath, path.join(repoPath, s), rows);
  rows.sort();
  return rows.join('');
}
