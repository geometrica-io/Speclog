// Messages and DTOs between the extension host and the webview. Imported by both sides, so it has no
// imports: the webview bundle never pulls in the core or `vscode`. DTOs are plain JSON.

export type ViewMode = 'program' | 'area' | 'time';
/** Same values as the core's SortOrder (this file has no imports); dto.ts checks the two agree. */
export type SortOrder = 'created-asc' | 'created-desc' | 'activity-asc' | 'activity-desc';
/** The Sort combobox options, in order; a test checks it equals the core's SORT_ORDERS. */
export const SORTS: readonly SortOrder[] = ['created-asc', 'created-desc', 'activity-asc', 'activity-desc'];

export type Status =
  | 'open' | 'partial' | 'bug' | 'verify' | 'decision'
  | 'dropped' | 'done' | 'onBranch' | 'unverified';

/** Filter panel / summary order (PM's order, Unverified next to Done). */
export const STATUS_ORDER: readonly Status[] = [
  'done', 'unverified', 'onBranch', 'open', 'partial', 'bug', 'verify', 'decision', 'dropped',
];

export type SourceFormat = 'docsTasks' | 'backlogMd' | 'specKit';

export type AttentionKind = 'staleBranch' | 'untaggedCommit' | 'evidenceConflict' | 'unknownRef' | 'formatIssue' |
  'duplicateId' | 'noTaskFiles' | 'historyDoneAfterSince' | 'fetchFailing' | 'gitError' |
  'gitDoneFileOpen' | 'unverifiedSummary' | 'uncommittedTaskChanges' | 'ambiguousRepoRef';

export type FilterPreset = 'all' | 'open' | 'done' | 'onBranch' | 'bugs';
export const FILTER_PRESETS: readonly FilterPreset[] = ['all', 'open', 'done', 'onBranch', 'bugs'];

/** Longest key the host accepts from the webview. */
export const MAX_KEY_LENGTH = 4096;

/** One tree row's data; keys are opaque (never parsed on either side). */
export interface TreeNodeDto {
  key: string;
  label: string;
  kind: 'root' | 'branch' | 'item' | 'placeholder';
  /** Branches: whole branch, filter-independent. */
  done: number;
  total: number;
  /** Items only. */
  id?: string;
  status?: Status;
  /** Items only: repository name (shown in the Area / Time views). */
  repo?: string;
  /** Placeholder only: the key selected when the row is selected (its repository). */
  selectKey?: string;
  children: TreeNodeDto[];
}

export interface FilterDto {
  statuses: Status[];
  /** Repository keys (origin URL or path). */
  hiddenRepos: string[];
  /** Empty = all; "" = items without a size. */
  sizes: string[];
  search: string;
}

export interface AttentionItemDto {
  kind: AttentionKind;
  repo: string;
  /** Repository path (unique per clone); the repository name when it cannot be told. */
  repoPath: string;
  /** Repository settings key (origin URL or path), for the trust command; "" when unknown. */
  repoKey: string;
  ref: string;
  detail: string;
  line: number;
  days: number;
  expectPresent: boolean;
  found: boolean;
  code: string;
  count: number;
}

export interface FetchStateDto {
  repo: string;
  lastOkUnix: number;
  firstFailUnix: number;
  lastError: string;
}

export interface UiStateDto {
  openKeys: string[];
  selectedKey: string;
  attentionOpen: boolean;
  /** CSS pixels. */
  attentionHeight: number;
  /** Tree width as a fraction of the panel width. */
  treeFraction: number;
  /** Scroll the selected row into view after this state (a jump). */
  reveal: boolean;
}

export interface RepoDto { key: string; name: string; }

export interface SummaryDto {
  repos: number;
  items: number;
  done: number;
  unverified: number;
  /** Items the filter shows. */
  shown: number;
}

export interface CommitDto { repo: string; hash: string; date: string; subject: string; closes: boolean; }

export interface DependencyDto {
  text: string;
  /** Set when the dependency resolves. */
  target?: { repoPath: string; id: string; title: string; repo: string; status: Status };
}

export interface ItemDetailsDto {
  kind: 'item';
  key: string;
  repo: string;
  repoPath: string;
  repoKey: string;
  id: string;
  title: string;
  status: Status;
  branchOnly: boolean;
  historical: boolean;
  trustedFromFile: boolean;
  flaggedUnverified: boolean;
  size: string;
  priority: string;
  area: string;
  created: string;
  /** Newest of created, the item's commit dates and its done date ("" when none). */
  lastActivity: string;
  note: string;
  depends: DependencyDto[];
  spec: string;
  /** ok: inside the repository and present; missing; outside: escapes the repository (not opened). */
  specState: 'none' | 'ok' | 'missing' | 'outside';
  format: SourceFormat;
  taskFile: string;
  taskFileLine: number;
  fileStatusText: string;
  branches: string[];
  commits: CommitDto[];
  doneDate: string;
  historyDate: string;
  historyCommit: string;
  evidence: string;
  /** Evidence result on the main tip; undefined: not checked (bad expression). */
  evidenceResult?: { found: boolean; conflict: boolean };
  /** Send to agent: enabled, or disabled with the reason (the tooltip). */
  agent: { enabled: boolean; reason: string };
}

export interface OldestOpenDto { repoPath: string; repo: string; id: string; title: string; created: string; status: Status; }

