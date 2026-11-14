// Builds the webview DTOs from core data and looks nodes up by key or item. Pure (no `vscode`):
// tree keys are opaque, so nodes are found by comparing keys or node.item, never by parsing.
import {
  ALL_STATUSES, AgentBlock, AttentionItem, Filter, NO_AREA_KEY, NO_DATE_KEY, ResolvedItem, Status, TreeNode,
  Workspace, agentAvailability, findDependency, repoNodeKey,
} from '@speclog/core';
import type {
  AttentionItemDto, BranchSummaryDto, FilterDto, ItemDetailsDto, Status as StatusDto, TreeNodeDto,
} from './protocol';
import { STATUS_ORDER } from './protocol';

/** Compile-time check: the protocol's status list is the core's. */
const sameStatus: [Status] extends [StatusDto] ? ([StatusDto] extends [Status] ? true : never) : never = true;
void sameStatus;

/** Translates a core English label (placeholders, "(no area)", "(no date)"). */
export type Translate = (english: string) => string;

function translatedLabel(n: TreeNode, tr: Translate): string {
  return n.placeholder || n.key === NO_AREA_KEY || n.key === NO_DATE_KEY ? tr(n.label) : n.label;
}

export function toTreeDto(root: TreeNode, tr: Translate): TreeNodeDto {
  const conv = (n: TreeNode, parentKey: string): TreeNodeDto => {
    const base = { key: n.key, label: translatedLabel(n, tr), done: n.done, total: n.total };
    if (n.item) {
      return { ...base, kind: 'item', id: n.item.item.id, status: n.item.status, repo: n.item.repo, children: [] };
    }
    if (n.placeholder) return { ...base, kind: 'placeholder', selectKey: parentKey, children: [] };
    return { ...base, kind: 'branch', children: n.children.map((c) => conv(c, n.key)) };
  };
  return { ...conv(root, ''), kind: 'root' };
}

export function findNode(root: TreeNode, key: string): TreeNode | undefined {
  if (root.key === key) return root;
  for (const c of root.children) {
    const f = findNode(c, key);
    if (f) return f;
  }
  return undefined;
}

/** Keys from the root's child down to the node with key; [] if absent. */
export function pathToKey(root: TreeNode, key: string): string[] {
  const path: string[] = [];
  const walk = (n: TreeNode): boolean => {
    for (const c of n.children) {
      path.push(c.key);
      if (c.key === key || walk(c)) return true;
      path.pop();
    }
    return false;
  };
  return walk(root) ? path : [];
}

/** Key of the leaf holding r (by identity, or by repository path + id after a rescan). */
export function keyOfItem(root: TreeNode, r: ResolvedItem): string | undefined {
  let found: string | undefined;
  const walk = (n: TreeNode): void => {
    if (found) return;
    if (n.item && (n.item === r || (n.item.repoPath === r.repoPath && n.item.item.id === r.item.id))) found = n.key;
    else for (const c of n.children) walk(c);
  };
  walk(root);
  return found;
}

/** Program view: the repository node of repoPath (undefined when hidden or filtered out). */
export function findRepoNode(root: TreeNode, repoPath: string): TreeNode | undefined {
  const key = repoNodeKey(repoPath);
  return root.children.find((c) => c.key === key);
}

