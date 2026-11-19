// Report tab webview: a control bar (period, dates, repositories, refresh, exports), a progress line, the
// "Data changed" banner and the report itself. The report HTML comes from the host's renderer, which escapes
// every model string; no user-visible text is hard-coded here (it comes in "init").
import type { ReportHostToWebview, ReportWebviewToHost } from '../../src/reportProtocol';
import { clear, h, post } from '../dom';
import { fmt } from '../viewModel';

type Controls = Extract<ReportHostToWebview, { type: 'controls' }>;

// dom.ts's post is typed for the board's messages; the channel is the same.
const send = post as unknown as (m: ReportWebviewToHost) => void;

let S: Record<string, string> = {};
let repos: Controls['repos'] = [];

const periodLabel = h('label', { class: 'label', attrs: { for: 'period' } });
const period = h('select', { class: 'select', attrs: { id: 'period' } });
const fromLabel = h('label', { class: 'label', attrs: { for: 'from' } });
const from = h('input', { class: 'input', attrs: { id: 'from', type: 'date' } });
const toLabel = h('label', { class: 'label', attrs: { for: 'to' } });
const to = h('input', { class: 'input', attrs: { id: 'to', type: 'date' } });
const reposButton = h('button', { class: 'button', attrs: { 'type': 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false' } });
const reposPopup = h('div', { class: 'repos-popup', attrs: { role: 'group' } });
reposPopup.hidden = true;
const refresh = h('button', { class: 'button', attrs: { type: 'button' } });
const exportHtml = h('button', { class: 'button', attrs: { type: 'button' } });
const exportMd = h('button', { class: 'button', attrs: { type: 'button' } });
const exportPdf = h('button', { class: 'button', attrs: { type: 'button' } });
const progress = h('div', { class: 'progress muted', attrs: { role: 'status' } });
const staleText = h('span');
const staleRefresh = h('button', { class: 'button small', attrs: { type: 'button' } });
const stale = h('div', { class: 'stale', attrs: { role: 'status' } }, staleText, staleRefresh);
const error = h('div', { class: 'error-line', attrs: { role: 'alert' } });
const content = h('div', { class: 'content' });
stale.hidden = true;
error.hidden = true;
progress.hidden = true;

const bar = h('div', { class: 'controls' },
  h('div', { class: 'group' }, periodLabel, period, fromLabel, from, toLabel, to,
    h('div', { class: 'repos-wrap' }, reposButton, reposPopup), refresh),
  h('div', { class: 'group' }, exportHtml, exportMd, exportPdf));
document.getElementById('app')!.append(bar, progress, stale, error, content);

function sendPeriod(): void {
  if (period.value === 'custom') {
    if (from.value === '' || to.value === '') return;
    send({ type: 'period', preset: 'custom', from: from.value, to: to.value });
  } else send({ type: 'period', preset: period.value, from: '', to: '' });
  stale.hidden = true;
}

function setCustom(on: boolean): void {
  from.disabled = !on;
  to.disabled = !on;
}

period.addEventListener('change', () => {
  setCustom(period.value === 'custom');
  sendPeriod();
});
from.addEventListener('change', sendPeriod);
to.addEventListener('change', sendPeriod);

function closeRepos(focus: boolean): void {
  reposPopup.hidden = true;
  reposButton.setAttribute('aria-expanded', 'false');
  if (focus) reposButton.focus();
}

reposButton.addEventListener('click', () => {
  reposPopup.hidden = !reposPopup.hidden;
  reposButton.setAttribute('aria-expanded', String(!reposPopup.hidden));
});
document.addEventListener('mousedown', (e) => {
  const t = e.target as Node;
  if (!reposPopup.hidden && !reposPopup.contains(t) && !reposButton.contains(t)) closeRepos(false);
});
reposPopup.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeRepos(true);
});

/** Rebuilds the checkbox list; the focused checkbox (by key) keeps the focus. */
function renderRepos(): void {
  const a = document.activeElement;
  const focusedKey = a instanceof HTMLInputElement && reposPopup.contains(a) ? a.dataset.key : undefined;
  const checked = repos.filter((r) => r.checked).length;
  reposButton.textContent = `${S.repositories ?? ''} (${checked}/${repos.length})`;
  clear(reposPopup);
  if (repos.length === 0) reposPopup.append(h('div', { class: 'muted', text: S.noRepositories ?? '' }));
  for (const r of repos) {
    const box = h('input', { attrs: { type: 'checkbox' } });
    box.dataset.key = r.key;
    box.checked = r.checked;
    box.addEventListener('change', () => {
      r.checked = box.checked;
      renderRepos();
      send({ type: 'repos', keys: repos.filter((x) => x.checked).map((x) => x.key) });
      stale.hidden = true;
    });
    reposPopup.append(h('label', { class: 'repo-row', title: r.key }, box, r.name));
    if (r.key === focusedKey) box.focus();
  }
}

refresh.addEventListener('click', () => {
  stale.hidden = true;
  send({ type: 'refresh' });
});
staleRefresh.addEventListener('click', () => {
  stale.hidden = true;
  send({ type: 'refresh' });
});
exportHtml.addEventListener('click', () => send({ type: 'export', format: 'html' }));
exportMd.addEventListener('click', () => send({ type: 'export', format: 'md' }));
exportPdf.addEventListener('click', () => send({ type: 'export', format: 'pdf' }));

function setStrings(presets: string[]): void {
  periodLabel.textContent = S.period;
  clear(period);
  for (const p of presets) period.append(h('option', { text: S[`preset.${p}`] ?? p, attrs: { value: p } }));
  fromLabel.textContent = S.from;
  toLabel.textContent = S.to;
  refresh.textContent = S.refresh;
  exportHtml.textContent = S.exportHtml;
  exportMd.textContent = S.exportMd;
  exportPdf.textContent = S.exportPdf;
  staleText.textContent = S.stale;
  staleRefresh.textContent = S.staleRefresh;
  reposPopup.setAttribute('aria-label', S.repositories);
  renderRepos();
}

window.addEventListener('message', (e: MessageEvent<ReportHostToWebview>) => {
  const m = e.data;
  switch (m.type) {
    case 'init':
      S = m.strings;
      setStrings(m.presets);
      break;
    case 'controls':
      period.value = m.preset;
      setCustom(m.preset === 'custom');
      // Dates the user is editing stay as typed.
      if (document.activeElement !== from) from.value = m.from;
      if (document.activeElement !== to) to.value = m.to;
      repos = m.repos.map((r) => ({ ...r }));
      renderRepos();
      break;
    case 'busy':
      progress.hidden = false;
      progress.textContent = m.total > 0 ? fmt(S.progress ?? '', m.done, m.total) : S.computing ?? '';
      content.classList.add('busy');
      error.hidden = true;
      break;
    case 'report':
      progress.hidden = true;
      error.hidden = true;
      stale.hidden = true;
      content.classList.remove('busy');
      // Built by the host's renderer: every model string in it is escaped; the CSP allows no inline script.
      content.innerHTML = m.html;
      break;
    case 'error':
      progress.hidden = true;
      content.classList.remove('busy');
      error.hidden = false;
      error.textContent = m.text;
      break;
    case 'stale':
      stale.hidden = false;
      break;
  }
});

send({ type: 'ready' });
