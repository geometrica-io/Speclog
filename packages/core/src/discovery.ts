// Repository discovery: port of ProjectManager src/core/RepoScanner.cpp, extended with
// workspace folders, several origin filters, repos without origin and realpath dedupe.
import { promises as fsp } from 'fs';
import * as path from 'path';
import { runGit } from './git/runner';
import { RepoInfo } from './model';
import { trim } from './text';

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

/**
 * Lower-case; an scp-like ssh origin "user@host:path" (no "://") becomes "host/path", so
 * "git@github.com:Owner/x" and "https://github.com/owner/x" both contain "github.com/owner/".
 */
function normalizeForMatch(s: string): string {
  const o = s.toLowerCase();
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
 * scheme URLs, no trailing ".git" or "/". null for anything else (local paths, file URLs).
 */
export function parseOrigin(origin: string): ParsedOrigin | null {
  const o = trim(origin);
  let prefix: string;
  let repoPath: string;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(?:[^@/]*@)?([^/]+)\/(.*)$/.exec(o);
  const scp = /^((?:[^@/:]+@)?)([^/:]{2,}):(?!\/\/)(.*)$/.exec(o);
  if (scheme) {
    if (scheme[1].toLowerCase() === 'file') return null;
    prefix = `${scheme[1].toLowerCase()}://${scheme[2].toLowerCase()}/`;
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

async function children(dir: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

async function readOrigin(dir: string): Promise<string> {
  const r = await runGit(dir, ['config', '--get', 'remote.origin.url']);
  return r.launched && r.code === 0 ? trim(r.out) : '';
}

/**
 * Repositories in workspace folders (the folder itself if it is a repository, else its direct
 * children) and direct children of roots. Skips folder names in exclude and origins not
 * matching any originFilter entry (a repository without origin only passes an empty filter).
 * Deduplicated by realpath; sorted by name (case-insensitive), then path.
 */
export async function discoverRepos(o: DiscoverOptions): Promise<RepoInfo[]> {
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

  const found = await Promise.all(unique.map(async (dir): Promise<RepoInfo | null> => {
    if (!(await isRepo(dir))) return null;
    const origin = await readOrigin(dir);
    if (o.originFilter.length > 0 && !(origin && o.originFilter.some((f) => originMatches(origin, f)))) return null;
    const parsed = origin ? parseOrigin(origin) : null;
    return {
      name: parsed ? parsed.name : path.basename(dir),
      owner: parsed ? parsed.owner : '',
      path: dir,
      origin,
      key: parsed ? parsed.key : origin ? stripRepoSuffix(origin) : dir,
    };
  }));

  const repos = found.filter((r): r is RepoInfo => r !== null);
  repos.sort((a, b) => {
    const x = a.name.toLowerCase();
    const y = b.name.toLowerCase();
    if (x !== y) return x < y ? -1 : 1;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  return repos;
}
