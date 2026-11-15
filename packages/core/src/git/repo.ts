// Repository queries: async port of ProjectManager src/core/GitRepo.cpp with the same git
// arguments. Every reader returns { value, error }: error is "" on success, otherwise
// "<what>: <reason>" while value holds empty or partial data, which must not replace data read
// earlier. Every function takes an optional AbortSignal (passed to runGit).
import { runGit, GitResult, GitOptions } from './runner';
import { BlobReader } from './blobReader';
import { extractTaskRefs, CommitRefs } from './commitRefs';
import { daysBetween, splitLines, trim } from '../text';

export interface RepoResult<T> { value: T; error: string; }

export interface CommitInfo {
  hash: string;
  /** YYYY-MM-DD, committer date. */
  date: string;
  subject: string;
  parents: string[];
  refs: CommitRefs;
}

/** name: shown to the user ("feature/x", "origin/feature/x"); ref: full ref name (key/display); hash: what git is given. */
export interface BranchTip { name: string; ref: string; hash: string; date: string; }

export interface MainRef {
  /** Shown: "origin/main", "main", "" if there is no default branch. */
  name: string;
  /** Full ref files are read from: refs/remotes/origin/<d>, or refs/heads/<d> when the local branch is ahead. */
  tipRef: string;
  /** Full refs: the existing ones of refs/remotes/origin/<d>, refs/heads/<d>. */
  reachRefs: string[];
}

const HEADS = 'refs/heads/';
const ORIGIN = 'refs/remotes/origin/';

function firstLine(s: string): string {
  const t = trim(s);
  const nl = t.search(/[\r\n]/);
  return trim(nl === -1 ? t : t.slice(0, nl));
}

/** "" when r ran and exited with one of ok; otherwise "<what>: <reason>". */
function failure(r: GitResult, what: string, ok: number[] = [0]): string {
  if (r.launched && !r.timedOut && !r.cancelled && ok.includes(r.code)) return '';
  let why = !r.launched ? (r.cancelled ? 'cancelled' : r.err || 'git could not be started')
    : r.timedOut ? 'timed out'
      : r.cancelled ? 'cancelled'
        : firstLine(r.err);
  if (!why) why = `exit code ${r.code}`;
  return `${what}: ${why}`;
}

/** Revisions for --stdin: one per line, excluded ones prefixed with '^'. */
function revInput(include: string[], exclude: string[]): string {
  return include.map((i) => `${i}\n`).join('') + exclude.map((e) => `^${e}\n`).join('');
}

/** 40 (SHA-1) or 64 (SHA-256) hex digits. */
export function isHexHash(h: string): boolean {
  return (h.length === 40 || h.length === 64) && /^[0-9a-fA-F]+$/.test(h);
}

/**
 * Default branch d: origin/HEAD's target when origin/<d> exists, else the first of main, master
 * that exists locally or as origin/<d>.
 */
