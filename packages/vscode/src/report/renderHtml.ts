// Renders the report model as HTML for the report tab and the HTML/PDF export. Pure: no vscode, no I/O.
// Every string from the model goes through escapeHtml; the document carries no script.
import { percent } from '@speclog/core';
import type { Progress, ProgramReport, ReportItem, ReportModel, RepoReport } from '@speclog/core';
import { REPORT_CSS } from './reportCss';
import type { ReportStrings } from './reportStrings';

export { REPORT_CSS };
export interface ReportMeta { generated: string; version: string; }

const LONG_LIST = 20;

export function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const e = escapeHtml;
const fill = (t: string, ...a: string[]): string => t.replace(/\{(\d+)\}/g, (_, i: string) => a[Number(i)] ?? '');

function pct(p: Progress): string {
  const v = percent(p);
  return v === null ? '—' : `${v}% (${p.done}/${p.total})`;
}

function delta(a: Progress, b: Progress): { text: string; cls: string } {
  const x = percent(a), y = percent(b);
  if (x === null || y === null) return { text: '—', cls: '' };
  const d = y - x;
  return { text: d > 0 ? `+${d}` : String(d), cls: d > 0 ? 'up' : d < 0 ? 'down' : '' };
}

const num = (n: number): string => String(Number(n.toFixed(2)));

/** Polyline of the percent over the points (total 0 skipped), y axis 0-100 %. */
export function curveSvg(points: Progress[], width: number, height: number): string {
  const n = points.length;
  const pts: string[] = [];
  points.forEach((p, i) => {
    const v = percent(p);
    if (v === null) return;
    const x = n > 1 ? (i * width) / (n - 1) : width / 2;
    pts.push(`${num(x)},${num(height - (v / 100) * height)}`);
  });
  const grid = [0, 50, 100].map((g) => {
    const y = num(height - (g / 100) * height);
    return `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#e4e7eb" stroke-width="1"/>`;
  }).join('');
  let line = '';
  if (pts.length > 1) line = `<polyline points="${pts.join(' ')}" fill="none" stroke="#1f5fa8" stroke-width="2" stroke-linejoin="round"/>`;
  else if (pts.length === 1) {
    const [cx, cy] = pts[0].split(',');
    line = `<circle cx="${cx}" cy="${cy}" r="3" fill="#1f5fa8"/>`;
  }
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" xmlns="http://www.w3.org/2000/svg">${grid}${line}</svg>`;
}