export interface BranchSummaryDto {
  kind: 'branch';
  key: string;
  label: string;
  /** Repository without items: "No task files" etc. */
  note: string;
  done: number;
  total: number;
  byStatus: { status: Status; count: number }[];
  oldest?: OldestOpenDto;
}

export type DetailsDto = ItemDetailsDto | BranchSummaryDto;

export type HostToWebview =
  | { type: 'init'; strings: Strings }
  | {
    type: 'state'; view: ViewMode; sort: SortOrder; tree: TreeNodeDto; counts: Record<Status, number>; summary: SummaryDto;
    attention: AttentionItemDto[]; busy: boolean; fetch: FetchStateDto[]; filter: FilterDto; ui: UiStateDto; repos: RepoDto[];
  }
  /** Only busy / fetch / Attention changed (same workspace): the tree is not resent. */
  | { type: 'status'; busy: boolean; fetch: FetchStateDto[]; attention: AttentionItemDto[] }
  | { type: 'details'; key: string; details: DetailsDto | null };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'setView'; view: ViewMode }
  | { type: 'setSort'; sort: SortOrder }
  | { type: 'setFilter'; filter: FilterDto }
  /** Statuses and sizes from the preset; hidden repositories and the search are kept. */
  | { type: 'preset'; preset: FilterPreset }
  | { type: 'select'; key: string }
  | { type: 'toggle'; key: string; open: boolean }
  | { type: 'openFile'; repoKey: string; path: string; line?: number }
  | { type: 'copy'; text: string }
  | { type: 'jump'; repo: string; id: string }
  | { type: 'layout'; attentionOpen: boolean; attentionHeight: number; treeFraction: number }
  /** Send the item with this tree key to an agent; the host re-resolves it. */
  | { type: 'sendToAgent'; key: string }
  | { type: 'command'; id: 'refresh' | 'trustTaskFiles' | 'installHook' | 'openReport'; repoKey?: string };

/** Every user-visible webview text; the host fills it through vscode.l10n.t. "{0}" are placeholders. */
export const STRING_KEYS = [
  'view', 'view.program', 'view.area', 'view.time', 'sort', 'sort.created-asc', 'sort.created-desc', 'sort.activity-asc',
  'sort.activity-desc', 'search', 'filter', 'filter.presets', 'filter.status',
  'filter.repositories', 'filter.size', 'filter.noSize', 'preset.all', 'preset.open', 'preset.done', 'preset.onBranch',
  'preset.bugs', 'summary', 'summary.unverified', 'shown', 'attention', 'scanning', 'fetched', 'notFetched',
  'fetchFailing', 'noRepositories',
  'status.open', 'status.partial', 'status.bug', 'status.verify', 'status.decision', 'status.dropped', 'status.done',
  'status.onBranch', 'status.unverified',
  'tree.empty', 'tree.noMatch', 'tree.scanning', 'tree.label',
  'props.title', 'props.empty', 'group.item', 'group.description', 'group.source', 'group.evidence', 'group.summary',
  'group.byStatus', 'group.oldest',
  'row.id', 'row.title', 'row.status', 'row.size', 'row.priority', 'row.area', 'row.created', 'row.lastActivity', 'row.note',
  'row.depends', 'row.spec', 'row.taskFile', 'row.inFile', 'row.branches', 'row.commits', 'row.completion',
  'row.expression', 'row.result', 'row.name', 'row.items', 'row.done', 'row.progress', 'row.item',
  'agent.send', 'openReport',
  'note.branchOnly', 'note.history', 'note.trusted', 'note.flagged', 'commits.none', 'commit.closes', 'commit.progress',
  'commit.copy', 'dep.notFound', 'spec.missing', 'spec.outside', 'evidence.found', 'evidence.notFound',
  'evidence.unchecked', 'evidence.conflict', 'history',
  'att.empty', 'att.repository', 'att.reference', 'att.detail', 'att.trust',
  'kind.staleBranch', 'kind.untaggedCommit', 'kind.evidenceConflict', 'kind.unknownRef', 'kind.formatIssue',
  'kind.duplicateId', 'kind.noTaskFiles', 'kind.historyDoneAfterSince', 'kind.fetchFailing', 'kind.gitError',
  'kind.gitDoneFileOpen', 'kind.unverifiedSummary', 'kind.uncommittedTaskChanges',
  'kind.ambiguousRepoRef',
  'detail.staleBranch', 'detail.evidence.presentFound', 'detail.evidence.presentMissing',
  'detail.evidence.absentFound', 'detail.evidence.absentMissing', 'detail.unknownRef', 'detail.duplicateId',
  'detail.noTaskFiles', 'detail.historyDoneAfterSince', 'detail.gitDoneFileOpen',
  'detail.unverifiedSummary', 'detail.uncommittedTaskChanges', 'detail.ambiguousRepoRef',
  'issue.syntax', 'issue.duplicate-id', 'issue.unknown-field', 'issue.bad-status', 'issue.missing-status',
  'issue.bad-date', 'issue.bad-size', 'issue.bad-evidence', 'issue.bad-since', 'issue.bad-trust',
  'issue.done-without-since', 'issue.unsupported',
] as const;

export type StringKey = typeof STRING_KEYS[number];
export type Strings = Record<StringKey, string>;