export async function resolveMain(repo: string, signal?: AbortSignal): Promise<RepoResult<MainRef>> {
  const m: MainRef = { name: '', tipRef: '', reachRefs: [] };
  // Exit 1 (with --quiet): origin/HEAD is missing or not symbolic.
  const s = await runGit(repo, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], { signal });
  let error = failure(s, 'git symbolic-ref', [0, 1]);
  if (error) return { value: m, error };
  let head = '';
  if (s.code === 0) {
    const v = trim(s.out);
    if (v.startsWith(ORIGIN)) head = v.slice(ORIGIN.length);
  }
  const args = ['for-each-ref', '--format=%(refname)%1f%(objectname)'];
  const names = head ? [head, 'main', 'master'] : ['main', 'master'];
  for (const n of names) args.push(HEADS + n, ORIGIN + n);
  const r = await runGit(repo, args, { signal });
  error = failure(r, 'git for-each-ref');
  if (error) return { value: m, error };
  const tips = new Map<string, string>(); // full ref -> hash (exact names only)
  for (const line of splitLines(r.out)) {
    const f = line.split('\x1f');
    if (f.length === 2 && isHexHash(f[1])) tips.set(f[0], f[1]);
  }
  let d = '';
  if (head && tips.has(ORIGIN + head)) d = head;
  for (const c of ['main', 'master']) if (!d && (tips.has(HEADS + c) || tips.has(ORIGIN + c))) d = c;
  if (!d) return { value: m, error: '' }; // no commits / no default branch: not an error
  const remote = ORIGIN + d;
  const local = HEADS + d;
  const remoteOk = tips.has(remote);
  const localOk = tips.has(local);
  m.name = remoteOk ? `origin/${d}` : d;
  if (remoteOk) m.reachRefs.push(remote);
  if (localOk) m.reachRefs.push(local);
  m.tipRef = remoteOk ? remote : local;
  if (remoteOk && localOk && tips.get(remote) !== tips.get(local)) {
    // The local tip is used only when it is ahead (origin's tip is its ancestor).
    const anc = await runGit(repo, ['merge-base', '--is-ancestor', remote, local], { signal });
    error = failure(anc, 'git merge-base', [0, 1]);
    if (!error && anc.code === 0) m.tipRef = local;
  }
  return { value: m, error };
}

/**
 * Local + origin/* branches not merged into m.tipRef, minus default branch(es) and origin/HEAD.
 * window: only branches whose tip is at most window.days old (0 = all) as of window.today.
 */
export async function listOtherBranches(repo: string, m: MainRef, signal?: AbortSignal,
  window?: { today: string; days: number }): Promise<RepoResult<BranchTip[]>> {
  const tips: BranchTip[] = [];
  if (!m.name) return { value: tips, error: '' };
  const r = await runGit(repo, ['for-each-ref', `--no-merged=${m.tipRef}`,
    '--format=%(refname)%1f%(objectname)%1f%(committerdate:short)',
    'refs/heads', 'refs/remotes/origin'], { signal });
  const error = failure(r, 'git for-each-ref');
  if (error) return { value: tips, error };
  for (const line of splitLines(r.out)) {
    const f = line.split('\x1f');
    if (f.length !== 3 || !isHexHash(f[1])) continue;
    const ref = f[0];
    let name: string;
    if (ref.startsWith('refs/heads/')) name = ref.slice(11);
    else if (ref.startsWith('refs/remotes/')) name = ref.slice(13);
    else continue;
    if (ref === 'refs/remotes/origin/HEAD' || m.reachRefs.includes(ref)) continue;
    // committerdate:short is in the committer's zone, so the age can be one day off at the bound (as the stale age is).
    // Outside the window (tip older than `days`; a tip exactly `days` old is kept): not read at all.
    if (window && window.days > 0 && daysBetween(f[2], window.today) > window.days) continue;
    tips.push({ name, ref, hash: f[1], date: f[2] });
  }
  return { value: tips, error: '' };
}

/**
 * Commits reachable from include and not from exclude (newest first). Revisions go through
 * stdin, so any number of refs fits. dateOrder: --date-order, so no parent precedes a child
 * even when timestamps tie. since: "YYYY-MM-DD" or "" (all).
 */
export async function logCommits(repo: string, include: string[], exclude: string[], since = '',
  dateOrder = false, signal?: AbortSignal): Promise<RepoResult<CommitInfo[]>> {
  const out: CommitInfo[] = [];
  if (include.length === 0) return { value: out, error: '' };
  const args = ['log', '--no-show-signature', '--encoding=UTF-8', '--format=%H%x1f%P%x1f%cs%x1f%s%x1f%B%x1e'];
  if (dateOrder) args.push('--date-order');
  if (since) args.push(`--since=${since}`);
  args.push('--stdin', '--');
  const r = await runGit(repo, args, { stdin: revInput(include, exclude), signal });
  const error = failure(r, 'git log');
  if (error) return { value: out, error };
  for (const rec of r.out.split('\x1e')) {
    const b = rec.search(/[^\r\n]/);
    if (b === -1) continue;
    const f = rec.slice(b).split('\x1f');
    if (f.length < 5 || !isHexHash(f[0])) continue;
    out.push({
      hash: f[0],
      parents: f[1].split(' ').filter(isHexHash),
      date: f[2],
      subject: f[3],
      refs: extractTaskRefs(f.slice(4).join('\x1f')),
    });
  }
  return { value: out, error: '' };
}

