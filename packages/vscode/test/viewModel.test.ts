// DOM-free webview helpers: tree rows, status classes, the property table and the Attention groups.
import { describe, expect, it } from 'vitest';
import {
  AttentionItemDto, BranchSummaryDto, ItemDetailsDto, STRING_KEYS, Strings, TreeNodeDto,
} from '../src/protocol';
import { attentionGroups, fmt, formatDetails, rowsForTree, statusClass, toggleInSet } from '../webview/viewModel';

/** Each string is its key, so tests read which text was chosen. */
const S = Object.fromEntries(STRING_KEYS.map((k) => [k, k])) as Strings;

function branch(key: string, children: TreeNodeDto[]): TreeNodeDto {
  return { key, label: key, kind: 'branch', done: 0, total: children.length, children };
}
function leaf(key: string): TreeNodeDto {
  return { key, label: key, kind: 'item', done: 0, total: 1, id: key, status: 'open', repo: 'r', children: [] };
}

const tree: TreeNodeDto = {
  key: 'root', label: '', kind: 'root', done: 0, total: 0,
  children: [
    branch('A', [branch('A/x', [leaf('i1'), leaf('i2')]), leaf('i3')]),
    branch('B', [leaf('i4')]),
  ],
};

describe('rowsForTree', () => {
  it('lists only the top level when nothing is open', () => {
    expect(rowsForTree(tree, new Set()).map((r) => r.key)).toEqual(['A', 'B']);
  });

  it('shows rows only for open branches', () => {
    const rows = rowsForTree(tree, new Set(['A', 'B']));
    expect(rows.map((r) => r.key)).toEqual(['A', 'A/x', 'i3', 'B', 'i4']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 0, 1]);
  });

  it('hides the children of a closed branch inside an open one', () => {
    expect(rowsForTree(tree, new Set(['A/x'])).map((r) => r.key)).toEqual(['A', 'B']);
    const rows = rowsForTree(tree, new Set(['A', 'A/x']));
    expect(rows.map((r) => r.key)).toEqual(['A', 'A/x', 'i1', 'i2', 'i3', 'B']);
  });

  it('records open state, children and the parent row', () => {
    const rows = rowsForTree(tree, new Set(['A']));
    expect(rows[0]).toMatchObject({ key: 'A', open: true, expandable: true, parent: -1 });
    expect(rows[1]).toMatchObject({ key: 'A/x', open: false, expandable: true, parent: 0 });
    expect(rows[2]).toMatchObject({ key: 'i3', expandable: false, parent: 0 });
  });

  it('handles keys containing slashes as opaque strings', () => {
    const t: TreeNodeDto = { ...tree, children: [branch('p/C:/repo/specs/001-x', [leaf('i/C:/repo/001-x/T001')])] };
    expect(rowsForTree(t, new Set(['p/C:/repo/specs/001-x'])).map((r) => r.key))
      .toEqual(['p/C:/repo/specs/001-x', 'i/C:/repo/001-x/T001']);
  });
});

describe('statusClass', () => {
  it('uses the amber class for unverified, distinct from bug', () => {
    expect(statusClass('unverified')).toBe('pill pill-amber');
    expect(statusClass('bug')).toBe('pill pill-red');
    expect(statusClass('done')).toBe('pill pill-green');
    expect(statusClass('onBranch')).toBe('pill pill-blue');
  });

  it('gives every status a class', () => {
    for (const s of ['open', 'partial', 'bug', 'verify', 'decision', 'dropped', 'done', 'onBranch', 'unverified'] as const) {
      expect(statusClass(s)).toMatch(/^pill pill-[a-z]+$/);
    }
  });
});

