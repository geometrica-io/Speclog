// Renders the report model as Markdown for the Markdown export. Pure: no vscode, no I/O.
// Same sections and columns as renderHtml; the curve becomes one "start % → end %" line.
import type { ProgramReport, ReportItem, ReportModel, RepoReport } from '@speclog/core';
import { delta, fill, pct, reasonText } from './renderHtml';
import type { ReportMeta } from './renderHtml';
import type { ReportStrings } from './reportStrings';

/** Table cell: newlines become spaces, backslash, pipe and backtick are escaped. */
function cell(v: string): string {
  return v.replace(/\r\n|\r|\n/g, ' ').replace(/[\\|`]/g, (c) => '\\' + c);
}

function table(head: string[], rows: string[][]): string {
  const line = (c: string[]): string => `| ${c.join(' | ')} |`;
  return [line(head.map(cell)), line(head.map(() => '---')), ...rows.map((r) => line(r.map(cell)))].join('\n');
}

function summaryTable(m: ReportModel, s: ReportStrings): string {
  const sum = (r: RepoReport[], pick: (x: RepoReport) => unknown[]): string => String(r.reduce((a, x) => a + pick(x).length, 0));
  const row = (label: string, start: RepoReport['start'], end: RepoReport['end'], r: RepoReport[]): string[] => [
    label, pct(start), pct(end), delta(start, end).text,
    sum(r, (x) => x.finished), sum(r, (x) => x.inProgress), sum(r, (x) => x.added), sum(r, (x) => x.remaining),
    sum(r, (x) => x.changed),
  ];
  const head = [s.repository, s.start, s.end, s.delta, s.finished, s.inProgress, s.added, s.remaining, s.changedColumn];
  const rows = m.repos.map((r) => row(r.name, r.start, r.end, [r]));
  if (m.repos.length > 1) rows.push(row(s.total, m.total.start, m.total.end, m.repos));
  return table(head, rows);
}

function programTable(programs: ProgramReport[], s: ReportStrings): string {
  if (programs.length === 0) return '';
  const rows = programs.map((p) => [p.title, pct(p.start), pct(p.end), delta(p.start, p.end).text]);
  return `${table([s.colProgram, s.start, s.end, s.delta], rows)}\n`;
}

function listSection(title: string, items: ReportItem[], s: ReportStrings, col: string, value: (it: ReportItem) => string): string {
  if (items.length === 0) return '';
  const rows = items.map((it) => [it.isNew ? `${it.id} (${s.isNew})` : it.id, it.title, it.programTitle, value(it)]);
  return `### ${cell(title)} (${items.length})\n\n${table([s.colId, s.colTitle, s.colProgram, col], rows)}\n`;
}

function repoSection(r: RepoReport, s: ReportStrings): string {
  const reopened = r.changed.filter((c) => c.change === 'reopened');
  const gone = r.changed.filter((c) => c.change !== 'reopened');
  const statusOf = (it: ReportItem): string => s.status[it.status] ?? it.status;
  const changeOf = (it: ReportItem): string => (it.change === 'removed' ? s.changeRemoved : s.changeDropped);
  const closedOf = (it: ReportItem): string => {
    const c = it.closedCommit;
    return c ? `${it.closedDate} ${c.hash.slice(0, 7)} ${c.subject}` : it.closedDate;
  };
  return [
    `## ${cell(r.name)}\n\n${pct(r.start)} → ${pct(r.end)}\n`,
    programTable(r.programs, s),
    listSection(s.finished, r.finished, s, s.colClosed, closedOf),
    listSection(s.inProgress, r.inProgress, s, s.colReason, (it) => reasonText(it, s)),
    listSection(s.added, r.added, s, s.colStatus, statusOf),
    listSection(s.remaining, r.remaining, s, s.colStatus, statusOf),
    listSection(s.reopened, reopened, s, s.colStatus, statusOf),
    listSection(s.droppedOrRemoved, gone, s, s.colChange, changeOf),
  ].filter((x) => x !== '').join('\n');
}

export function renderReportMarkdown(m: ReportModel, s: ReportStrings, meta: ReportMeta): string {
  const names = m.repos.map((r) => r.name).join(', ');
  const parts = [
    `# ${cell(s.title)}\n\n${s.period}: ${m.period.from} – ${m.period.to}  \n${fill(s.repositories, names)}  \n`
      + `${fill(s.generated, meta.generated)} · ${fill(s.speclog, meta.version)}\n`,
    `## ${cell(s.summary)}\n\n${summaryTable(m, s)}\n`,
    ...(m.endIsLive ? [] : [`*${s.pastEndNote}*\n`]),
    `${pct(m.total.start)} → ${pct(m.total.end)}\n`,
    ...m.repos.map((r) => repoSection(r, s)),
    `---\n\n${s.footer}`,
  ];
  return `${parts.join('\n')}\n`;
}