/** Hashes reachable from include and not from exclude. */
export async function revList(repo: string, include: string[], exclude: string[], signal?: AbortSignal): Promise<RepoResult<Set<string>>> {
  const out = new Set<string>();
  if (include.length === 0) return { value: out, error: '' };
  const r = await runGit(repo, ['rev-list', '--stdin', '--'], { stdin: revInput(include, exclude), signal });
  const error = failure(r, 'git rev-list');
  if (error) return { value: out, error };
  for (const line of splitLines(r.out)) if (isHexHash(line)) out.add(line);
  return { value: out, error: '' };
}

/**
 * Files (blobs only, no subtrees) directly in dir at ref, repo-relative paths. A missing dir is
 * not an error.
 */
export async function listFiles(repo: string, ref: string, dir: string, signal?: AbortSignal): Promise<RepoResult<string[]>> {
  const files: string[] = [];
  const d = dir.replace(/[/\\]+$/, '');
  // No "--" here: after --end-of-options, ls-tree takes it as a path ("--" would list nothing).
  const args = ['-c', 'core.quotepath=false', 'ls-tree', '-z', '--end-of-options', ref];
  if (d) args.push(`${d}/`);
  const r = await runGit(repo, args, { signal });
  const error = failure(r, 'git ls-tree');
  if (error) return { value: files, error };
  // "<mode> SP <type> SP <object> TAB <path>"
  for (const rec of r.out.split('\0')) {
    const tab = rec.indexOf('\t');
    if (tab === -1) continue;
    const meta = rec.slice(0, tab).split(' ');
    if (meta.length === 3 && meta[1] === 'blob') files.push(rec.slice(tab + 1));
  }
  return { value: files, error: '' };
}

/** A file of a tree listing: repo-relative path and blob object id. */
export interface TreeBlob { path: string; oid: string; }

/**
 * Files (blobs) at ref under any of pathspecs, recursively, with their object ids. A pathspec is a
 * directory with a trailing "/" or a file path; one that does not exist adds nothing. [] lists nothing.
 * One ls-tree process per call; snapshot building lists through TreeReader (same result).
 */
export async function listTreeBlobs(repo: string, ref: string, pathspecs: string[], signal?: AbortSignal): Promise<RepoResult<TreeBlob[]>> {
  const files: TreeBlob[] = [];
  if (pathspecs.length === 0) return { value: files, error: '' };
  // Paths follow the ref directly (see listFiles: no "--" after --end-of-options).
  const r = await runGit(repo, ['-c', 'core.quotepath=false', 'ls-tree', '-r', '-z', '--end-of-options', ref, ...pathspecs],
    { signal });
  const error = failure(r, 'git ls-tree');
  if (error) return { value: files, error };
  for (const rec of r.out.split('\0')) {
    const tab = rec.indexOf('\t');
    if (tab === -1) continue;
    const meta = rec.slice(0, tab).split(' ');
    if (meta.length === 3 && meta[1] === 'blob' && isHexHash(meta[2])) files.push({ path: rec.slice(tab + 1), oid: meta[2] });
  }
  return { value: files, error: '' };
}

/** listTreeBlobs, paths only. */
export async function listTree(repo: string, ref: string, pathspecs: string[], signal?: AbortSignal): Promise<RepoResult<string[]>> {
  const r = await listTreeBlobs(repo, ref, pathspecs, signal);
  return { value: r.value.map((f) => f.path), error: r.error };
}

