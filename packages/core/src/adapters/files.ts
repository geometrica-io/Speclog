import type { ParseCache, SourceFile } from './types';

/** A ParseCache backed by a Map (one per snapshot build). */
export function createParseCache(): ParseCache {
  const values = new Map<string, unknown>();
  return {
    get<T>(key: string, compute: () => T): T {
      if (values.has(key)) return values.get(key) as T;
      const v = compute();
      values.set(key, v);
      return v;
    },
  };
}

/**
 * compute() through cache under step + the paths and blob ids of files; computed directly when
 * there is no cache or a file has no blob id. undefined entries (an absent optional file) count.
 */
export function memo<T>(cache: ParseCache | undefined, step: string, files: Array<SourceFile | undefined>, compute: () => T): T {
  if (!cache || files.some((f) => f !== undefined && !f.oid)) return compute();
  const key = [step, ...files.map((f) => (f ? `${f.path}\u0000${f.oid}` : ''))].join('\u0001');
  return cache.get(key, compute);
}

/** Files ordered by path, so parse results do not depend on the caller's order. */
export function sortedByPath(files: readonly SourceFile[]): SourceFile[] {
  return [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
