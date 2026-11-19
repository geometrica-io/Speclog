import { describe, expect, it } from 'vitest';
import type { ReportItem, ReportModel, RepoReport } from '@speclog/core';
import { renderReportMarkdown } from '../src/report/renderMarkdown';
import type { ReportStrings } from '../src/report/reportStrings';

const s: ReportStrings = {
  title: 'Speclog report', summary: 'Summary', finished: 'Finished', inProgress: 'In progress', added: 'Added',
  remaining: 'Remaining', reopened: 'Reopened', droppedOrRemoved: 'Dropped or removed',
  changedColumn: 'Reopened, dropped or removed', total: 'Total',
  repository: 'Repository', period: 'Period', start: 'Start', end: 'End', delta: 'Change (points)',
  colId: 'ID', colTitle: 'Title', colProgram: 'Program', colClosed: 'Closed', colReason: 'Reason',
  colStatus: 'Status', colChange: 'Change', colProgress: 'Progress', changeDropped: 'Dropped', changeRemoved: 'Removed',
  isNew: 'New', onBranch: 'On branch {0}', newOnBranch: 'New on branch {0}', partial: 'Partial',
  progressCommit: 'Last progress {0}',
  footer: 'Counts cover main; work on branches is listed under In progress.',
  pastEndNote: 'On branch is known only for periods that end today.',
  generated: 'Generated {0}', repositories: 'Repositories: {0}', speclog: 'Speclog {0}', showItems: '{0} items',
  status: { open: 'Not started', partial: 'Partial', done: 'Done' },
};
const meta = { generated: '2026-11-19', version: '1.2.3' };

const item = (id: string, over: Partial<ReportItem> = {}): ReportItem => ({
  repo: 'r', repoPath: '/r', programPath: 'p.md', programTitle: 'Prog', id, title: 'T' + id, status: 'open',
  isNew: false, created: '', closedDate: '', ...over,
});

function repo(over: Partial<RepoReport> = {}): RepoReport {
  return {
    name: 'Repo', path: '/r', key: 'r', start: { done: 391, total: 528 }, end: { done: 412, total: 530 },
    programs: [{ path: 'p.md', title: 'Prog', start: { done: 1, total: 2 }, end: { done: 2, total: 2 } }],
    curve: [{ done: 1, total: 4 }, { done: 2, total: 4 }], finished: [], inProgress: [], added: [], remaining: [], changed: [],
    ...over,
  };
}

function model(r: RepoReport = repo(), over: Partial<ReportModel> = {}): ReportModel {
  return {
    period: { preset: 'custom', from: '2026-11-01', to: '2026-11-19' }, startDay: '2026-10-31', curveDays: ['a', 'b'],
    endIsLive: true, repos: [r], total: { start: r.start, end: r.end, curve: r.curve }, ...over,
  };
}

describe('renderReportMarkdown', () => {
  it('escapes pipes in titles and ends with a single newline', () => {
    const md = renderReportMarkdown(model(repo({ remaining: [item('X.1', { title: 'a | b' })] })), s, meta);
    expect(md).toContain('| X.1 | a \\| b | Prog | Not started |');
    expect(md.endsWith('\n')).toBe(true);
    expect(md.endsWith('\n\n')).toBe(false);
  });

  it('renders the summary table with start and end progress', () => {
    const md = renderReportMarkdown(model(), s, meta);
    expect(md).toContain('| Repository | Start | End | Change (points) | Finished | In progress | Added | Remaining | Reopened, dropped or removed |');
    expect(md).toContain('| Repo | 74% (391/528) | 78% (412/530) | +4 | 0 | 0 | 0 | 0 | 0 |');
    expect(md).toContain('74% (391/528) → 78% (412/530)');
  });

  it('omits empty lists and replaces newlines and backticks in cells', () => {
    const md = renderReportMarkdown(model(repo({ finished: [item('X.2', { title: 'a\nb `c`', closedDate: '2026-11-02' })] })), s, meta);
    expect(md).toContain('### Finished (1)');
    expect(md).not.toContain('### Reopened');
    expect(md).not.toContain('### Added');
    expect(md).toContain('a b \\`c\\`');
  });

  it('escapes markup and HTML in titles', () => {
    const md = renderReportMarkdown(model(repo({ remaining: [item('X.3', { title: '<img src=x> & a*b*c [x](http://e)' })] })), s, meta);
    expect(md).toContain('&lt;img src=x&gt; &amp; a\\*b\\*c \\[x\\](http://e)');
    expect(md).not.toContain('<img');
  });

  it('escapes backslashes', () => {
    const md = renderReportMarkdown(model(repo({ remaining: [item('X.4', { title: 'a\\|b_c' })] })), s, meta);
    expect(md).toContain('a\\\\\\|b\\_c');
  });

  it('escapes repo names in headings, header lines and rows', () => {
    const md = renderReportMarkdown(model(repo({ name: 'A|B\nC<d>' })), s, meta);
    expect(md).toContain('Repositories: A|B C&lt;d&gt;');
    expect(md).toContain('## A|B C&lt;d&gt;');
    expect(md).toContain('| A\\|B C&lt;d&gt; | 74%');
    expect(md).not.toContain('<d>');
  });

  it('renders In progress, Reopened and Dropped or removed rows', () => {
    const md = renderReportMarkdown(model(repo({
      inProgress: [item('P.1', { progressReason: { kind: 'onBranch', branches: ['feat/a|b'], date: '' }, isNew: true })],
      changed: [item('P.2', { change: 'reopened', status: 'partial' }), item('P.3', { change: 'dropped' }), item('P.4', { change: 'removed' })],
    })), s, meta);
    expect(md).toContain('| ID | Title | Program | Reason |');
    expect(md).toContain('| P.1 (New) | TP.1 | Prog | On branch feat/a\\|b |');
    expect(md).toContain('### Reopened (1)');
    expect(md).toContain('| P.2 | TP.2 | Prog | Partial |');
    expect(md).toContain('### Dropped or removed (2)');
    expect(md).toContain('| P.3 | TP.3 | Prog | Dropped |');
    expect(md).toContain('| P.4 | TP.4 | Prog | Removed |');
  });

  it('adds a Total row for several repos only', () => {
    const a = repo({ name: 'A' }), b = repo({ name: 'B', start: { done: 1, total: 2 }, end: { done: 2, total: 2 } });
    const two = model(a, { repos: [a, b], total: { start: { done: 392, total: 530 }, end: { done: 414, total: 532 }, curve: [] } });
    expect(renderReportMarkdown(two, s, meta)).toContain('| Total | 74% (392/530) | 78% (414/532) | +4 |');
    expect(renderReportMarkdown(model(), s, meta)).not.toContain('| Total |');
  });

  it('adds the past-end note only when the end is not live', () => {
    expect(renderReportMarkdown(model(), s, meta)).not.toContain(s.pastEndNote);
    expect(renderReportMarkdown(model(repo(), { endIsLive: false }), s, meta)).toContain(s.pastEndNote);
  });
});
