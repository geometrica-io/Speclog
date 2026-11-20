import { describe, expect, it } from 'vitest';
import { PERIOD_PRESETS } from '@speclog/core';
import type { RepoSnapshot } from '@speclog/core';
import { MAX_KEY_LENGTH } from '../src/protocol';
import { LatestRun } from '../src/report/latestRun';
import { ReportGate, localDay, localStamp, repoChoices, repoPathsOf, repoSignature } from '../src/report/panelPure';
import { REPORT_MAX_KEY_LENGTH, REPORT_PRESETS, parseReportMessage } from '../src/reportProtocol';

describe('parseReportMessage', () => {
  it('accepts every valid message', () => {
    expect(parseReportMessage({ type: 'ready' })).toEqual({ type: 'ready' });
    expect(parseReportMessage({ type: 'refresh' })).toEqual({ type: 'refresh' });
    expect(parseReportMessage({ type: 'period', preset: 'lastMonth', from: '', to: '' }))
      .toEqual({ type: 'period', preset: 'lastMonth', from: '', to: '' });
    expect(parseReportMessage({ type: 'period', preset: 'custom', from: '2026-11-01', to: '2026-11-19' }))
      .toEqual({ type: 'period', preset: 'custom', from: '2026-11-01', to: '2026-11-19' });
    expect(parseReportMessage({ type: 'repos', keys: ['a', '/b'] })).toEqual({ type: 'repos', keys: ['a', '/b'] });
    expect(parseReportMessage({ type: 'repos', keys: [] })).toEqual({ type: 'repos', keys: [] });
    for (const format of ['html', 'md', 'pdf']) expect(parseReportMessage({ type: 'export', format })).toEqual({ type: 'export', format });
  });
  it('drops extra fields', () => {
    expect(parseReportMessage({ type: 'refresh', evil: 1 })).toEqual({ type: 'refresh' });
  });
  it('rejects non-objects and unknown types', () => {
    for (const m of [null, undefined, 1, 'ready', [], { type: 'nope' }, { type: 'command', id: 'refresh' }, {}]) {
      expect(parseReportMessage(m)).toBeNull();
    }
  });
  it('rejects an unknown preset or format', () => {
    expect(parseReportMessage({ type: 'period', preset: 'thisYear', from: '', to: '' })).toBeNull();
    expect(parseReportMessage({ type: 'period', preset: 'toString', from: '', to: '' })).toBeNull();
    expect(parseReportMessage({ type: 'export', format: 'pdfx' })).toBeNull();
    expect(parseReportMessage({ type: 'export' })).toBeNull();
  });
  it('rejects period dates that are not strings or too long', () => {
    expect(parseReportMessage({ type: 'period', preset: 'custom', from: 1, to: '' })).toBeNull();
    expect(parseReportMessage({ type: 'period', preset: 'custom', from: '', to: 'x'.repeat(REPORT_MAX_KEY_LENGTH + 1) })).toBeNull();
  });
  it('rejects a non-array keys, a non-string key and an over-long key', () => {
    expect(parseReportMessage({ type: 'repos', keys: 'a' })).toBeNull();
    expect(parseReportMessage({ type: 'repos', keys: ['a', 2] })).toBeNull();
    expect(parseReportMessage({ type: 'repos', keys: ['x'.repeat(REPORT_MAX_KEY_LENGTH + 1)] })).toBeNull();
    expect(parseReportMessage({ type: 'repos', keys: ['x'.repeat(REPORT_MAX_KEY_LENGTH)] })).not.toBeNull();
  });
  it('agrees with the board protocol and the core presets', () => {
    expect(REPORT_MAX_KEY_LENGTH).toBe(MAX_KEY_LENGTH);
    expect([...REPORT_PRESETS]).toEqual([...PERIOD_PRESETS]);
  });
});

describe('LatestRun', () => {
  it('aborts the previous run and only the newest is current', () => {
    const r = new LatestRun();
    const a = r.begin();
    expect(a.signal.aborted).toBe(false);
    expect(a.isCurrent()).toBe(true);
    const b = r.begin();
    expect(a.signal.aborted).toBe(true);
    expect(a.isCurrent()).toBe(false);
    expect(b.isCurrent()).toBe(true);
    expect(b.signal.aborted).toBe(false);
  });
  it('cancel() aborts the newest run', () => {
    const r = new LatestRun();
    r.begin();
    const b = r.begin();
    r.cancel();
    expect(b.signal.aborted).toBe(true);
    expect(b.isCurrent()).toBe(false);
  });
});

