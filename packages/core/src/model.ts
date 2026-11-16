export type Status =
  | 'open' | 'partial' | 'bug' | 'verify' | 'decision'
  | 'dropped' | 'done' | 'onBranch' | 'unverified';

export const ALL_STATUSES: readonly Status[] = [
  'open', 'partial', 'bug', 'verify', 'decision',
  'dropped', 'done', 'onBranch', 'unverified',
];

export type SourceFormat = 'docsTasks' | 'backlogMd' | 'specKit';

export interface Item {
  id: string;
  title: string;
  group: string;
  stored: Status;
  /** File marks it finished (backlogMd last status / specKit [x] / docsTasks history done). */
  fileDone: boolean;
  /** Raw text as written ("Done", "[x]", "open" ...). */
  fileStatusText: string;
  size: string;
  priority: string;
  area: string;
  created: string;
  note: string;
  spec: string;
  evidence: string;
  historyDate: string;
  historyCommit: string;
  depends: string[];
  line: number;
  /** Repo-relative file holding this item when it is not the program's path (Backlog.md: one file per task). */
  file?: string;
}

/** Repo-relative path of the file that holds the item. */
export function itemFile(program: { path: string }, item: { file?: string }): string {
  return item.file || program.path;
}

export interface Program {
  path: string;
  format: SourceFormat;
  title: string;
  id: string;
  area: string;
  created: string;
  spec: string;
  items: Item[];
}

export interface ParseIssue {
  path: string;
  line: number;
  kind: string;
  detail: string;
}

export interface ParseResult {
  program: Program;
  issues: ParseIssue[];
}

export interface RepoInfo {
  name: string;
  owner: string;
  path: string;
  origin: string;
  key: string;
}

export const RECENT_DAYS = 30;
