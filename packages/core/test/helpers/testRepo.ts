// Throwaway git repos for tests. Every repo lives under a folder whose path has spaces and
// non-ASCII characters (<tmp>/speclog tests/Proje Ç ğ/...), so all git calls are exercised
// with such paths (Review Focus 1).
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runGit, GitResult } from '../../src/git/runner';

export const TEST_BASE = path.join(os.tmpdir(), 'speclog tests', 'Proje Ç ğ');

let counter = 0;

/** Creates an empty directory <TEST_BASE>/<prefix>_<random>_<n>; forward slashes. */
export function makeTempDir(prefix: string): string {
  const p = path.join(TEST_BASE, `${prefix}_${crypto.randomBytes(4).toString('hex')}_${counter++}`);
  fs.mkdirSync(p, { recursive: true });
  return p.split(path.sep).join('/');
}

export function removeTree(dir: string): void {
  // Node's rm clears the read-only attribute of git object files on Windows.
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function must(dir: string, args: string[], opts: { env?: Record<string, string>; stdin?: string } = {}): Promise<GitResult> {
  const r = await runGit(dir, args, opts);
  if (!r.launched || r.code !== 0) throw new Error(`git ${args.join(' ')} failed in ${dir}: ${r.err}`);
  return r;
}

export class TestRepo {
  private constructor(public readonly dir: string) {}

  static async create(name = 'repo', defaultBranch = 'main'): Promise<TestRepo> {
    const r = new TestRepo(makeTempDir(name));
    await must(r.dir, ['init', '-q']);
    await must(r.dir, ['symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`]);
    await must(r.dir, ['config', 'user.name', 'Test']);
    await must(r.dir, ['config', 'user.email', 'test@example.com']);
    await must(r.dir, ['config', 'commit.gpgsign', 'false']);
    await must(r.dir, ['config', 'core.autocrlf', 'false']);
    return r;
  }

  /** Runs git in the repo; never throws. */
  git(args: string[], opts: { env?: Record<string, string>; stdin?: string } = {}): Promise<GitResult> {
    return runGit(this.dir, args, opts);
  }

  write(relPath: string, content: string): void {
    const p = path.join(this.dir, relPath);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }

  /**
   * Writes files, stages everything, commits (allow-empty). Non-empty isoDate sets
   * GIT_AUTHOR_DATE and GIT_COMMITTER_DATE for this commit.
   */
  async commit(msg: string, files: Record<string, string> = {}, isoDate = ''): Promise<void> {
    for (const [k, v] of Object.entries(files)) this.write(k, v);
    await must(this.dir, ['add', '-A']);
    const env = isoDate ? { GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate } : undefined;
    await must(this.dir, ['commit', '-q', '--allow-empty', '-m', msg], { env });
  }

  /** Creates and switches to a branch. */
  async branch(name: string): Promise<void> { await must(this.dir, ['checkout', '-q', '-b', name]); }
  async checkout(name: string): Promise<void> { await must(this.dir, ['checkout', '-q', name]); }
  async merge(name: string): Promise<void> {
    await must(this.dir, ['merge', '-q', '--no-ff', '-m', `Merge ${name}`, name]);
  }
  async head(): Promise<string> {
    return (await must(this.dir, ['rev-parse', 'HEAD'])).out.trim();
  }

  cleanup(): void { removeTree(this.dir); }
}

/**
 * Bare "remote" plus a clone-like working repo whose origin points to it, so origin/* refs
 * exist. After create(): `work` has one pushed commit on main and origin/HEAD set.
 */
export class TestRemote {
  private constructor(public readonly bare: string, public readonly work: TestRepo) {}

  static async create(name = 'remote'): Promise<TestRemote> {
    const bare = makeTempDir(`${name}_bare`);
    const work = await TestRepo.create(name);
    const t = new TestRemote(bare, work);
    await must(bare, ['init', '-q', '--bare']);
    await must(bare, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    await must(work.dir, ['remote', 'add', 'origin', bare]);
    await work.commit('init', { 'README.md': 'x\n' });
    await must(work.dir, ['push', '-q', '-u', 'origin', 'main']);
    await must(work.dir, ['remote', 'set-head', 'origin', '-a']);
    return t;
  }

  /** Pushes a branch with one commit to origin, then drops the local branch (keeps origin/<name>). */
  async pushRemoteOnlyBranch(branch: string, file: string): Promise<void> {
    await this.work.branch(branch);
    await this.work.commit(`on ${branch}`, { [file]: 'y\n' });
    await must(this.work.dir, ['push', '-q', 'origin', branch]);
    await this.work.checkout('main');
    await must(this.work.dir, ['branch', '-q', '-D', branch]);
  }

  cleanup(): void {
    this.work.cleanup();
    removeTree(this.bare);
  }
}