function item(over: Partial<ItemDetailsDto> = {}): ItemDetailsDto {
  return {
    kind: 'item', key: 'k', repo: 'R', repoPath: '/r', repoKey: 'git@x:R', id: 'T1', title: 'Title', status: 'open',
    branchOnly: false, historical: false, trustedFromFile: false, flaggedUnverified: false, size: 'M', priority: '',
    area: 'A/B', created: '2026-01-01', note: 'n', depends: [], spec: '', specState: 'none', format: 'docsTasks',
    taskFile: 'docs/tasks/a.md', taskFileLine: 7, fileStatusText: 'open', branches: [], commits: [], doneDate: '',
    historyDate: '', historyCommit: '', evidence: '', ...over,
  };
}

const labels = (d: ReturnType<typeof formatDetails>, group: string) =>
  d.find((g) => g.title === group)!.rows.map((r) => r.label);

describe('formatDetails', () => {
  it('groups an item into Item, Description, Source and trace', () => {
    const d = formatDetails(item(), S);
    expect(d.map((g) => g.title)).toEqual(['group.item', 'group.description', 'group.source']);
    expect(labels(d, 'group.item')).toEqual(['row.id', 'row.title', 'row.status', 'row.size', 'row.priority', 'row.area', 'row.created']);
    expect(d[0].rows[0].value).toEqual({ kind: 'text', text: 'R · T1' });
    expect(d[0].rows[5].value).toEqual({ kind: 'text', text: 'A › B' });
  });

  it('shows the "In file" row only for Backlog.md and Spec Kit items', () => {
    expect(labels(formatDetails(item(), S), 'group.source')).not.toContain('row.inFile');
    for (const format of ['backlogMd', 'specKit'] as const) {
      const d = formatDetails(item({ format, fileStatusText: '[x]' }), S);
      expect(labels(d, 'group.source')).toContain('row.inFile');
      const row = d[2].rows.find((r) => r.label === 'row.inFile')!;
      expect(row.value).toEqual({ kind: 'text', text: '[x]' });
    }
  });

  it('links the task file at its line and the spec only when it is inside the repository', () => {
    const d = formatDetails(item({ spec: 'docs/s.md', specState: 'ok' }), S);
    const src = d[2].rows;
    expect(src.find((r) => r.label === 'row.taskFile')!.value)
      .toEqual({ kind: 'link', text: 'docs/tasks/a.md', action: { type: 'openFile', repoKey: '/r', path: 'docs/tasks/a.md', line: 7 } });
    expect(src.find((r) => r.label === 'row.spec')!.value)
      .toMatchObject({ kind: 'link', action: { type: 'openFile', repoKey: '/r', path: 'docs/s.md' } });
    const out = formatDetails(item({ spec: '../x.md', specState: 'outside' }), S)[2].rows.find((r) => r.label === 'row.spec')!;
    expect(out.value).toEqual({ kind: 'text', text: '../x.md', muted: true, title: 'spec.outside' });
  });

  it('commits copy their hash; progress commits are muted', () => {
    const d = formatDetails(item({ commits: [
      { repo: 'R', hash: 'abcdef1234', date: '2026-02-01', subject: 'Do it', closes: true },
      { repo: 'Other', hash: '9999999999', date: '2026-01-01', subject: 'Start', closes: false },
    ] }), S);
    const v = d[2].rows.find((r) => r.label === 'row.commits')!.value;
    expect(v).toEqual({ kind: 'list', items: [
      { kind: 'link', text: 'abcdef1 · 2026-02-01 · Do it', title: 'commit.closes\ncommit.copy', action: { type: 'copy', text: 'abcdef1234' } },
      { kind: 'link', text: 'Other 9999999 · 2026-01-01 · Start', title: 'commit.progress\ncommit.copy', muted: true,
        action: { type: 'copy', text: '9999999999' } },
    ] });
  });

  it('adds an Evidence group only when the item has evidence', () => {
    expect(formatDetails(item(), S).map((g) => g.title)).not.toContain('group.evidence');
    const d = formatDetails(item({ evidence: 'grep x', evidenceResult: { found: true, conflict: true } }), S);
    expect(d[3].title).toBe('group.evidence');
    expect(d[3].rows[1].value).toEqual({ kind: 'text', text: 'evidence.found (evidence.conflict)', error: true });
  });

  it('summarizes a branch with counts and progress', () => {
    const b: BranchSummaryDto = { kind: 'branch', key: 'b', label: 'Prog', note: '', done: 1, total: 4,
      byStatus: [{ status: 'done', count: 1 }, { status: 'open', count: 3 }],
      oldest: { repoPath: '/r', repo: 'R', id: 'T2', title: 'Old', created: '2025-01-01', status: 'open' } };
    const d = formatDetails(b, S);
    expect(d.map((g) => g.title)).toEqual(['group.summary', 'group.byStatus', 'group.oldest']);
    expect(d[0].rows.find((r) => r.label === 'row.progress')!.value).toEqual({ kind: 'progress', fraction: 0.25, text: '25 %' });
    expect(d[1].rows[0]).toEqual({ label: '', pill: 'done', value: { kind: 'text', text: '1', right: true } });
    expect(d[2].rows[0].value).toEqual({ kind: 'link', text: 'R · T2  Old', action: { type: 'jump', repo: '/r', id: 'T2' } });
  });
});

