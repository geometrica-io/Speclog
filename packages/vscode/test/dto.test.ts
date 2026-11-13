// Host-side DTO building: tree, details and lookups by key / item (keys are never parsed).
import { afterEach, describe, expect, it } from 'vitest';
import { RepoInfo, Workspace, applyPreset, buildSnapshot, buildTree, defaultFilter, resolveAll } from '@speclog/core';
import { TestRepo } from '../../core/test/helpers/testRepo';
import {
  branchSummary, filterFromDto, filterToDto, findNode, findRepoNode, itemDetails, keyOfItem, pathToKey, toTreeDto,
} from '../src/dto';

const T = 60000;
const repos: TestRepo[] = [];
afterEach(() => { while (repos.length) repos.pop()!.cleanup(); });

const info = (r: TestRepo, name: string): RepoInfo => ({ name, owner: '', path: r.dir, origin: '', key: `key:${name}` });
const today = '2026-11-12';

async function workspace(): Promise<Workspace> {
  const a = await TestRepo.create('dto_a');
  repos.push(a);
  await a.commit('Add tasks', { 'docs/tasks/p.md': '# Prog\nprogram: P\narea: Analysis/Buckling\ncreated: 2026-01-01\n\n'
    + '## A1 First\nstatus: open\nsize: M\nspec: docs/spec.md\ndepends: A2\n\n## A2 Second\nstatus: bug\n' });
  await a.commit('Do A1\n\nTask: A1', { 'x.txt': 'x\n' });
  const b = await TestRepo.create('dto_b');
  repos.push(b);
  await b.commit('Readme', { 'README.md': 'x\n' });
  const snaps = [await buildSnapshot(info(a, 'alpha'), { today }), await buildSnapshot(info(b, 'beta'), { today })];
  return resolveAll(snaps, 'unverified');
}

const tr = (s: string) => `<${s}>`;

describe('dto', () => {
  it('converts the program tree, translating placeholders and keeping keys opaque', async () => {
    const ws = await workspace();
    const dto = toTreeDto(buildTree(ws, 'program', defaultFilter()), tr);
    expect(dto.kind).toBe('root');
    expect(dto.children.map((c) => [c.label, c.kind, c.done, c.total])).toEqual([['alpha', 'branch', 1, 2], ['beta', 'branch', 0, 0]]);
    const ph = dto.children[1].children[0];
    expect(ph).toMatchObject({ kind: 'placeholder', label: '<No task files>', selectKey: dto.children[1].key });
    const leaf = dto.children[0].children[0].children[0];
    expect(leaf).toMatchObject({ kind: 'item', id: 'A1', label: 'First', status: 'done', repo: 'alpha' });
  }, T);

  it('finds nodes by key and by item, and the path down to them', async () => {
    const ws = await workspace();
    const tree = buildTree(ws, 'program', defaultFilter());
    const a2 = ws.items.find((r) => r.item.id === 'A2')!;
    const key = keyOfItem(tree, a2)!;
    expect(findNode(tree, key)!.item).toBe(a2);
    const path = pathToKey(tree, key);
    expect(path).toHaveLength(3);
    expect(path[2]).toBe(key);
    expect(findRepoNode(tree, ws.snapshots[1].repo.path, ws.snapshots)!.label).toBe('beta');
    expect(findRepoNode(tree, ws.snapshots[0].repo.path)!.label).toBe('alpha');
  }, T);

  it('builds item details with dependency, commits and spec state', async () => {
    const ws = await workspace();
    const a1 = ws.items.find((r) => r.item.id === 'A1')!;
    const d = itemDetails(ws, a1, 'k', 'missing');
    expect(d).toMatchObject({ kind: 'item', repo: 'alpha', id: 'A1', status: 'done', size: 'M', area: 'Analysis/Buckling',
      spec: 'docs/spec.md', specState: 'missing', format: 'docsTasks', taskFile: 'docs/tasks/p.md', repoKey: 'key:alpha' });
    expect(d.depends).toEqual([{ text: 'A2', target: { repoPath: a1.repoPath, id: 'A2', title: 'Second', repo: 'alpha', status: 'bug' } }]);
    expect(d.commits).toHaveLength(1);
    expect(d.commits[0]).toMatchObject({ subject: 'Do A1', closes: true });
  }, T);

  it('summarizes a branch by status from the unfiltered tree, with the oldest open item', async () => {
    const ws = await workspace();
    const full = buildTree(ws, 'program', applyPreset('all'));
    const s = branchSummary(full.children[0], tr);
    expect(s).toMatchObject({ kind: 'branch', label: 'alpha', done: 1, total: 2, note: '' });
    expect(s.byStatus).toEqual([{ status: 'done', count: 1 }, { status: 'bug', count: 1 }]);
    expect(s.oldest).toMatchObject({ id: 'A2', status: 'bug' });
    expect(branchSummary(full.children[1], tr).note).toBe('<No task files>');
  }, T);

  it('round-trips the filter', () => {
    const f = defaultFilter();
    f.sizes.add('M');
    f.search = 'x';
    const dto = filterToDto(f);
    expect(dto.statuses).not.toContain('dropped');
    const back = filterFromDto(dto);
    expect([...back.sizes]).toEqual(['M']);
    expect(back.search).toBe('x');
    expect(filterFromDto({ statuses: ['nonsense' as never, 'bug'], hiddenRepos: [], sizes: [], search: '' }).statuses)
      .toEqual(new Set(['bug']));
  });
});
