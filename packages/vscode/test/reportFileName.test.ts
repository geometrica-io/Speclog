import { describe, expect, it } from 'vitest';
import { reportFileName } from '../src/report/fileName';

describe('reportFileName', () => {
  const p = { preset: 'thisWeek' as const, from: '2026-11-16', to: '2026-11-19' };
  it('names the file after the period', () => {
    expect(reportFileName(p, 'md')).toBe('speclog-report-2026-11-16-2026-11-19.md');
    expect(reportFileName(p, 'html')).toBe('speclog-report-2026-11-16-2026-11-19.html');
  });
});
