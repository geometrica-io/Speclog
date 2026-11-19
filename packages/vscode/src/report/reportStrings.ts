// Labels shared by both report renderers. Plain type: filled by reportStrings() in ../strings.ts (vscode-free here).
// "{0}" placeholders are filled by the renderer.
export interface ReportStrings {
  title: string;
  summary: string;
  finished: string;
  inProgress: string;
  added: string;
  remaining: string;
  reopened: string;
  droppedOrRemoved: string;
  /** Summary column: one count of reopened, dropped and removed items. */
  changedColumn: string;
  total: string;
  repository: string;
  period: string;
  start: string;
  end: string;
  delta: string;
  colId: string;
  colTitle: string;
  colProgram: string;
  colClosed: string;
  colReason: string;
  colStatus: string;
  colChange: string;
  colProgress: string;
  changeDropped: string;
  changeRemoved: string;
  isNew: string;
  /** "On branch {0}". */
  onBranch: string;
  /** "New on branch {0}". */
  newOnBranch: string;
  partial: string;
  /** "Last progress {0}" (the date of the last progress). */
  progressCommit: string;
  footer: string;
  pastEndNote: string;
  /** "Generated {0}". */
  generated: string;
  /** "Repositories: {0}". */
  repositories: string;
  /** "Speclog {0}". */
  speclog: string;
  /** "{0} items". */
  showItems: string;
  /** Status id (Status or 'onBranch') to label. */
  status: Record<string, string>;
}
