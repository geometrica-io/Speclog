// Helpers of the report tab (reportPanel.ts) that need no vscode.
import type { RepoSnapshot } from '@speclog/core';
import { LatestRun } from './latestRun';
import type { Run } from './latestRun';

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

/** The workspace shape the gate reads: its snapshot list. */
export interface GateWorkspace { readonly snapshots: readonly unknown[]; }

/** Same snapshot objects in the same order (the engine keeps an unchanged repository's snapshot object). */
export function sameSnapshots(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

/**
 * Which report result the tab uses: only the newest run's, a cancelled run is silent, and a shown report is
 * stale once the engine's workspace holds other snapshots than the one it was computed from. A new workspace
 * with the same snapshots (e.g. after a fetch that changed nothing) is not stale.
 */
export class ReportGate {
  private readonly runs = new LatestRun();
  private from: readonly unknown[] | undefined;
  private shown = false;

  /** Starts a run on this workspace (undefined: waiting for the first scan); the previous run is aborted. */
  begin(workspace: GateWorkspace | undefined): Run {
    this.from = workspace ? [...workspace.snapshots] : undefined;
    this.shown = false;
    return this.runs.begin();
  }

  /** What to do with a run's result: show the model, show the error, or ignore it. */
  settle(run: Run, model: unknown, error: string): 'show' | 'error' | 'ignore' {
    if (!run.isCurrent()) return 'ignore';
    if (model) {
      this.shown = true;
      return 'show';
    }
    return error === 'cancelled' ? 'ignore' : 'error';
  }

  /** A report is shown and the engine's current workspace holds other snapshots than the one it came from. */
  isStale(current: GateWorkspace | undefined): boolean {
    if (!this.shown || current === undefined) return false;
    return this.from === undefined || !sameSnapshots(this.from, current.snapshots);
  }

  cancel(): void {
    this.runs.cancel();
  }
}

/** Identity of the repository list (keys and names): the controls are resent only when it changes. */
export function repoSignature(snapshots: readonly RepoSnapshot[]): string {
  return JSON.stringify(repoChoices(snapshots, []).map((r) => [r.key, r.name]));
}