/**
 * Content of ref:path (UTF-8) through `git cat-file --batch`, which never stats the path (no
 * Windows path limit). value null when the blob cannot be read; a missing blob is not an error,
 * but git not starting, a timeout or a cancel is. Starts one cat-file process per call, so it is
 * for single reads (tests, one-off lookups); snapshot building reads through one BlobReader.
 */
export async function readBlob(repo: string, ref: string, path: string, signal?: AbortSignal): Promise<RepoResult<string | null>> {
  const reader = new BlobReader(repo, signal);
  try {
    const b = await reader.read(`${ref}:${path}`);
    return { value: b.value === null ? null : b.value.text, error: b.error };
  } finally {
    await reader.close();
  }
}

/** Fixed-string search in ref's tree. Exit 1 is "absent"; any other failure is 'error'. */
export async function grepFixed(repo: string, ref: string, text: string, pathspec: string,
  signal?: AbortSignal): Promise<'found' | 'absent' | 'error'> {
  const args = ['grep', '-q', '-F', '-e', text, '--end-of-options', ref, '--'];
  if (pathspec) args.push(pathspec);
  const r = await runGit(repo, args, { signal });
  if (failure(r, 'git grep', [0, 1])) return 'error';
  return r.code === 0 ? 'found' : 'absent';
}

/** Full hash of rev as a commit; "" when it names no commit (not an error). */
export async function resolveCommit(repo: string, rev: string, signal?: AbortSignal): Promise<RepoResult<string>> {
  // Exit 1 (with --quiet): rev names no commit.
  const r = await runGit(repo, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${rev}^{commit}`], { signal });
  const error = failure(r, 'git rev-parse', [0, 1]);
  if (error || r.code !== 0) return { value: '', error };
  const h = trim(r.out);
  return { value: isHexHash(h) ? h : '', error: '' };
}

/** Files changed by hash vs its first parent (merges list what they brought in; root: every file). */
export async function changedFiles(repo: string, hash: string, signal?: AbortSignal): Promise<RepoResult<string[]>> {
  const files: string[] = [];
  const p = await runGit(repo, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${hash}^1`], { signal });
  const args = ['-c', 'core.quotepath=false', 'diff-tree', '--no-commit-id', '--name-only', '-r', '-z'];
  if (p.launched && p.code === 0) args.push(`${hash}^1`);
  else args.push('--root');
  args.push(hash, '--');
  const r = await runGit(repo, args, { signal });
  const error = failure(r, 'git diff-tree');
  if (error) return { value: files, error };
  for (const n of r.out.split('\0')) if (n) files.push(n);
  return { value: files, error: '' };
}

/**
 * One git log over include (since = "YYYY-MM-DD", "" = all): hash -> files vs the first
 * parent (merges too; root commits list every file). No rename detection.
 */
export async function changedFilesSince(repo: string, include: string[], since: string,
  signal?: AbortSignal): Promise<RepoResult<Map<string, string[]>>> {
  const out = new Map<string, string[]>();
  if (include.length === 0) return { value: out, error: '' };
  const args = ['-c', 'core.quotepath=false', 'log', '--no-show-signature',
    '--diff-merges=first-parent', '--no-renames', '--name-only', '-z', '--format=%x1e%H'];
  if (since) args.push(`--since=${since}`);
  args.push('--stdin', '--');
  const r = await runGit(repo, args, { stdin: revInput(include, []), signal });
  const error = failure(r, 'git log');
  if (error) return { value: out, error };
  // Records: "\x1e<hash>\0" then "\n<file>\0<file>\0..." (no file list for an empty diff).
  for (const rec of r.out.split('\x1e')) {
    const nul = rec.indexOf('\0');
    const hash = trim(nul === -1 ? rec : rec.slice(0, nul));
    if (!isHexHash(hash)) continue;
    let files = out.get(hash);
    if (!files) { files = []; out.set(hash, files); }
    if (nul === -1) continue;
    for (const n of rec.slice(nul + 1).split('\0')) {
      const b = n.search(/[^\n]/);
      if (b !== -1) files.push(n.slice(b));
    }
  }
  return { value: out, error: '' };
}

