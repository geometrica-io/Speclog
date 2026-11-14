// Send to agent: decides whether an item may be handed to a coding agent, and what the prompt must warn about.
import { findDependency } from './status';
import type { ResolvedItem, Workspace } from './status';

export type GuardKind = 'decision' | 'openDepends' | 'onBranch' | 'unverified';

export interface Guard {
  kind: GuardKind;
  /** Shown to the user before sending. */
  message: string;
  /** Written into the prompt for the agent. */
  promptLine: string;
}

export interface AgentAvailability {
  enabled: boolean;
  /** Non-empty only when enabled is false. */
  reason: string;
  /** Order: decision, openDepends, onBranch, unverified. */
  guards: Guard[];
}

/** The branch the item's task file is read from: the branch holding its program if branch-only, else main. */
export function sourceBranch(w: Workspace, r: ResolvedItem): string {
  const snap = w.snapshots.find((s) => s.repo.path === r.repoPath);
  if (!snap) return '';
  if (r.branchOnly) {
    const b = snap.branches.find((x) => x.programs.includes(r.program));
    if (b) return b.tip.name;
  }
  return snap.main.name;
}

export function agentAvailability(w: Workspace, r: ResolvedItem): AgentAvailability {
  const off = (reason: string): AgentAvailability => ({ enabled: false, reason, guards: [] });
  if (r.status === 'done' || r.status === 'dropped') return off(`The item is already ${r.status}.`);
  const snap = w.snapshots.find((s) => s.repo.path === r.repoPath);
  if (snap && snap.error) return off(`Git failed for this repository: ${snap.error}`);

  const guards: Guard[] = [];
  if (r.status === 'decision') {
    guards.push({
      kind: 'decision',
      message: 'This item is a pending decision.',
      promptLine: 'This item is marked as a decision: ask me before writing code.',
    });
  }
  const open = r.item.depends
    .map((d) => ({ d, dep: findDependency(w, r.repo, d) }))
    .filter((x) => !x.dep || (x.dep.status !== 'done' && x.dep.status !== 'dropped'))
    .map((x) => (x.dep ? x.d : `${x.d} (not found)`));
  if (open.length > 0) {
    const list = open.join(', ');
    guards.push({
      kind: 'openDepends',
      message: `Depends on items that are not done: ${list}.`,
      promptLine: `These dependencies are not done yet: ${list}. Check them before starting.`,
    });
  }
  if (r.status === 'onBranch') {
    const names = r.branches.join(', ');
    guards.push({
      kind: 'onBranch',
      message: `Work on this item is already on branch ${names}.`,
      promptLine: `Work on this item already exists on branch ${names}; continue from there instead of starting over.`,
    });
  }
  if (r.status === 'unverified') {
    guards.push({
      kind: 'unverified',
      message: 'The file says done but there is no evidence in git.',
      promptLine: 'The task file says this is done but there is no evidence in git: verify before changing anything.',
    });
  }
  return { enabled: true, reason: '', guards };
}
