// Send to agent: decides whether an item may be handed to a coding agent, and what the prompt must warn about.
import { findDependency } from './status';
import type { ResolvedItem, Workspace } from './status';
import { itemFile, type SourceFormat } from './model';

export type GuardKind = 'decision' | 'openDepends' | 'onBranch' | 'unverified';

/** A dependency that is not done or dropped; found is false when no item has its id. */
export interface OpenDependency {
  id: string;
  found: boolean;
}

/**
 * Structured so the extension words (and translates) the confirmation itself; promptLine is the
 * English line written into the prompt for the agent.
 */
export type Guard =
  | { kind: 'decision'; promptLine: string }
  | { kind: 'openDepends'; depends: OpenDependency[]; promptLine: string }
  | { kind: 'onBranch'; branches: string[]; promptLine: string }
  | { kind: 'unverified'; promptLine: string };

/** Why an item cannot be sent; the extension words it. */
export type AgentBlock =
  | { kind: 'closed'; status: 'done' | 'dropped' }
  | { kind: 'notScanned' }
  | { kind: 'gitError'; error: string };

export interface AgentAvailability {
  enabled: boolean;
  /** Set only when enabled is false. */
  block?: AgentBlock;
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

/** Where an onBranch item's work is: its closing branches, else (branch-only) the branch it is read from. */
function workBranches(w: Workspace, r: ResolvedItem): string[] {
  if (r.branches.length > 0) return [...r.branches];
  const b = r.branchOnly ? sourceBranch(w, r) : '';
  return b ? [b] : [];
}

export function agentAvailability(w: Workspace, r: ResolvedItem): AgentAvailability {
  const off = (block: AgentBlock): AgentAvailability => ({ enabled: false, block, guards: [] });
  if (r.status === 'done' || r.status === 'dropped') return off({ kind: 'closed', status: r.status });
  const snap = w.snapshots.find((s) => s.repo.path === r.repoPath);
  if (!snap) return off({ kind: 'notScanned' });
  if (snap.error) return off({ kind: 'gitError', error: snap.error });

  const guards: Guard[] = [];
  if (r.status === 'decision') {
    guards.push({ kind: 'decision', promptLine: 'This item is marked as a decision: ask me before writing code.' });
  }
  // By repository path: clones of one origin share a name.
  const open = r.item.depends
    .map((d) => ({ d, dep: findDependency(w, r.repoPath, d) }))
    .filter((x) => !x.dep || (x.dep.status !== 'done' && x.dep.status !== 'dropped'))
    .map((x) => ({ id: x.d, found: x.dep !== undefined }));
  if (open.length > 0) {
    const list = open.map((x) => (x.found ? x.id : `${x.id} (not found)`)).join(', ');
    guards.push({
      kind: 'openDepends',
      depends: open,
      promptLine: `These dependencies are not done yet: ${list}. Check them before starting.`,
    });
  }
  if (r.status === 'onBranch') {
    const branches = workBranches(w, r);
    const where = branches.length > 0 ? `on branch ${branches.join(', ')}` : 'on another branch';
    guards.push({
      kind: 'onBranch',
      branches,
      promptLine: `Work on this item already exists ${where}; continue from there instead of starting over.`,
    });
  }
  if (r.status === 'unverified') {
    guards.push({
      kind: 'unverified',
      promptLine: 'The task file says this is done but there is no evidence in git: verify before changing anything.',
    });
  }
  return { enabled: true, guards };
}

export interface AgentPrompt {
  text: string;
  unknownPlaceholders: string[];
  /** A custom template lacks {guards} although guards apply. */
  guardsOmitted: boolean;
}

const TASK_RULE =
  'Put "Task: <id>" in the body of the commit that finishes this item, and "Task-Progress: <id>" in commits that only advance it.';
/** docs/tasks only: its status comes from git, and follow-up work goes into the same folder. */
const DOCS_TASKS_RULE = 'Never write "status: done" in the task file. Add new follow-up work to docs/tasks/ with a fresh ID.';

export function closingRules(format: SourceFormat, id: string): string {
  const first = TASK_RULE.split('<id>').join(id);
  if (format === 'docsTasks') return `${first} ${DOCS_TASKS_RULE}`;
  return `${first} In the same commit, mark the item done in its file the way the format expects (Backlog.md: the status field; Spec Kit: [x]).`;
}

export function placeholderValues(w: Workspace, r: ResolvedItem): Record<string, string> {
  const it = r.item;
  const depends = it.depends
    .map((d) => {
      const dep = findDependency(w, r.repoPath, d);
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
    file: itemFile(r.program, it).split('\\').join('/'),
    line: String(it.line),
    branch: sourceBranch(w, r),
    workBranch: r.branchOnly ? sourceBranch(w, r) || (r.branches[0] ?? '') : r.status === 'onBranch' ? (r.branches[0] ?? '') : '',
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
  if (v.workBranch) {
    lines.push('Continue on branch {workBranch}; check it out or create a worktree for it — ask me if the working tree has uncommitted changes.');
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
