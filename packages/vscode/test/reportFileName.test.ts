import { describe, expect, it } from 'vitest';
import { defaultSaveDir, reportFileName } from '../src/report/fileName';

describe('reportFileName', () => {
  const p = { preset: 'thisWeek' as const, from: '2026-11-16', to: '2026-11-19' };
  it('names the file after the period', () => {
    expect(reportFileName(p, 'md')).toBe('speclog-report-2026-11-16-2026-11-19.md');
    expect(reportFileName(p, 'html')).toBe('speclog-report-2026-11-16-2026-11-19.html');
  });
  it('adds an optional suffix before the extension', () => {
    expect(reportFileName(p, 'html', 'ab12')).toBe('speclog-report-2026-11-16-2026-11-19-ab12.html');
  });
});

describe('defaultSaveDir', () => {
  it('prefers the first workspace folder', () => expect(defaultSaveDir('/w', '/h')).toBe('/w'));
  it('falls back to the home folder', () => expect(defaultSaveDir(undefined, '/h')).toBe('/h'));
});