function att(kind: AttentionItemDto['kind'], over: Partial<AttentionItemDto> = {}): AttentionItemDto {
  return { kind, repo: 'R', repoPath: '/r', repoKey: 'key', ref: '', detail: '', line: 0, days: 0,
    expectPresent: false, found: false, code: '', count: 0, ...over };
}

describe('attentionGroups', () => {
  it('groups rows by kind with counts, in input order', () => {
    const g = attentionGroups([att('staleBranch', { ref: 'b', days: 9, code: 'X1' }), att('staleBranch'), att('unverifiedSummary', { count: 3 })], S);
    expect(g.map((x) => [x.kind, x.title, x.rows.length])).toEqual([
      ['staleBranch', 'kind.staleBranch', 2], ['unverifiedSummary', 'kind.unverifiedSummary', 1],
    ]);
  });

  it('gives only unverifiedSummary rows the trust button', () => {
    const g = attentionGroups([att('fileDoneNoGit', { ref: 'T1' }), att('unverifiedSummary', { count: 3 })], S);
    expect(g[0].rows[0].button).toBeUndefined();
    expect(g[1].rows[0].button).toEqual({ text: 'att.trust', action: { type: 'command', id: 'trustTaskFiles', repoKey: 'key' } });
  });

  it('item rows jump to the item, format issues open the file at the line, hashes are shortened', () => {
    const g = attentionGroups([
      att('evidenceConflict', { ref: 'T1' }),
      att('formatIssue', { ref: 'docs/tasks/a.md', line: 4, code: 'bad-date', detail: 'bad-date: 2026-13-01' }),
      att('untaggedCommit', { ref: '0123456789abc', detail: 'Subject' }),
    ], S);
    expect(g[0].rows[0].action).toEqual({ type: 'jump', repo: '/r', id: 'T1' });
    expect(g[1].rows[0]).toMatchObject({ ref: 'docs/tasks/a.md:4', detail: 'issue.bad-date: 2026-13-01',
      action: { type: 'openFile', repoKey: '/r', path: 'docs/tasks/a.md', line: 4 } });
    expect(g[2].rows[0]).toMatchObject({ ref: '0123456', refTitle: '0123456789abc', detail: 'Subject',
      action: { type: 'jump', repo: '/r', id: '' } });
  });
});

describe('small helpers', () => {
  it('fmt fills numbered placeholders', () => {
    expect(fmt('{0} of {1}, {0}', 'a', 2)).toBe('a of 2, a');
  });

  it('toggleInSet treats empty as all and never empties the set', () => {
    const all = ['XS', 'S', ''];
    expect(toggleInSet([], all, 'S', false)).toEqual(['XS', '']);
    expect(toggleInSet(['XS', ''], all, 'S', true)).toEqual([]);
    expect(toggleInSet(['S'], all, 'S', false)).toEqual(['S']);
  });
});
