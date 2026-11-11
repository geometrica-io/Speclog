import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runGit, gitVersion } from '../src/git/runner';

const ms = (t0: number) => Date.now() - t0;

describe('runGit', () => {
  it('runs git version', async () => {
    const r = await runGit('.', ['--version']);
    expect(r.launched).toBe(true);
    expect(r.code).toBe(0);
    expect(r.out.startsWith('git version')).toBe(true);
  });

  it('gitVersion reports a real git >= 2.24', async () => {
    const v = await gitVersion();
    expect(v.ok).toBe(true);
    expect(v.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(v.error).toBe('');
  });

  it('nonexistent directory fails cleanly', async () => {
    const r = await runGit(path.join(os.tmpdir(), 'no', 'such', 'dir', 'xyz'), ['status']);
    expect(r.code !== 0 || !r.launched).toBe(true);
  });

  it('large output does not deadlock', async () => {
    const a = await runGit('.', ['help', '-a']);
    expect(a.code).toBe(0);
    expect(a.out.length).toBeGreaterThan(4096);
    const b = await runGit('.', ['-c', 'alias.e=!yes x | head -c 200000 1>&2', 'e']);
    expect(b.err.length).toBeGreaterThanOrEqual(200000);
  }, 30000);

  it('timeout kills process and its children', async () => {
    const marker = path.join(os.tmpdir(), `speclog_kill_${process.pid}_${Date.now()}`);
    const t0 = Date.now();
    const r = await runGit('.', ['-c', `alias.z=!sh -c 'sleep 4; echo x > "${marker.split(path.sep).join('/')}"'`, 'z'], { timeoutMs: 500 });
    expect(r.timedOut).toBe(true);
    expect(ms(t0)).toBeLessThan(3000);
    await new Promise((res) => setTimeout(res, 4500));
    expect(fs.existsSync(marker)).toBe(false);
    fs.rmSync(marker, { force: true });
  }, 15000);

  it('non-ASCII path works', async () => {
    const dir = path.join(os.tmpdir(), 'sl_çğüş_test_' + process.pid);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const r = await runGit(dir, ['init']);
    expect(r.code).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('5 concurrent calls do not wait on each other', async () => {
    const t0 = Date.now();
    const slow = runGit('.', ['-c', 'alias.s=!sleep 2', 's']);
    await new Promise((res) => setTimeout(res, 100));
    const fastTimes = await Promise.all(
      [0, 1, 2, 3].map(async () => {
        for (let k = 0; k < 5; k++) await runGit('.', ['--version']);
        return ms(t0);
      }),
    );
    for (const t of fastTimes) expect(t).toBeLessThan(1500);
    expect((await slow).code).toBe(0);
  }, 15000);

  it('background grandchild holding stdout does not block', async () => {
    const t0 = Date.now();
    const r = await runGit('.', ['-c', 'alias.b=!(sleep 5 &) ; echo done', 'b'], { timeoutMs: 8000 });
    expect(ms(t0)).toBeLessThan(3000);
    expect(r.out).toContain('done');
  }, 15000);

  it('stdin input reaches git', async () => {
    const r = await runGit('.', ['hash-object', '--stdin'], { stdin: 'hello\n' });
    expect(r.code).toBe(0);
    expect(r.out.startsWith('ce013625030ba8dba906f756967f9e9ca394464a')).toBe(true);
    const b = await runGit('.', ['hash-object', '--stdin'], { stdin: 'x'.repeat(1 << 20) });
    expect(b.code).toBe(0);
    expect(b.out.length).toBeGreaterThanOrEqual(40);
  }, 30000);

  it('extra environment reaches git and GIT_TERMINAL_PROMPT is 0', async () => {
    const r = await runGit('.', ['-c', 'alias.v=!echo $SL_TEST_VAR-$GCM_INTERACTIVE-$GIT_TERMINAL_PROMPT', 'v'], {
      env: { SL_TEST_VAR: 'ours', GCM_INTERACTIVE: 'never' },
    });
    expect(r.code).toBe(0);
    expect(r.out.startsWith('ours-never-0')).toBe(true);
  });

  it('abort signal cancels a running call', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);
    const t0 = Date.now();
    const r = await runGit('.', ['-c', 'alias.z=!sleep 5', 'z'], { signal: ac.signal });
    expect(r.cancelled).toBe(true);
    expect(r.timedOut).toBe(false);
    expect(ms(t0)).toBeLessThan(3000);
  }, 15000);

  it('an already aborted signal does not launch', async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await runGit('.', ['--version'], { signal: ac.signal });
    expect(r.launched).toBe(false);
    expect(r.cancelled).toBe(true);
  });
});
