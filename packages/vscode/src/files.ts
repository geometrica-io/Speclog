// Path checks for files the webview asks to open. Pure Node (no `vscode`), unit-tested with vitest.
import * as path from 'path';

/** Absolute in POSIX or Windows terms: "/x", "\x", "C:\x", "C:x", "\\server\share". */
function looksAbsolute(p: string): boolean {
  return path.isAbsolute(p) || path.posix.isAbsolute(p) || path.win32.isAbsolute(p) || /^[A-Za-z]:/.test(p);
}

/**
 * The absolute path of rel inside repoRoot, or undefined when rel is empty, absolute, contains NUL, or
 * normalizes to the root itself or to anywhere outside it ("..", "docs/../../x").
 */
export function resolveInRepo(repoRoot: string, rel: string): string | undefined {
  if (rel === '' || rel.includes('\0') || looksAbsolute(rel)) return undefined;
  const root = path.resolve(repoRoot);
  const full = path.resolve(root, rel.replace(/\\/g, '/'));
  const inside = path.relative(root, full);
  if (inside === '' || inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) return undefined;
  return full;
}

/** A 1-based line from the webview as a non-negative integer; undefined when it is not a finite number. */
export function clampLine(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : undefined;
}

/**
 * The speclog.roots entries as absolute folders: "~" and "~/..." (or "~\...") expand to home;
 * relative paths (they would depend on the extension host's working folder), "~user" forms, empty
 * and non-string entries are skipped.
 */
export function expandRoots(raw: unknown, home: string): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    let p: string;
    if (s === '~') p = home;
    else if (s.startsWith('~/') || s.startsWith('~\\')) p = path.join(home, s.slice(2));
    else p = s;
    if (p !== '' && path.isAbsolute(p)) out.push(p);
  }
  return out;
}
