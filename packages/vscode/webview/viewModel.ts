// DOM-free view-model helpers of the webview (unit-tested with vitest): visible tree rows, status pill
// classes, the property table and the Attention groups. All text comes from the host's string map.
import type {
  AttentionItemDto, AttentionKind, DetailsDto, ItemDetailsDto, Status, StringKey, Strings, TreeNodeDto, WebviewToHost,
} from '../src/protocol';

/** "{0} of {1}" -> "a of b". */
export function fmt(template: string, ...args: Array<string | number>): string {
  return template.replace(/\{(\d+)\}/g, (m, i: string) => (Number(i) < args.length ? String(args[Number(i)]) : m));
}

// ---------------------------------------------------------------------------------------------- tree

export interface TreeRow {
  key: string;
  depth: number;
  node: TreeNodeDto;
  expandable: boolean;
  open: boolean;
  /** Index of the parent row; -1 at the top level. */
  parent: number;
}

/** Visible rows, depth first: children only under open branches. The root itself is not a row. */
export function rowsForTree(root: TreeNodeDto, openKeys: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (n: TreeNodeDto, depth: number, parent: number): void => {
    for (const c of n.children) {
      const expandable = c.kind === 'branch' && c.children.length > 0;
      const open = expandable && openKeys.has(c.key);
      const index = rows.length;
      rows.push({ key: c.key, depth, node: c, expandable, open, parent });
      if (open) walk(c, depth + 1, index);
    }
  };
  walk(root, 0, -1);
  return rows;
}

// ---------------------------------------------------------------------------------------------- status

const PILL: Record<Status, string> = {
  done: 'green', onBranch: 'blue', open: 'neutral', partial: 'cyan', bug: 'red', verify: 'orange',
  decision: 'purple', dropped: 'muted', unverified: 'amber',
};

export function statusClass(s: Status): string {
  return `pill pill-${PILL[s]}`;
}

export function statusLabel(s: Status, S: Strings): string {
  return S[`status.${s}` as StringKey];
}

// ---------------------------------------------------------------------------------------------- properties

export type PropValue =
  | { kind: 'text'; text: string; muted?: boolean; title?: string; error?: boolean; right?: boolean; wrap?: boolean }
  | { kind: 'link'; text: string; action: WebviewToHost; title?: string; muted?: boolean; pill?: Status }
  | { kind: 'pill'; status: Status; note?: string }
  | { kind: 'list'; items: PropValue[] }
  | { kind: 'progress'; fraction: number; text: string };

export interface PropRow {
  label: string;
  /** Shown as a status pill in the label cell (By status group). */
  pill?: Status;
  value: PropValue;
}

export interface PropGroup { title: string; rows: PropRow[]; }

const DASH = '—';
const text = (t: string, wrap = false): PropValue => (t === '' ? { kind: 'text', text: DASH } : wrap ? { kind: 'text', text: t, wrap } : { kind: 'text', text: t });
const short = (h: string) => h.slice(0, 7);

