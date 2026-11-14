// Repository discovery: port of ProjectManager src/core/RepoScanner.cpp, extended with
// workspace folders, several origin filters, repos without origin and realpath dedupe.
import { promises as fsp } from 'fs';
import * as path from 'path';
import { runGit } from './git/runner';
import { RepoInfo } from './model';
import { splitLines, trim } from './text';

export interface DiscoverOptions {
  /** Each one: itself if it is a repository, else its direct children. */
  workspaceFolders: string[];
  /** Direct children of each. */
  roots: string[];
  /** Folder names that are skipped. */
  exclude: string[];
  /** Origin URL fragments; empty = all. */
  originFilter: string[];
}

const SCHEME_URL = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(?:[^@/]*@)?([^/]*)(.*)$/s;

/** Host of a scheme URL without the ssh:// port ("ssh://git@host:22/x" and "git@host:x" are one repo). */
function schemeHost(scheme: string, host: string): string {
  return scheme.toLowerCase() === 'ssh' ? host.replace(/:\d*$/, '') : host;
}

/**
 * Lower-case; scheme URLs lose user info and the ssh:// port; an scp-like ssh origin
 * "user@host:path" (no "://") becomes "host/path", so "git@github.com:Owner/x",
 * "ssh://git@github.com:22/owner/x" and "https://github.com/owner/x" all contain "github.com/owner/".
 */
function normalizeForMatch(s: string): string {
  const o = s.toLowerCase();
  const m = SCHEME_URL.exec(o);
  if (m) return `${m[1]}://${schemeHost(m[1], m[2])}${m[3]}`;
  if (o.includes('://')) return o;
  const colon = o.indexOf(':');
  const slash = o.indexOf('/');
  if (colon > 1 && (slash === -1 || colon < slash)) {
    const host = o.slice(0, colon);
    return `${host.slice(host.indexOf('@') + 1)}/${o.slice(colon + 1)}`;
  }
  return o;
}

/** origin contains filter, ignoring case and treating the ssh "host:" form as "host/". Empty filter: true. */
export function originMatches(origin: string, filter: string): boolean {
  return filter === '' || normalizeForMatch(origin).includes(normalizeForMatch(filter));
}

export interface ParsedOrigin { owner: string; name: string; key: string; }

function stripRepoSuffix(p: string): string {
  let s = p.replace(/\/+$/, '');
  if (s.toLowerCase().endsWith('.git')) s = s.slice(0, -4);
  return s.replace(/\/+$/, '');
}

/**
 * Owner and repository name from an https/ssh origin ("scheme://[user@]host[:port]/owner/name(.git)"
 * or "[user@]host:owner/name(.git)"). key: the URL with a lower-case host, no user info for
 * scheme URLs, no ssh:// port, no trailing ".git" or "/". null for anything else (local paths, file URLs).
 */
export function parseOrigin(origin: string): ParsedOrigin | null {
  const o = trim(origin);
  let prefix: string;
  let repoPath: string;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(?:[^@/]*@)?([^/]+)\/(.*)$/.exec(o);
  const scp = /^((?:[^@/:]+@)?)([^/:]{2,}):(?!\/\/)(.*)$/.exec(o);
  if (scheme) {
    if (scheme[1].toLowerCase() === 'file') return null;
    prefix = `${scheme[1].toLowerCase()}://${schemeHost(scheme[1], scheme[2].toLowerCase())}/`;
    repoPath = scheme[3];
  } else if (scp) {
    prefix = `${scp[1]}${scp[2].toLowerCase()}:`;
    repoPath = scp[3];
  } else {
    return null;
  }
  const p = stripRepoSuffix(repoPath).replace(/^\/+/, '');
  const slash = p.lastIndexOf('/');
  if (slash <= 0 || slash === p.length - 1) return null;
  return { owner: p.slice(0, slash), name: p.slice(slash + 1), key: prefix + p };
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fsp.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** A repository root: has a .git *directory* (worktrees and submodules have a .git file). */
function isRepo(dir: string): Promise<boolean> {
  return isDir(path.join(dir, '.git'));
}

/** Direct subfolders of dir; symlinked / junctioned folders are followed (stat, not Dirent). */
async function children(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const all = names.map((n) => path.join(dir, n));
  const dirs = await Promise.all(all.map(isDir));
  return all.filter((_, i) => dirs[i]);
}

/**
 * Runs fn over items with at most `limit` calls in flight; results keep the input order. If fn
 * rejects, the returned promise rejects while the other workers keep running their items.
 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
}

/** At most this many `git config` calls run at once. */
export const ORIGIN_READ_CONCURRENCY = 8;

/** origin URL, "" when not set (exit 1); error when git fails otherwise (not started, dubious ownership, bad config). */
async function readOrigin(dir: string): Promise<{ origin: string; error: string }> {
  const r = await runGit(dir, ['config', '--get', 'remote.origin.url']);
  if (r.launched && !r.timedOut && r.code === 0) return { origin: trim(r.out), error: '' };
  if (r.launched && !r.timedOut && r.code === 1) return { origin: '', error: '' };
  const why = !r.launched ? r.err || 'git could not be started'
    : r.timedOut ? 'timed out'
      : splitLines(trim(r.err))[0] || `exit code ${r.code}`;
  return { origin: '', error: `git config: ${why}` };
}

export interface DiscoverError { path: string; error: string; }
export interface DiscoverResult { repos: RepoInfo[]; errors: DiscoverError[]; }

/**
 * Repositories in workspace folders (the folder itself if it is a repository, else its direct
 * children) and direct children of roots (symlinks / junctions followed). Skips folder names
 * in exclude and origins not matching any originFilter entry (a repository without origin only
 * passes an empty filter). A repository whose origin cannot be read is reported in errors; it
 * is still listed (as one without origin) when the filter is empty. Deduplicated by realpath;
 * sorted by name (case-insensitive), then path.
 */
export async function discoverRepos(o: DiscoverOptions): Promise<DiscoverResult> {
  const candidates: string[] = [];
  for (const ws of o.workspaceFolders) {
    if (await isRepo(ws)) candidates.push(ws);
    else candidates.push(...await children(ws));
  }
  for (const root of o.roots) candidates.push(...await children(root));

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const c of candidates) {
    if (o.exclude.includes(path.basename(path.resolve(c)))) continue;
    let real: string;
    try {
      real = await fsp.realpath(c);
    } catch {
      continue;
    }
    const id = process.platform === 'win32' ? real.toLowerCase() : real;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(real);
  }

  const errors: DiscoverError[] = [];
  const found = await mapLimit(unique, ORIGIN_READ_CONCURRENCY, async (dir): Promise<RepoInfo | null> => {
    if (!(await isRepo(dir))) return null;
    const { origin, error } = await readOrigin(dir);
    if (error) errors.push({ path: dir, error });
    if (o.originFilter.length > 0 && !(origin && o.originFilter.some((f) => originMatches(origin, f)))) return null;
    const parsed = origin ? parseOrigin(origin) : null;
    return {
      name: parsed ? parsed.name : path.basename(dir),
      owner: parsed ? parsed.owner : '',
      path: dir,
      origin,
      key: parsed ? parsed.key : origin ? stripRepoSuffix(origin) : dir,
    };
  });

  const repos = found.filter((r): r is RepoInfo => r !== null);
  repos.sort((a, b) => {
    const x = a.name.toLowerCase();
    const y = b.name.toLowerCase();
    if (x !== y) return x < y ? -1 : 1;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  errors.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { repos, errors };
}
