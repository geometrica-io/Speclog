// View trees (Program / Area / Time), filter and counts: port of ProjectManager src/core/ViewTree.cpp,
// extended with the repository -> format -> program hierarchy of Speclog's Program view.
import { ALL_STATUSES, SourceFormat, Status } from './model';
import type { ResolvedItem, Workspace } from './status';
import { foldForSearch, isValidDate } from './text';

export type ViewMode = 'program' | 'area' | 'time';

export interface Filter {
  statuses: Set<Status>;
  /** Repository keys (origin URL or path); hiding one hides every clone of it. */
  hiddenRepos: Set<string>;
  /** Empty = all; "" matches items without a size. */
  sizes: Set<string>;
  /** Matched against id, title and note (folded). */
  search: string;
}

export type FilterPreset = 'all' | 'open' | 'done' | 'onBranch' | 'bugs';

/** Keys of the catch-all branches; every other area / time key starts with "a/" / "t/". */
export const NO_AREA_KEY = 'a\u0001none';
export const NO_DATE_KEY = 't\u0001none';

const NON_DROPPED: readonly Status[] = ALL_STATUSES.filter((s) => s !== 'dropped');
const FORMAT_ORDER: readonly SourceFormat[] = ['docsTasks', 'backlogMd', 'specKit'];

export function defaultFilter(): Filter {
  return { statuses: new Set(NON_DROPPED), hiddenRepos: new Set(), sizes: new Set(), search: '' };
}

export function applyPreset(p: FilterPreset): Filter {
  const f = defaultFilter();
  switch (p) {
    case 'all': f.statuses = new Set(ALL_STATUSES); break;
    case 'open': f.statuses = new Set(NON_DROPPED.filter((s) => s !== 'done')); break;
    case 'done': f.statuses = new Set<Status>(['done']); break;
    case 'onBranch': f.statuses = new Set<Status>(['onBranch']); break;
    case 'bugs': f.statuses = new Set<Status>(['bug']); break;
  }
  return f;
}

export interface TreeNode {
  /** Stable, unique per view. */
  key: string;
  label: string;
  /** Whole branch, filter-independent: items with status done / not dropped / unverified. */
  done: number;
  total: number;
  unverified: number;
  /** Leaf only; valid while the Workspace it came from is alive. */
  item?: ResolvedItem;
  /** Program view: the only child of a repository without items ("Git error" / "No task files" / "No task items"). */
  placeholder: boolean;
  children: TreeNode[];
}

function node(key: string, label: string): TreeNode {
  return { key, label, done: 0, total: 0, unverified: 0, placeholder: false, children: [] };
}

function findOrAdd(v: TreeNode[], key: string, label: string): TreeNode {
  let n = v.find((c) => c.key === key);
  if (!n) {
    n = node(key, label);
    v.push(n);
  }
  return n;
}