function itemGroups(d: ItemDetailsDto, S: Strings): PropGroup[] {
  const groups: PropGroup[] = [];
  const statusNote = d.branchOnly ? S['note.branchOnly'] : d.historical ? S['note.history']
    : d.trustedFromFile ? S['note.trusted'] : d.flaggedUnverified ? S['note.flagged'] : undefined;
  const pill: PropValue = statusNote ? { kind: 'pill', status: d.status, note: statusNote } : { kind: 'pill', status: d.status };
  groups.push({ title: S['group.item'], rows: [
    { label: S['row.id'], value: text(`${d.repo} · ${d.id}`) },
    { label: S['row.title'], value: text(d.title, true) },
    { label: S['row.status'], value: pill },
    { label: S['row.size'], value: text(d.size) },
    { label: S['row.priority'], value: text(d.priority) },
    { label: S['row.area'], value: text(d.area.split('/').filter((p) => p !== '').join(' › ')) },
    { label: S['row.created'], value: text(d.created) },
  ] });

  const deps: PropValue = d.depends.length === 0 ? text('') : { kind: 'list', items: d.depends.map((dep): PropValue => (dep.target
    ? { kind: 'link', text: dep.text, title: `${dep.target.repo} · ${dep.target.id}\n${dep.target.title}`, pill: dep.target.status,
      action: { type: 'jump', repo: dep.target.repoPath, id: dep.target.id } }
    : { kind: 'text', text: `${dep.text}  (${S['dep.notFound']})`, muted: true })) };
  groups.push({ title: S['group.description'], rows: [
    { label: S['row.note'], value: text(d.note, true) },
    { label: S['row.depends'], value: deps },
  ] });

  let spec: PropValue = text(d.spec);
  if (d.spec !== '') {
    if (d.specState === 'ok') spec = { kind: 'link', text: d.spec, title: d.spec, action: { type: 'openFile', repoKey: d.repoPath, path: d.spec } };
    else if (d.specState === 'outside') spec = { kind: 'text', text: d.spec, muted: true, title: S['spec.outside'] };
    else if (d.specState === 'missing') spec = { kind: 'text', text: d.spec, muted: true, title: S['spec.missing'] };
  }
  const commitLink = (c: ItemDetailsDto['commits'][number], prefix: string): PropValue => {
    const v: PropValue = { kind: 'link', text: `${prefix}${short(c.hash)} · ${c.date} · ${c.subject}`,
      title: `${c.closes ? S['commit.closes'] : S['commit.progress']}\n${S['commit.copy']}`, action: { type: 'copy', text: c.hash } };
    return c.closes ? v : { ...v, muted: true };
  };
  const commits: PropValue = d.commits.length === 0 ? { kind: 'text', text: S['commits.none'], muted: true }
    : { kind: 'list', items: d.commits.map((c) => commitLink(c, c.repo !== d.repo ? `${c.repo} ` : '')) };
  let completion: PropValue = text('');
  if (d.status === 'done') {
    if (d.historical) {
      const hc = d.historyCommit && d.historyCommit !== '-' ? ` · ${short(d.historyCommit)}` : '';
      completion = text(`${d.historyDate}${hc} (${S.history})`);
    } else {
      const closing = d.commits.find((c) => c.closes && c.date === d.doneDate);
      completion = closing
        ? { kind: 'link', text: `${d.doneDate} · ${short(closing.hash)}`, title: `${closing.subject}\n${S['commit.copy']}`,
          action: { type: 'copy', text: closing.hash } }
        : text(d.doneDate);
    }
  }
  const taskFile: PropValue = d.taskFile === '' ? text('') : { kind: 'link', text: d.taskFile,
    action: d.taskFileLine > 0 ? { type: 'openFile', repoKey: d.repoPath, path: d.taskFile, line: d.taskFileLine }
      : { type: 'openFile', repoKey: d.repoPath, path: d.taskFile } };
  const source: PropRow[] = [
    { label: S['row.spec'], value: spec },
    { label: S['row.taskFile'], value: taskFile },
  ];
  if (d.format === 'backlogMd' || d.format === 'specKit') source.push({ label: S['row.inFile'], value: text(d.fileStatusText) });
  source.push(
    { label: S['row.branches'], value: text(d.branches.join(', '), true) },
    { label: S['row.commits'], value: commits },
    { label: S['row.completion'], value: completion },
  );
  groups.push({ title: S['group.source'], rows: source });

  if (d.evidence !== '') {
    let result: PropValue = { kind: 'text', text: S['evidence.unchecked'], muted: true };
    if (d.evidenceResult) {
      const r = d.evidenceResult.found ? S['evidence.found'] : S['evidence.notFound'];
      result = d.evidenceResult.conflict ? { kind: 'text', text: `${r} (${S['evidence.conflict']})`, error: true } : { kind: 'text', text: r };
    }
    groups.push({ title: S['group.evidence'], rows: [
      { label: S['row.expression'], value: text(d.evidence, true) },
      { label: S['row.result'], value: result },
    ] });
  }
  return groups;
}

