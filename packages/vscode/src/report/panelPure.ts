// Helpers of the report tab (reportPanel.ts) that need no vscode.
import type { RepoSnapshot } from '@speclog/core';

/** The paths of every clone whose repository key is selected, in snapshot order. */
export function repoPathsOf(snapshots: readonly RepoSnapshot[], keys: readonly string[]): string[] {
  const want = new Set(keys);
  return snapshots.filter((s) => want.has(s.repo.key)).map((s) => s.repo.path);
}

/** One row per repository key, sorted by name (then key), checked when selected. */
export function repoChoices(snapshots: readonly RepoSnapshot[], selected: readonly string[]): { key: string; name: string; checked: boolean }[] {
  const names = new Map<string, string>();
  for (const s of snapshots) if (!names.has(s.repo.key)) names.set(s.repo.key, s.repo.name);
  const sel = new Set(selected);
  return [...names].map(([key, name]) => ({ key, name, checked: sel.has(key) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

const p2 = (n: number): string => String(n).padStart(2, '0');

/** Local date as YYYY-MM-DD. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** Local date and time as YYYY-MM-DD HH:MM. */
export function localStamp(d: Date): string {
  return `${localDay(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
