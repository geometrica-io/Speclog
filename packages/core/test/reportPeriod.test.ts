import { describe, it, expect } from 'vitest';
import { periodOf, startDay, curveDays, PERIOD_PRESETS } from '../src/reportPeriod';

const T = '2026-11-19';
const r = (p: { from: string; to: string }) => `${p.from}..${p.to}`;

describe('periodOf', () => {
  it('lists presets in order', () => {
    expect(PERIOD_PRESETS).toEqual(['thisWeek', 'lastWeek', 'thisMonth', 'lastMonth', 'custom']);
  });
  it('computes presets', () => {
    expect(r(periodOf('thisWeek', T))).toBe('2026-11-16..2026-11-19');
    expect(r(periodOf('lastWeek', T))).toBe('2026-11-09..2026-11-15');
    expect(r(periodOf('thisMonth', T))).toBe('2026-11-01..2026-11-19');
    expect(r(periodOf('lastMonth', T))).toBe('2026-10-01..2026-10-31');
  });
  it('handles Monday and January', () => {
    const p = periodOf('thisWeek', '2026-11-16');
    expect(p.from).toBe('2026-11-16');
    expect(p.to).toBe('2026-11-16');
    expect(r(periodOf('lastMonth', '2026-01-10'))).toBe('2025-12-01..2025-12-31');
  });
  it('custom swaps, clamps, falls back', () => {
    expect(r(periodOf('custom', T, '2026-11-30', '2026-11-01'))).toBe('2026-11-01..2026-11-19');
    const bad = periodOf('custom', T, 'x', 'y');
    expect(bad.preset).toBe('thisWeek');
    expect(r(bad)).toBe('2026-11-16..2026-11-19');
    expect(periodOf('custom', T, '2026-11-02', '2026-11-05').preset).toBe('custom');
  });
  it('custom entirely in the future is clamped to today', () => {
    const p = periodOf('custom', T, '2026-12-01', '2026-12-05');
    expect(p).toEqual({ preset: 'custom', from: T, to: T });
  });
  it('custom from today', () => {
    expect(periodOf('custom', T, T, T)).toEqual({ preset: 'custom', from: T, to: T });
  });
  it('lastMonth in a leap year', () => {
    expect(r(periodOf('lastMonth', '2024-03-10'))).toBe('2024-02-01..2024-02-29');
  });
  it('lastWeek across the new year', () => {
    expect(r(periodOf('lastWeek', '2026-01-02'))).toBe('2025-12-22..2025-12-28');
  });
  it('thisWeek on a Sunday', () => {
    expect(r(periodOf('thisWeek', '2026-11-22'))).toBe('2026-11-16..2026-11-22');
  });
  it('an invalid today is a clear error, not a RangeError', () => {
    expect(() => periodOf('thisWeek', '2026-13-01')).toThrow('periodOf: invalid today "2026-13-01"');
    expect(() => periodOf('custom', '', '2026-11-01', '2026-11-02')).toThrow('periodOf: invalid today ""');
  });
});

describe('curveDays', () => {
  it('startDay is the day before from', () => {
    expect(startDay(periodOf('thisMonth', T))).toBe('2026-10-31');
  });
  it('lists every day for short periods', () => {
    expect(curveDays(periodOf('thisWeek', T))).toEqual([
      '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19',
    ]);
  });
  it('keeps every day at exactly 31 days of span', () => {
    const p = periodOf('custom', T, '2026-10-20', T); // startDay 10-19 .. 11-19 = 31
    expect(curveDays(p)).toHaveLength(32);
  });
  it('samples 30 days for long periods', () => {
    const p = periodOf('custom', T, '2025-11-19', T);
    const d = curveDays(p);
    expect(d).toHaveLength(30);
    expect(d[0]).toBe(startDay(p));
    expect(d[29]).toBe(p.to);
    expect(new Set(d).size).toBe(30);
    expect([...d].sort()).toEqual(d);
  });
  it('samples 30 distinct days just over the limit', () => {
    const p = periodOf('custom', T, '2026-10-19', T); // span 32
    const d = curveDays(p);
    expect(d).toHaveLength(30);
    expect(new Set(d).size).toBe(30);
  });
});
