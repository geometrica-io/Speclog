// Send to agent: decides whether an item may be handed to a coding agent, and what the prompt must warn about.
import { findDependency } from './status';
import type { ResolvedItem, Workspace } from './status';
import type { SourceFormat } from './model';

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
    return r.branches[0] ?? '';
  }
  return snap.main.name;
}

export function agentAvailability(w: Workspace, r: ResolvedItem): AgentAvailability {
  const off = (reason: string): AgentAvailability => ({ enabled: false, reason, guards: [] });
  if (r.status === 'done' || r.status === 'dropped') return off(`The item is already ${r.status}.`);
  const snap = w.snapshots.find((s) => s.repo.path === r.repoPath);
  if (!snap) return off('Repository not scanned yet.');
  if (snap.error) return off(`Git failed for this repository: ${snap.error}`);

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

export interface AgentPrompt {
  text: string;
  unknownPlaceholders: string[];
  /** A custom template lacks {guards} although guards apply. */
  guardsOmitted: boolean;
}

const TASK_RULE =
  'Put "Task: <id>" in the body of the commit that finishes this item, and "Task-Progress: <id>" in commits that only advance it. Never write "status: done" in the task file. Add new follow-up work to docs/tasks/ with a fresh ID.';

export function closingRules(format: SourceFormat, id: string): string {
  const first = TASK_RULE.split('<id>').join(id);
  if (format === 'docsTasks') return first;
  return `${first} In the same commit, mark the item done in its file the way the format expects (Backlog.md: the status field; Spec Kit: [x]).`;
}

export function placeholderValues(w: Workspace, r: ResolvedItem): Record<string, string> {
  const it = r.item;
  const depends = it.depends
    .map((d) => {
      const dep = findDependency(w, r.repo, d);
      return `${d} (${dep ? dep.status : 'not found'})`;
    })
    .join(', ');
  const guards = agentAvailability(w, r).guards.map((g) => g.promptLine).join('\n');
  return {
    repo: r.repo,
    repoPath: r.repoPath,
    id: it.id,
    title: it.title,
    status: r.status,
    size: it.size,
    priority: it.priority,
    area: it.area,
    file: r.program.path.split('\\').join('/'),
    line: String(it.line),
    branch: sourceBranch(w, r),
    note: it.note,
    evidence: it.evidence,
    depends,
    spec: it.spec || r.program.spec,
    closingRules: closingRules(r.program.format, it.id),
    guards,
  };
}

function builtInTemplate(r: ResolvedItem, v: Record<string, string>): string {
  const lines: string[] = [];
  lines.push('Work on {id}: {title}');
  lines.push('Repository: {repo}. Work only in the repository at {repoPath}.');
  const meta = ['Status: {status}', v.size && 'Size: {size}', v.priority && 'Priority: {priority}', v.area && 'Area: {area}'];
  lines.push(meta.filter(Boolean).join('; ') + '.');
  lines.push(`Task file: ${v.branch ? '{branch}:' : ''}{file}:{line}`);
  if (v.note) lines.push('Note: {note}');
  if (v.evidence) lines.push('Evidence: {evidence}');
  if (v.depends) lines.push('Depends on: {depends}');
  if (v.spec) lines.push('Spec: {spec}');
  const name = r.status === 'onBranch' ? r.branches[0] : r.branchOnly ? v.branch : '';
  if (name) {
    lines.push(`Continue on branch ${name}; check it out or create a worktree for it — ask me if the working tree has uncommitted changes.`);
  } else if (v.branch && r.status !== 'onBranch' && !r.branchOnly) {
    lines.push('Start from an up-to-date {branch} branch.');
  }
  if (v.guards) lines.push('{guards}');
  lines.push('{closingRules}');
  lines.push('When done, tell me the branch and the commit(s).');
  return lines.join('\n');
}

export function buildAgentPrompt(w: Workspace, r: ResolvedItem, template: string): AgentPrompt {
  const v = placeholderValues(w, r);
  const custom = template !== '';
  const tpl = custom ? template : builtInTemplate(r, v);
  const unknown: string[] = [];
  const text = tpl.replace(/\{([A-Za-z]+)\}/g, (m, name: string) => {
    if (Object.prototype.hasOwnProperty.call(v, name)) return v[name];
    if (!unknown.includes(name)) unknown.push(name);
    return m;
  });
  const guardsOmitted = custom && v.guards !== '' && !/\{guards\}/.test(template);
  return { text, unknownPlaceholders: unknown, guardsOmitted };
}