/** The property table: groups of label / value rows for an item or a branch. */
export function formatDetails(d: DetailsDto, S: Strings): PropGroup[] {
  if (d.kind === 'item') return itemGroups(d, S);
  const summary: PropRow[] = [{ label: S['row.name'], value: text(d.label, true) }];
  if (d.note !== '') summary.push({ label: S['row.note'], value: { kind: 'text', text: d.note, muted: true } });
  const fraction = d.total > 0 ? d.done / d.total : 0;
  summary.push(
    { label: S['row.items'], value: { kind: 'text', text: String(d.total), right: true } },
    { label: S['row.done'], value: { kind: 'text', text: String(d.done), right: true } },
    { label: S['row.progress'], value: { kind: 'progress', fraction, text: `${Math.round(fraction * 100)} %` } },
  );
  const groups: PropGroup[] = [{ title: S['group.summary'], rows: summary }];
  groups.push({ title: S['group.byStatus'], rows: d.byStatus.map((b) => ({ label: '', pill: b.status, value: { kind: 'text', text: String(b.count), right: true } })) });
  const o = d.oldest;
  groups.push({ title: S['group.oldest'], rows: o
    ? [
      { label: S['row.item'], value: { kind: 'link', text: `${o.repo} · ${o.id}  ${o.title}`, action: { type: 'jump', repo: o.repoPath, id: o.id } } },
      { label: S['row.created'], value: text(o.created) },
      { label: S['row.status'], value: { kind: 'pill', status: o.status } },
    ]
    : [{ label: S['row.item'], value: text('') }] });
  return groups;
}

// ---------------------------------------------------------------------------------------------- attention

export interface AttentionRow {
  repo: string;
  ref: string;
  /** Full reference (the whole hash) when ref is shortened. */
  refTitle?: string;
  detail: string;
  /** Row click; undefined when the row leads nowhere. */
  action?: WebviewToHost;
  button?: { text: string; action: WebviewToHost };
}

export interface AttentionGroup { kind: AttentionKind; title: string; rows: AttentionRow[]; }

const ITEM_KINDS: ReadonlySet<AttentionKind> = new Set<AttentionKind>(
  ['evidenceConflict', 'duplicateId', 'historyDoneAfterSince', 'fileDoneNoGit', 'gitDoneFileOpen']);
const HASH_KINDS: ReadonlySet<AttentionKind> = new Set<AttentionKind>(['untaggedCommit', 'unknownRef', 'ambiguousRepoRef']);

function detailText(a: AttentionItemDto, S: Strings): string {
  switch (a.kind) {
    case 'staleBranch': return fmt(S['detail.staleBranch'], a.days, a.code);
    case 'evidenceConflict':
      return S[a.expectPresent
        ? (a.found ? 'detail.evidence.presentFound' : 'detail.evidence.presentMissing')
        : (a.found ? 'detail.evidence.absentFound' : 'detail.evidence.absentMissing')];
    case 'unknownRef': return fmt(S['detail.unknownRef'], a.detail);
    case 'formatIssue': {
      const title = S[`issue.${a.code}` as StringKey] as string | undefined;
      if (!title) return a.detail;
      const prefix = `${a.code}: `;
      const rest = a.detail.startsWith(prefix) ? a.detail.slice(prefix.length) : a.detail === a.code ? '' : a.detail;
      return rest === '' ? title : `${title}: ${rest}`;
    }
    case 'duplicateId': return fmt(S['detail.duplicateId'], a.detail);
    case 'noTaskFiles': return S['detail.noTaskFiles'];
    case 'historyDoneAfterSince': return fmt(S['detail.historyDoneAfterSince'], a.detail);
    case 'fileDoneNoGit': return fmt(S['detail.fileDoneNoGit'], a.detail);
    case 'gitDoneFileOpen': return fmt(S['detail.gitDoneFileOpen'], a.detail);
    case 'unverifiedSummary': return fmt(S['detail.unverifiedSummary'], a.count);
    case 'uncommittedTaskChanges': return S['detail.uncommittedTaskChanges'];
    case 'ambiguousRepoRef': return fmt(S['detail.ambiguousRepoRef'], a.detail);
    default: return a.detail; // untaggedCommit (subject), fetchFailing / gitError (git message)
  }
}

