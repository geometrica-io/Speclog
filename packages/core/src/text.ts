const TURKISH_FOLD: Record<string, string> = {
  'Ç': 'ç', 'Ğ': 'ğ', 'İ': 'i', 'Ö': 'ö', 'Ş': 'ş', 'Ü': 'ü', 'ı': 'i',
};

/** ASCII lower-case plus Turkish letter folding (Ç Ğ İ Ö Ş Ü -> ç ğ i ö ş ü, ı -> i). */
export function foldForSearch(s: string): string {
  let out = '';
  for (const ch of s) {
    if (ch >= 'A' && ch <= 'Z') out += String.fromCharCode(ch.charCodeAt(0) + 32);
    else out += TURKISH_FOLD[ch] ?? ch;
  }
  return out;
}

/** Splits on \n and \r\n; a trailing newline does not add an empty last line. */
export function splitLines(s: string): string[] {
  const lines: string[] = [];
  let start = 0;
  while (start < s.length) {
    const nl = s.indexOf('\n', start);
    let end = nl === -1 ? s.length : nl;
    if (end > start && s[end - 1] === '\r') end--;
    lines.push(s.slice(start, end));
    if (nl === -1) break;
    start = nl + 1;
  }
  return lines;
}

/** Strips spaces, tabs, CR and LF from both ends. */
export function trim(s: string): string {
  return s.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
}

/** Days since 1970-01-01 for a valid YYYY-MM-DD date; NaN when invalid. */
export function dayNumber(ymd: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return NaN;
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const d = Number(ymd.slice(8, 10));
  if (m < 1 || m > 12 || d < 1) return NaN;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (d > days[m - 1]) return NaN;
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export function isValidDate(ymd: string): boolean {
  return !Number.isNaN(dayNumber(ymd));
}

/** b - a in days; 0 when either date is invalid. */
export function daysBetween(a: string, b: string): number {
  const x = dayNumber(a);
  const y = dayNumber(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return 0;
  return y - x;
}
