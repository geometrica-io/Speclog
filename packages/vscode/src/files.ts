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
