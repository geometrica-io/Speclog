// Status bar numbers: done / total from the program tree root, Attention without the unverified rows.
import { afterEach, describe, expect, it } from 'vitest';
import { AttentionItem, AttentionKind, EngineState, RepoInfo, buildSnapshot, resolveAll } from '@speclog/core';
import { TestRepo } from '../../core/test/helpers/testRepo';
import { summarize } from '../src/summary';

const T = 60000;
const repos: TestRepo[] = [];
afterEach(() => { while (repos.length) repos.pop()!.cleanup(); });

const info = (r: TestRepo, name: string): RepoInfo => ({ name, owner: '', path: r.dir, origin: '', key: r.dir });

function taskFile(ids: string[]): string {
  return `# P\nprogram: P\narea: A\ncreated: 2026-01-01\n\n${ids.map((id) => `## ${id} Title ${id}\nstatus: open\n`).join('\n')}`;
}

function row(kind: AttentionKind): AttentionItem {
  return { kind, repo: 'r', repoPath: 'r', ref: '', detail: '', line: 0, days: 0, expectPresent: false, found: false, code: '', count: 0 };
}

function state(over: Partial<EngineState>): EngineState {
  return { workspace: resolveAll([], 'unverified'), attention: [], busy: false, fetch: [], discoveryErrors: [], engineError: '', ...over };
}

describe('summarize', () => {
  it('counts done and total over every repository', async () => {
    const a = await TestRepo.create('sum_a');
    repos.push(a);
    await a.commit('Add tasks', { 'docs/tasks/p.md': taskFile(['A1', 'A2']) });
    await a.commit('Do A1\n\nTask: A1', { 'x.txt': 'x\n' });
    const b = await TestRepo.create('sum_b');
    repos.push(b);
    await b.commit('Add tasks', { 'docs/tasks/p.md': taskFile(['B1']) });
    const today = '2026-11-12';
    const snaps = [await buildSnapshot(info(a, 'a'), { today }), await buildSnapshot(info(b, 'b'), { today })];
    const s = summarize(state({ workspace: resolveAll(snaps, 'unverified') }));
    expect(s).toEqual({ repos: 2, done: 1, total: 3, unverified: 0, attention: 0 });
  }, T);

  it('leaves unverified rows out of the Attention count', () => {
    const s = summarize(state({ attention: [row('staleBranch'), row('unverifiedSummary'), row('gitError')] }));
    expect(s.attention).toBe(2);
    expect(s).toMatchObject({ repos: 0, done: 0, total: 0 });
  });
});
