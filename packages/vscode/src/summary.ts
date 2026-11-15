// The numbers behind the status bar. Pure: no `vscode` import, so it is unit-tested with vitest.
import { AttentionKind, EngineState, buildTree, defaultFilter } from '@speclog/core';

/** Rows counted as unverified items (`? <n>`), not as Attention (`⚠ <n>`). */
const UNVERIFIED_KINDS: ReadonlySet<AttentionKind> = new Set<AttentionKind>(['unverifiedSummary']);

export interface Summary {
  repos: number;
  done: number;
  total: number;
  unverified: number;
  attention: number;
}

export function summarize(s: EngineState): Summary {
  // Root counts cover the whole workspace and do not depend on the filter.
  const root = buildTree(s.workspace, 'program', defaultFilter());
  return {
    repos: s.workspace.snapshots.length,
    done: root.done,
    total: root.total,
    unverified: root.unverified,
    attention: s.attention.filter((a) => !UNVERIFIED_KINDS.has(a.kind)).length,
  };
}