/** Object ids of "<rev>:<path>" specs in one call; "" where the spec does not resolve. */
export async function objectIds(repo: string, specs: string[], signal?: AbortSignal): Promise<RepoResult<string[]>> {
  const ids = specs.map(() => '');
  if (specs.length === 0) return { value: ids, error: '' };
  const r = await runGit(repo, ['cat-file', '--batch-check=%(objectname)'],
    { stdin: specs.map((s) => `${s}\n`).join(''), signal });
  const error = failure(r, 'git cat-file');
  if (error) return { value: ids, error };
  const lines = splitLines(r.out);
  // A spec that does not resolve prints "<spec> missing" (or "ambiguous").
  for (let i = 0; i < specs.length && i < lines.length; ++i) if (isHexHash(lines[i])) ids[i] = lines[i];
  return { value: ids, error: '' };
}

/**
 * True when the working tree or index has changes (tracked or untracked, not ignored) under
 * pathspecs; [] = the whole repository. --no-optional-locks: status does not write the index.
 */
export async function hasUncommittedChanges(repo: string, pathspecs: string[], signal?: AbortSignal): Promise<RepoResult<boolean>> {
  const r = await runGit(repo, ['--no-optional-locks', '-c', 'core.quotepath=false', 'status', '--porcelain', '-z',
    '--untracked-files=all', '--', ...pathspecs], { signal });
  const error = failure(r, 'git status');
  return { value: !error && r.out.length > 0, error };
}

export const FETCH_SSH_COMMAND = 'ssh -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=4';

/** The arguments fetch uses (for tests). */
export function fetchArgs(): string[] {
  // An https transfer below 1 byte/s for 60 s is aborted, so a stalled fetch cannot hang forever.
  return ['-c', 'credential.interactive=false', '-c', 'http.lowSpeedLimit=1', '-c', 'http.lowSpeedTime=60',
    'fetch', '--quiet', '--prune', 'origin'];
}

/**
 * The options fetch uses. userSsh: GIT_SSH_COMMAND, GIT_SSH or core.sshCommand is set, so
 * FETCH_SSH_COMMAND is not imposed.
 */
export function fetchOptions(userSsh: boolean): GitOptions & { env: Record<string, string> } {
  const env: Record<string, string> = { GCM_INTERACTIVE: 'never' };
  // ssh: never prompt, and give up on a dead connection after about a minute.
  if (!userSsh) env.GIT_SSH_COMMAND = FETCH_SSH_COMMAND;
  return { timeoutMs: 60000, env, survivesCancel: true };
}

export async function userSshConfigured(repo: string, signal?: AbortSignal): Promise<boolean> {
  if (process.env.GIT_SSH_COMMAND || process.env.GIT_SSH) return true;
  const r = await runGit(repo, ['config', '--get', 'core.sshCommand'], { signal });
  return r.launched && r.code === 0 && trim(r.out) !== '';
}

/**
 * fetch --prune origin with a 60 s limit; never prompts (no terminal, no credential window) and
 * is not killed by an abort (which only stops waiting) or by this process exiting. A
 * stalled transfer still ends: https via http.lowSpeedLimit/Time, ssh via keep-alive limits
 * (unless the user set their own ssh command). value: the raw result; error "git fetch: ...".
 */
export async function fetch(repo: string, signal?: AbortSignal): Promise<RepoResult<GitResult>> {
  const opts = fetchOptions(await userSshConfigured(repo, signal));
  const r = await runGit(repo, fetchArgs(), { ...opts, signal });
  return { value: r, error: failure(r, 'git fetch') };
}