/** Header cells are escaped here; body cells arrive as ready (escaped) HTML. */
function table(head: string[], rows: string[][], numeric: number[] = []): string {
  const cls = (i: number): string => (numeric.includes(i) ? ' class="num"' : '');
  const th = head.map((h, i) => `<th${cls(i)}>${e(h)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c, i) => `<td${cls(i)}>${c}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}

function summaryTable(m: ReportModel, s: ReportStrings): string {
  const sum = (r: RepoReport[], pick: (x: RepoReport) => unknown[]): string => String(r.reduce((a, x) => a + pick(x).length, 0));
  const row = (label: string, start: Progress, end: Progress, r: RepoReport[], cls = ''): string => {
    const d = delta(start, end);
    const cells = [
      e(label), e(pct(start)), e(pct(end)), `<span class="${d.cls}">${e(d.text)}</span>`,
      sum(r, (x) => x.finished), sum(r, (x) => x.inProgress), sum(r, (x) => x.added), sum(r, (x) => x.remaining),
      sum(r, (x) => x.changed),
    ];
    return `<tr${cls ? ` class="${cls}"` : ''}>${cells.map((c, i) => `<td${i > 0 ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`;
  };
  const head = [s.repository, s.start, s.end, s.delta, s.finished, s.inProgress, s.added, s.remaining,
    `${s.reopened} / ${s.droppedOrRemoved}`];
  const th = head.map((h, i) => `<th${i > 0 ? ' class="num"' : ''}>${e(h)}</th>`).join('');
  const rows = m.repos.map((r) => row(r.name, r.start, r.end, [r])).join('');
  const total = m.repos.length > 1 ? row(s.total, m.total.start, m.total.end, m.repos, 'total') : '';
  return `<table><thead><tr>${th}</tr></thead><tbody>${rows}${total}</tbody></table>`;
}

function reasonText(it: ReportItem, s: ReportStrings): string {
  const r = it.progressReason;
  if (!r) return '';
  switch (r.kind) {
    case 'onBranch': return fill(s.onBranch, r.branches.join(', '));
    case 'branchOnly': return fill(s.newOnBranch, r.branches.join(', '));
    case 'partial': return s.partial;
    case 'commit': return fill(s.progressCommit, r.date);
  }
}

const idCell = (it: ReportItem, s: ReportStrings): string =>
  `<span class="id">${e(it.id)}</span>${it.isNew ? `<span class="tag">${e(s.isNew)}</span>` : ''}`;

function closedCell(it: ReportItem): string {
  const c = it.closedCommit;
  const sub = c ? `<div class="sub">${e(c.hash.slice(0, 7))} ${e(c.subject)}</div>` : '';
  return `${e(it.closedDate)}${sub}`;
}

function listSection(title: string, items: ReportItem[], s: ReportStrings, col: string, cell: (it: ReportItem) => string): string {
  if (items.length === 0) return '';
  const rows = items.map((it) => [idCell(it, s), e(it.title), e(it.programTitle), cell(it)]);
  const t = table([s.colId, s.colTitle, s.colProgram, col], rows);
  const heading = `<h3>${e(title)} (${items.length})</h3>`;
  if (items.length <= LONG_LIST) return `${heading}${t}`;
  return `${heading}<details><summary>${e(fill(s.showItems, String(items.length)))}</summary>${t}</details>`;
}

function programRows(programs: ProgramReport[], s: ReportStrings): string {
  if (programs.length === 0) return '';
  const rows = programs.map((p) => {
    const d = delta(p.start, p.end);
    return [e(p.title), e(pct(p.start)), e(pct(p.end)), `<span class="${d.cls}">${e(d.text)}</span>`];
  });
  const t = table([s.colProgram, s.start, s.end, s.delta], rows, [1, 2, 3]);
  return `<details open><summary>${e(s.colProgram)} (${programs.length})</summary>${t}</details>`;
}

function repoSection(r: RepoReport, s: ReportStrings): string {
  const reopened = r.changed.filter((c) => c.change === 'reopened');
  const gone = r.changed.filter((c) => c.change !== 'reopened');
  const statusOf = (it: ReportItem): string => e(s.status[it.status] ?? it.status);
  const changeOf = (it: ReportItem): string => e(it.change === 'removed' ? s.changeRemoved : s.changeDropped);
  return `<section class="repo"><h2>${e(r.name)}</h2>
<p class="meta">${e(pct(r.start))} → ${e(pct(r.end))}</p>
${programRows(r.programs, s)}
<div class="curve">${curveSvg(r.curve, 640, 160)}</div>
${listSection(s.finished, r.finished, s, s.colClosed, closedCell)}
${listSection(s.inProgress, r.inProgress, s, s.colReason, (it) => e(reasonText(it, s)))}
${listSection(s.added, r.added, s, s.colStatus, statusOf)}
${listSection(s.remaining, r.remaining, s, s.colStatus, statusOf)}
${listSection(s.reopened, reopened, s, s.colStatus, statusOf)}
${listSection(s.droppedOrRemoved, gone, s, s.colChange, changeOf)}
</section>`;
}

export function renderReportBody(m: ReportModel, s: ReportStrings, meta: ReportMeta): string {
  const names = m.repos.map((r) => r.name).join(', ');
  return `<div class="report">
<header><h1>${e(s.title)}</h1>
<p class="meta">${e(s.period)}: ${e(m.period.from)} – ${e(m.period.to)}</p>
<p class="meta">${e(fill(s.repositories, names))}</p>
<p class="meta">${e(fill(s.generated, meta.generated))} · ${e(fill(s.speclog, meta.version))}</p></header>
<h2>${e(s.summary)}</h2>
${summaryTable(m, s)}
${m.endIsLive ? '' : `<p class="note">${e(s.pastEndNote)}</p>`}
<div class="curve">${curveSvg(m.total.curve, 640, 160)}</div>
${m.repos.map((r) => repoSection(r, s)).join('\n')}
<p class="footer">${e(s.footer)}</p>
</div>`;
}

export function renderReportDocument(m: ReportModel, s: ReportStrings, meta: ReportMeta): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(s.title)}</title>
<style>${REPORT_CSS}</style></head>
<body>
${renderReportBody(m, s, meta)}
</body></html>
`;
}