const snap = (key: string, name: string, path: string) => ({ repo: { key, name, path } }) as unknown as RepoSnapshot;

describe('report panel helpers', () => {
  const snaps = [snap('u1', 'beta', '/b'), snap('u2', 'alpha', '/a1'), snap('u2', 'alpha', '/a2'), snap('/c', 'gamma', '/c')];
  it('maps repository keys to the paths of every clone, in repository order', () => {
    expect(repoPathsOf(snaps, ['u2', '/c'])).toEqual(['/a1', '/a2', '/c']);
    expect(repoPathsOf(snaps, ['nope'])).toEqual([]);
  });
  it('lists repositories once per key, by name, with the selection checked', () => {
    expect(repoChoices(snaps, ['u1'])).toEqual([
      { key: 'u2', name: 'alpha', checked: false },
      { key: 'u1', name: 'beta', checked: true },
      { key: '/c', name: 'gamma', checked: false },
    ]);
  });
  it('formats local days and stamps', () => {
    const d = new Date(2026, 0, 5, 7, 3);
    expect(localDay(d)).toBe('2026-01-05');
    expect(localStamp(d)).toBe('2026-01-05 07:03');
  });
});

describe('ReportGate', () => {
  const s1 = { n: 1 }, s2 = { n: 2 };
  const w1 = { snapshots: [s1] }, w2 = { snapshots: [s2] };
  it('shows only the newest run and marks it stale after a newer workspace', () => {
    const g = new ReportGate();
    const a = g.begin(w1);
    const b = g.begin(w1);
    expect(g.settle(a, { ok: true }, '')).toBe('ignore');
    expect(g.isStale(w2)).toBe(false);
    expect(g.settle(b, { ok: true }, '')).toBe('show');
    expect(g.isStale(w1)).toBe(false);
    expect(g.isStale(undefined)).toBe(false);
    expect(g.isStale(w2)).toBe(true);
  });
  it('is silent for a cancelled run and reports other errors', () => {
    const g = new ReportGate();
    expect(g.settle(g.begin(w1), null, 'cancelled')).toBe('ignore');
    expect(g.settle(g.begin(w1), null, 'boom')).toBe('error');
    expect(g.isStale(w2)).toBe(false);
  });
  it('a new run clears the stale flag until it shows', () => {
    const g = new ReportGate();
    g.settle(g.begin(w1), { ok: true }, '');
    expect(g.isStale(w2)).toBe(true);
    const c = g.begin(w2);
    expect(g.isStale(w2)).toBe(false);
    g.cancel();
    expect(c.signal.aborted).toBe(true);
    expect(g.settle(c, { ok: true }, '')).toBe('ignore');
  });
});

describe('ReportGate staleness', () => {
  const s1 = { n: 1 }, s2 = { n: 2 };
  it('a newer workspace with the same snapshot objects is not stale (a routine fetch)', () => {
    const g = new ReportGate();
    g.settle(g.begin({ snapshots: [s1, s2] }), { ok: true }, '');
    expect(g.isStale({ snapshots: [s1, s2] })).toBe(false);
  });
  it('a replaced, added or removed snapshot is stale', () => {
    const g = new ReportGate();
    g.settle(g.begin({ snapshots: [s1, s2] }), { ok: true }, '');
    expect(g.isStale({ snapshots: [s1, { n: 2 }] })).toBe(true);
    expect(g.isStale({ snapshots: [s1, s2, { n: 3 }] })).toBe(true);
    expect(g.isStale({ snapshots: [s1] })).toBe(true);
  });
});

describe('repoSignature', () => {
  it('changes with the repository keys or names, not with the selection or clone order', () => {
    const a = [snap('u1', 'beta', '/b'), snap('u2', 'alpha', '/a')];
    expect(repoSignature(a)).toBe(repoSignature([...a].reverse()));
    expect(repoSignature(a)).not.toBe(repoSignature([snap('u1', 'beta2', '/b'), snap('u2', 'alpha', '/a')]));
    expect(repoSignature(a)).not.toBe(repoSignature([...a, snap('u3', 'c', '/c')]));
    expect(repoSignature(a)).toBe(repoSignature([...a, snap('u2', 'alpha', '/a2')]));
  });
});