/** blockText words why an item cannot be sent (the host translates it). */
export function itemDetails(
  ws: Workspace, r: ResolvedItem, key: string, specState: ItemDetailsDto['specState'], blockText: (b: AgentBlock) => string,
): ItemDetailsDto {
  const t = r.item;
  const evidence = t.evidence
    ? ws.snapshots.find((s) => s.repo.path === r.repoPath)?.evidence.find((e) => e.id === t.id)
    : undefined;
  let evidenceResult: ItemDetailsDto['evidenceResult'];
  if (evidence) {
    const done = r.status === 'done';
    const conflict = r.status !== 'dropped' && (evidence.expectPresent ? evidence.found !== done : evidence.found === done);
    evidenceResult = { found: evidence.found, conflict };
  }
  const agent = agentAvailability(ws, r);
  return {
    kind: 'item', key, repo: r.repo, repoPath: r.repoPath, repoKey: r.repoKey, id: t.id, title: t.title, status: r.status,
    branchOnly: r.branchOnly, historical: r.historical, trustedFromFile: r.trustedFromFile, flaggedUnverified: r.flaggedUnverified,
    size: t.size, priority: t.priority, area: t.area, created: t.created, note: t.note,
    depends: t.depends.map((dep) => {
      const d = findDependency(ws, r.repoPath, dep);
      return d
        ? { text: dep, target: { repoPath: d.repoPath, id: d.item.id, title: d.item.title, repo: d.repo, status: d.status } }
        : { text: dep };
    }),
    spec: t.spec, specState, format: r.program.format, taskFile: r.program.path, taskFileLine: t.line,
    fileStatusText: t.fileStatusText, branches: [...r.branches], commits: r.commits.map((c) => ({ ...c })),
    doneDate: r.doneDate, historyDate: t.historyDate, historyCommit: t.historyCommit, evidence: t.evidence, evidenceResult,
    agent: { enabled: agent.enabled, reason: agent.block ? blockText(agent.block) : '' },
  };
}

function leaves(n: TreeNode, out: ResolvedItem[] = []): ResolvedItem[] {
  if (n.item) out.push(n.item);
  for (const c of n.children) leaves(c, out);
  return out;
}

/** A branch node of the unfiltered tree: counts by status and the oldest open item. */
export function branchSummary(n: TreeNode, tr: Translate): BranchSummaryDto {
  const items = leaves(n);
  const counts = new Map<Status, number>();
  let oldest: ResolvedItem | undefined;
  const created = (r: ResolvedItem) => r.item.created || '~'; // undated after dated
  for (const r of items) {
    counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    if (r.status === 'done' || r.status === 'dropped') continue;
    if (!oldest || created(r) < created(oldest)) oldest = r;
  }
  const only = n.children.length === 1 && n.children[0].placeholder ? n.children[0] : undefined;
  return {
    kind: 'branch', key: n.key, label: translatedLabel(n, tr), note: only ? tr(only.label) : '', done: n.done, total: n.total,
    byStatus: STATUS_ORDER.filter((s) => counts.has(s)).map((s) => ({ status: s, count: counts.get(s)! })),
    oldest: oldest && { repoPath: oldest.repoPath, repo: oldest.repo, id: oldest.item.id, title: oldest.item.title,
      created: oldest.item.created, status: oldest.status },
  };
}

export function attentionToDto(rows: readonly AttentionItem[], ws: Workspace): AttentionItemDto[] {
  const keyOf = new Map(ws.snapshots.map((s) => [s.repo.path, s.repo.key]));
  return rows.map((a) => ({ ...a, repoKey: keyOf.get(a.repoPath) ?? '' }));
}

export function filterToDto(f: Filter): FilterDto {
  return { statuses: ALL_STATUSES.filter((s) => f.statuses.has(s)), hiddenRepos: [...f.hiddenRepos], sizes: [...f.sizes], search: f.search };
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Validates untrusted input from the webview or workspaceState. */
export function filterFromDto(d: Partial<FilterDto> | undefined): Filter {
  const statuses = strings(d?.statuses).filter((s): s is Status => (ALL_STATUSES as readonly string[]).includes(s));
  return {
    statuses: new Set(statuses),
    hiddenRepos: new Set(strings(d?.hiddenRepos)),
    sizes: new Set(strings(d?.sizes)),
    search: typeof d?.search === 'string' ? d.search.slice(0, 500) : '',
  };
}

/** Open keys that are still branches of the tree (in their order); leaves and vanished keys go. */
export function pruneOpenKeys(keys: readonly string[], root: TreeNode): string[] {
  const branches = new Set<string>();
  const walk = (n: TreeNode): void => {
    for (const c of n.children) {
      if (!c.item && !c.placeholder) {
        branches.add(c.key);
        walk(c);
      }
    }
  };
  walk(root);
  return keys.filter((k) => branches.has(k));
}