function makeLeaf(r: ResolvedItem): TreeNode {
  const n = node(`i/${r.repoPath}/${r.item.id}`, r.item.title);
  n.item = r;
  return n;
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function count(n: TreeNode): void {
  if (n.item) {
    n.total = n.item.status === 'dropped' ? 0 : 1;
    n.done = n.item.status === 'done' ? 1 : 0;
    n.unverified = n.item.status === 'unverified' ? 1 : 0;
    return;
  }
  n.done = n.total = n.unverified = 0;
  for (const c of n.children) {
    count(c);
    n.done += c.done;
    n.total += c.total;
    n.unverified += c.unverified;
  }
}

/** Drops leaves failing the filter, then empty branches; placeholders stay unless the filter narrows. */
function prune(n: TreeNode, f: Filter): void {
  const narrow = narrowing(f);
  const kept: TreeNode[] = [];
  for (const c of n.children) {
    if (c.placeholder) {
      if (!narrow) kept.push(c);
    } else if (c.item) {
      if (matches(c.item, f)) kept.push(c);
    } else {
      prune(c, f);
      if (c.children.length > 0) kept.push(c);
    }
  }
  n.children = kept;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function lessLeaf(a: TreeNode, b: TreeNode): number {
  const x = a.item!, y = b.item!;
  return cmp(x.repo, y.repo) || cmp(x.repoPath, y.repoPath) || cmp(x.item.id, y.item.id);
}

function lessLabel(a: TreeNode, b: TreeNode): number {
  return cmp(foldForSearch(a.label), foldForSearch(b.label)) || cmp(a.label, b.label);
}

function sortArea(n: TreeNode, root: boolean): void {
  n.children.sort((a, b) => {
    const al = !!a.item, bl = !!b.item;
    if (al !== bl) return al ? 1 : -1; // branches before leaves
    if (al) return lessLeaf(a, b);
    if (root) {
      const an = a.key === NO_AREA_KEY, bn = b.key === NO_AREA_KEY;
      if (an !== bn) return an ? 1 : -1; // "(no area)" last
    }
    return lessLabel(a, b);
  });
  for (const c of n.children) if (!c.item) sortArea(c, false);
}

function sortTime(n: TreeNode): void {
  n.children.sort((a, b) => {
    const al = !!a.item, bl = !!b.item;
    if (al !== bl) return al ? 1 : -1;
    if (al) return lessLeaf(a, b);
    const an = a.key === NO_DATE_KEY, bn = b.key === NO_DATE_KEY;
    if (an !== bn) return an ? 1 : -1;
    return cmp(a.key, b.key);
  });
  for (const c of n.children) if (!c.item) sortTime(c);
}

/** Last two path segments, for telling same-named repositories apart. */
function lastSegments(path: string): string {
  return path.split(/[\\/]+/).filter((s) => s !== '').slice(-2).join('/');
}

/** Key of a repository node in the program view (unique per clone). */
export function repoNodeKey(repoPath: string): string {
  return `p/${repoPath}`;
}

function buildProgram(ws: Workspace, f: Filter, root: TreeNode): void {
  const repos = new Map<string, TreeNode>(); // repoPath -> node
  const repoNode = (path: string, name: string): TreeNode => {
    let n = repos.get(path);
    if (!n) {
      n = node(repoNodeKey(path), name);
      repos.set(path, n);
      root.children.push(n);
    }
    return n;
  };
  for (const s of ws.snapshots) {
    if (!f.hiddenRepos.has(s.repo.key)) repoNode(s.repo.path, s.repo.name);
  }
  const formats = new Map<string, SourceFormat>(); // program node key -> format
  for (const r of ws.items) {
    // A hidden repository gets no node, so it cannot add a location suffix to a shown one.
    if (f.hiddenRepos.has(r.repoKey)) continue;
    const repo = repoNode(r.repoPath, r.repo);
    const progKey = `p/${r.repoPath}/${r.program.path}`;
    formats.set(progKey, r.program.format);
    const prog = findOrAdd(repo.children, progKey, r.program.title || fileName(r.program.path));
    let parent = prog;
    if (r.item.group) parent = findOrAdd(prog.children, `${progKey}/g/${r.item.group}`, r.item.group);
    parent.children.push(makeLeaf(r));
  }
  const rank = (p: TreeNode) => FORMAT_ORDER.indexOf(formats.get(p.key) ?? 'docsTasks');
  for (const s of ws.snapshots) {
    const repo = repos.get(s.repo.path);
    if (!repo) continue;
    if (repo.children.length === 0) {
      const label = s.error ? 'Git error' : !s.hasTaskFiles ? 'No task files' : 'No task items';
      const ph = node(`p/${s.repo.path}/\u0001none`, label);
      ph.placeholder = true;
      repo.children.push(ph);
    } else {
      repo.children.sort((a, b) => rank(a) - rank(b)); // stable: file order within a format
    }
  }
  // Same-named repositories get their location appended.
  const byName = new Map<string, [string, TreeNode][]>();
  for (const [path, n] of repos) byName.set(n.label, [...(byName.get(n.label) ?? []), [path, n]]);
  for (const group of byName.values()) {
    if (group.length > 1) for (const [path, n] of group) n.label = `${n.label} (${lastSegments(path)})`;
  }
  root.children.sort((a, b) => lessLabel(a, b) || cmp(a.key, b.key));
}

function buildArea(ws: Workspace, root: TreeNode): void {
  for (const r of ws.items) {
    const parts = r.item.area.split('/').filter((p) => p !== '');
    let cur = root;
    if (parts.length === 0) {
      cur = findOrAdd(root.children, NO_AREA_KEY, '(no area)');
    } else {
      let key = 'a';
      for (const p of parts) {
        key += `/${p}`;
        cur = findOrAdd(cur.children, key, p);
      }
    }
    cur.children.push(makeLeaf(r));
  }
  sortArea(root, true);
}

function buildTime(ws: Workspace, root: TreeNode): void {
  for (const r of ws.items) {
    const d = r.item.created;
    let cur: TreeNode;
    if (!isValidDate(d)) {
      cur = findOrAdd(root.children, NO_DATE_KEY, '(no date)');
    } else {
      const ym = d.slice(0, 7);
      const m = findOrAdd(root.children, `t/${ym}`, ym);
      cur = findOrAdd(m.children, `t/${ym}/${d}`, d);
    }
    cur.children.push(makeLeaf(r));
  }
  sortTime(root);
}

export function matches(r: ResolvedItem, f: Filter): boolean {
  if (!f.statuses.has(r.status)) return false;
  if (f.hiddenRepos.has(r.repoKey)) return false;
  if (f.sizes.size > 0 && !f.sizes.has(r.item.size)) return false;
  if (f.search !== '') {
    const q = foldForSearch(f.search);
    if (![r.item.id, r.item.title, r.item.note].some((s) => foldForSearch(s).includes(q))) return false;
  }
  return true;
}

/** True when f can hide items beyond hidden repositories and dropped: search, sizes, or a missing non-dropped status. */
export function narrowing(f: Filter): boolean {
  return f.search !== '' || f.sizes.size > 0 || NON_DROPPED.some((s) => !f.statuses.has(s));
}

export function buildTree(ws: Workspace, mode: ViewMode, f: Filter): TreeNode {
  const root = node('root', '');
  if (mode === 'program') buildProgram(ws, f, root);
  else if (mode === 'area') buildArea(ws, root);
  else buildTime(ws, root);
  count(root);
  prune(root, f);
  return root;
}

/** Items matching f per status, ignoring f.statuses (dropped included). */
export function countByStatus(ws: Workspace, f: Filter): Map<Status, number> {
  const g: Filter = { ...f, statuses: new Set(ALL_STATUSES) };
  const out = new Map<Status, number>();
  for (const r of ws.items) if (matches(r, g)) out.set(r.status, (out.get(r.status) ?? 0) + 1);
  return out;
}
