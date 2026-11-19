import { describe, expect, it } from 'vitest';
import type { ReportItem, ReportModel, RepoReport } from '@speclog/core';
import { curveSvg, renderReportBody, renderReportDocument } from '../src/report/renderHtml';
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

describe('renderReport', () => {
  it('escapes model text and has no script', () => {
    const evil = '<img src=x onerror=alert(1)> & "q"';
    const html = renderReportDocument(model(repo({ finished: [item('A', { title: evil })] })), s, meta);
    expect(html).toContain('&lt;img');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;q&quot;');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toMatch(/^<!doctype html>/);
  });
  it('shows start and end percentages and the delta', () => {
    const html = renderReportBody(model(), s, meta);
    expect(html).toContain('74% (391/528)');
    expect(html).toContain('78% (412/530)');
    expect(html).toContain('+4');
  });
  it('shows a dash when total is 0', () => {
    const r = repo({ start: { done: 0, total: 0 }, end: { done: 0, total: 0 } });
    const html = renderReportBody(model(r), s, meta);
    expect(html).toContain('—');
    expect(html).not.toContain('NaN');
  });
  it('shows the past-end note only for non-live periods, and the footer', () => {
    expect(renderReportBody(model(repo(), { endIsLive: false }), s, meta)).toContain(s.pastEndNote);
    const live = renderReportBody(model(), s, meta);
    expect(live).not.toContain(s.pastEndNote);
    expect(live).toContain(s.footer);
  });
  it('wraps lists over 20 items in details', () => {
    const many = (n: number): ReportItem[] => Array.from({ length: n }, (_, i) => item('I' + i));
    const rep = (n: number): string => {
      const html = renderReportBody(model(repo({ remaining: many(n) })), s, meta);
      return html.slice(html.indexOf('<h3>Remaining'));
    };
    const withDetails = (h: string): boolean => h.slice(0, h.indexOf('<table')).includes('<details');
    expect(withDetails(rep(21))).toBe(true);
    expect(withDetails(rep(20))).toBe(false);
  });
  it('curveSvg draws a polyline from y=height to y=height/2', () => {
    const svg = curveSvg([{ done: 0, total: 10 }, { done: 5, total: 10 }], 200, 80);
    expect(svg).toContain('<polyline');
    expect(svg).toContain('points="0,80 200,40"');
  });
});

describe('renderReport details', () => {
  const many = (n: number): ReportItem[] => Array.from({ length: n }, (_, i) => item('I' + i));
  it('expandAll opens every details element', () => {
    const m = model(repo({ remaining: many(21) }));
    expect(renderReportDocument(m, s, meta)).toContain('<details><summary>');
    const all = renderReportDocument(m, s, meta, { expandAll: true });
    expect(all).not.toContain('<details>');
    expect(all).toContain('<details open><summary>21 items');
  });
  it('print CSS forces collapsed details content visible', () => {
    const html = renderReportDocument(model(), s, meta);
    expect(html).toContain('details::details-content { content-visibility: visible; display: block; }');
    expect(html).not.toContain('summary { display: none }');
  });
  it('renders Reopened and Dropped or removed sections only when non-empty', () => {
    const none = renderReportBody(model(), s, meta);
    expect(none).not.toContain('<h3>Reopened');
    expect(none).not.toContain('<h3>Dropped or removed');
    const html = renderReportBody(model(repo({ changed: [
      item('R1', { status: 'open', change: 'reopened' }), item('D1', { status: 'dropped', change: 'dropped' }),
      item('X1', { change: 'removed' })] })), s, meta);
    expect(html).toContain('<h3>Reopened (1)</h3>');
    expect(html).toContain('<h3>Dropped or removed (2)</h3>');
    expect(html).toContain('>Removed<');
    expect(html).toContain('>Dropped<');
    expect(html).toContain('Reopened, dropped or removed');
  });
  it('Remaining status column uses status wording', () => {
    expect(renderReportBody(model(repo({ remaining: [item('A')] })), s, meta)).toContain('>Not started<');
  });
  it('curve svg carries an accessible label', () => {
    const html = renderReportBody(model(), s, meta);
    expect(html).toContain('aria-label="74% (391/528) → 78% (412/530)"');
  });
});
