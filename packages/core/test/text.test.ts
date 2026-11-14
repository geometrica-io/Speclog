import { describe, it, expect } from 'vitest';
import { foldForSearch, splitLines, trim, isValidDate, dayNumber, daysBetween } from '../src/text';

describe('text helpers', () => {
  it('FoldForSearch folds case and Turkish letters', () => {
    expect(foldForSearch('BURKULMA')).toBe(foldForSearch('burkulma'));
    expect(foldForSearch('İç')).toBe('iç');
    expect(foldForSearch('Işık')).toBe('işik');
    expect(foldForSearch('ÇĞÖŞÜ')).toBe('çğöşü');
  });

  it('SplitLines handles LF and CRLF', () => {
    expect(splitLines('a\r\nb\nc')).toEqual(['a', 'b', 'c']);
  });

  it('Trim strips blanks and line ends', () => {
    expect(trim(' \t a b \r\n')).toBe('a b');
    expect(trim('\r\n')).toBe('');
    expect(trim('x')).toBe('x');
  });

  it('dates are validated against the calendar', () => {
    expect(isValidDate('2026-11-10')).toBe(true);
    expect(isValidDate('2024-02-29')).toBe(true);
    expect(isValidDate('2000-02-29')).toBe(true);
    expect(isValidDate('2023-02-29')).toBe(false);
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('1900-02-29')).toBe(false);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-04-31')).toBe(false);
    expect(isValidDate('2026-12-31')).toBe(true);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-00-10')).toBe(false);
    expect(isValidDate('2026-01-00')).toBe(false);
    expect(isValidDate('2026-1a-01')).toBe(false);
    expect(isValidDate('2026/01/01')).toBe(false);
    expect(isValidDate('26-01-01')).toBe(false);
    expect(dayNumber('2026-02-30')).toBeNaN();
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2025-12-30', '2026-01-02')).toBe(3);
    expect(daysBetween('2026-01-31', '2026-02-01')).toBe(1);
  });
});