function rowOf(a: AttentionItemDto, S: Strings): AttentionRow {
  const hash = HASH_KINDS.has(a.kind);
  let ref = hash ? short(a.ref) : a.ref;
  if (a.line > 0) ref += `:${a.line}`;
  const row: AttentionRow = { repo: a.repo, ref, detail: detailText(a, S) };
  if (hash && a.ref !== ref) row.refTitle = a.ref;
  if (ITEM_KINDS.has(a.kind)) row.action = { type: 'jump', repo: a.repoPath, id: a.ref };
  else if (a.kind === 'formatIssue' && a.ref !== '') {
    row.action = a.line > 0 ? { type: 'openFile', repoKey: a.repoPath, path: a.ref, line: a.line } : { type: 'openFile', repoKey: a.repoPath, path: a.ref };
  } else row.action = { type: 'jump', repo: a.repoPath, id: '' };
  if (a.kind === 'unverifiedSummary') {
    row.button = { text: S['att.trust'], action: { type: 'command', id: 'trustTaskFiles', repoKey: a.repoKey } };
  }
  return row;
}

/** Rows grouped by kind (input order is the core's kind order), each group with its count in rows.length. */
export function attentionGroups(items: readonly AttentionItemDto[], S: Strings): AttentionGroup[] {
  const groups: AttentionGroup[] = [];
  const byKind = new Map<AttentionKind, AttentionGroup>();
  for (const a of items) {
    let g = byKind.get(a.kind);
    if (!g) {
      g = { kind: a.kind, title: S[`kind.${a.kind}` as StringKey], rows: [] };
      byKind.set(a.kind, g);
      groups.push(g);
    }
    g.rows.push(rowOf(a, S));
  }
  return groups;
}

// ---------------------------------------------------------------------------------------------- filter

/** Membership toggle of an "empty = all" set; the last checked entry cannot be cleared. */
export function toggleInSet(set: readonly string[], all: readonly string[], v: string, on: boolean): string[] {
  const next = new Set(set.length === 0 ? all : set);
  if (on) next.add(v);
  else next.delete(v);
  if (next.size === 0) return [...set];
  if (all.every((a) => next.has(a))) return [];
  return all.filter((a) => next.has(a));
}

// ---------------------------------------------------------------------------------------------- open keys

/**
 * Open keys from a state message merged with local toggles the host has not confirmed yet (a state
 * posted before the host saw the toggle). Confirmed toggles leave pending.
 */
export function mergeOpenKeys(stateKeys: readonly string[], pending: ReadonlyMap<string, boolean>,
  inTree?: ReadonlySet<string>): { open: string[]; pending: Map<string, boolean> } {
  const open = new Set(stateKeys);
  const left = new Map<string, boolean>();
  for (const [key, isOpen] of pending) {
    if (open.has(key) === isOpen) continue;
    if (inTree && !inTree.has(key)) continue; // gone from the tree (or pruned by the host)
    left.set(key, isOpen);
    if (isOpen) open.add(key);
    else open.delete(key);
  }
  return { open: [...open], pending: left };
}

/** Every node key of the tree below the root. */
export function treeKeys(root: TreeNodeDto): Set<string> {
  const keys = new Set<string>();
  const walk = (n: TreeNodeDto): void => {
    for (const c of n.children) {
      keys.add(c.key);
      walk(c);
    }
  };
  walk(root);
  return keys;
}

/** Text shown in place of an empty tree: scanning while busy with no items, else empty / no match. */
export function emptyTreeText(tree: TreeNodeDto, busy: boolean, items: number, S: Strings): string {
  if (tree.children.length > 0) return '';
  if (items === 0) return busy ? S['tree.scanning'] : S['tree.empty'];
  return S['tree.noMatch'];
}
