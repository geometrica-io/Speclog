import type { SourceFile } from './types';

/** Files ordered by path, so parse results do not depend on the caller's order. */
export function sortedByPath(files: readonly SourceFile[]): SourceFile[] {
  return [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
