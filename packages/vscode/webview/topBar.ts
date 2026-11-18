// Top bar: View and Sort comboboxes, search, Filter button (+ dropdown), summary, busy / fetch state, Attention button.
import type { FetchStateDto, FilterDto, FilterPreset, SortOrder, Status, Strings, ViewMode } from '../src/protocol';
import type { RepoDto, SummaryDto } from '../src/protocol';
import { h } from './dom';
import { FilterPopup, filterActive } from './filter';
import { fmt } from './viewModel';

const SEARCH_DELAY_MS = 200;
const SORTS: readonly SortOrder[] = ['created-asc', 'created-desc', 'activity-asc', 'activity-desc'];

export interface TopBarCallbacks {
  setView(v: ViewMode): void;
  setSort(s: SortOrder): void;
  setFilter(f: FilterDto): void;
  preset(p: FilterPreset): void;
  toggleAttention(): void;
}

/** Local "HH:MM", with the date in front when it is not today. */
function clock(unix: number): string {
  const d = new Date(unix * 1000), now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return d.toDateString() === now.toDateString() ? hm : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`;
}

export class TopBar {
  readonly element: HTMLDivElement;
  private readonly viewLabel: HTMLLabelElement;
  private readonly view: HTMLSelectElement;
  private readonly sortLabel: HTMLLabelElement;
  private readonly sort: HTMLSelectElement;
  private readonly search: HTMLInputElement;
  private readonly filterButton: HTMLButtonElement;
  private readonly shown: HTMLSpanElement;
  private readonly summary: HTMLSpanElement;
  private readonly spinner: HTMLSpanElement;
  private readonly fetch: HTMLSpanElement;
  private readonly attention: HTMLButtonElement;
  readonly popup: FilterPopup;
  private S: Strings | null = null;
  private filter: FilterDto = { statuses: [], hiddenRepos: [], sizes: [], search: '' };
  private searchTimer = 0;
  private searchPending = false;

  constructor(cb: TopBarCallbacks) {
    this.view = h('select', { class: 'select', attrs: { id: 'view-select' } });
    for (const v of ['program', 'area', 'time']) this.view.append(h('option', { attrs: { value: v } }));
    this.view.addEventListener('change', () => cb.setView(this.view.value as ViewMode));
    this.viewLabel = h('label', { class: 'view-label', attrs: { for: 'view-select' } });
    this.sort = h('select', { class: 'select', attrs: { id: 'sort-select' } });
    for (const s of SORTS) this.sort.append(h('option', { attrs: { value: s } }));
    this.sort.addEventListener('change', () => cb.setSort(this.sort.value as SortOrder));
    this.sortLabel = h('label', { class: 'view-label', attrs: { for: 'sort-select' } });
    this.search = h('input', { class: 'input search', attrs: { type: 'search', spellcheck: 'false' } });
    this.search.addEventListener('input', () => {
      this.searchPending = true;
      clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => {
        this.searchPending = false;
        this.filter = { ...this.filter, search: this.search.value };
        cb.setFilter(this.filter);
      }, SEARCH_DELAY_MS);
    });
    this.popup = new FilterPopup((f) => {
      this.filter = { ...f, search: this.search.value };
      this.updateFilterButton();
      cb.setFilter(this.filter);
    }, (p) => cb.preset(p));
    this.popup.onClose = (focus) => {
      this.filterButton.setAttribute('aria-expanded', 'false');
      if (focus) this.filterButton.focus();
    };
    this.filterButton = h('button', { class: 'button filter-button', attrs: { 'type': 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' } });
    this.filterButton.addEventListener('click', () => {
      if (this.popup.isOpen) this.popup.close(false);
      else {
        this.popup.open();
        this.filterButton.setAttribute('aria-expanded', 'true');
      }
    });
    document.addEventListener('mousedown', (e) => {
      const t = e.target as Node;
      if (this.popup.isOpen && !this.popup.element.contains(t) && !this.filterButton.contains(t)) this.popup.close(false);
    });
    this.shown = h('span', { class: 'shown muted' });
    const filterWrap = h('div', { class: 'filter-wrap' }, this.filterButton, this.popup.element);
    this.summary = h('span', { class: 'summary' });
    this.spinner = h('span', { class: 'spinner', attrs: { 'aria-hidden': 'true' } });
    this.fetch = h('span', { class: 'fetch', attrs: { tabindex: '0' } });
    this.attention = h('button', { class: 'button attention-button', attrs: { 'type': 'button', 'aria-pressed': 'false' } });
    this.attention.addEventListener('click', () => cb.toggleAttention());
    this.element = h('div', { class: 'topbar' },
      h('div', { class: 'left' }, this.viewLabel, this.view, this.sortLabel, this.sort, this.search, filterWrap, this.shown),
      h('div', { class: 'right' }, this.summary, this.spinner, this.fetch, this.attention));
  }

  setStrings(S: Strings): void {
    this.S = S;
    this.viewLabel.textContent = S.view;
    const labels: Record<string, string> = { program: S['view.program'], area: S['view.area'], time: S['view.time'] };
    for (const o of Array.from(this.view.options)) o.textContent = labels[o.value];
    this.sortLabel.textContent = S.sort;
    for (const o of Array.from(this.sort.options)) o.textContent = S[`sort.${o.value as SortOrder}`];
    this.search.placeholder = S.search;
    this.search.setAttribute('aria-label', S.search);
    this.filterButton.textContent = S.filter;
    this.popup.setStrings(S);
  }

  update(st: {
    view: ViewMode; sort: SortOrder; filter: FilterDto; counts: Record<Status, number>; repos: RepoDto[]; summary: SummaryDto;
    busy: boolean; fetch: FetchStateDto[]; attentionCount: number; attentionOpen: boolean;
  }): void {
    const S = this.S;
    if (!S) return;
    this.view.value = st.view;
    this.sort.value = st.sort;
    // The search box is the user's: only filled from the host while not being typed in.
    this.filter = { ...st.filter, search: this.searchPending ? this.search.value : st.filter.search };
    if (!this.searchPending && document.activeElement !== this.search) this.search.value = st.filter.search;
    this.popup.setData(this.filter, st.counts, st.repos);
    this.updateFilterButton();
    this.shown.textContent = filterActive(this.filter) ? fmt(S.shown, st.summary.shown, st.summary.items) : '';
    let sum = fmt(S.summary, st.summary.repos, st.summary.items, st.summary.done);
    if (st.summary.unverified > 0) sum += ` · ${fmt(S['summary.unverified'], st.summary.unverified)}`;
    this.summary.textContent = sum;
    this.spinner.classList.toggle('busy', st.busy);
    this.spinner.title = st.busy ? S.scanning : '';
    let lastOk = 0;
    let failing = false;
    const lines: string[] = [];
    for (const f of st.fetch) {
      lastOk = Math.max(lastOk, f.lastOkUnix);
      if (f.firstFailUnix !== 0) {
        failing = true;
        lines.push(`${f.repo}: ${fmt(S.fetchFailing, clock(f.firstFailUnix), f.lastError)}`);
      } else lines.push(`${f.repo}: ${f.lastOkUnix ? clock(f.lastOkUnix) : S.notFetched}`);
    }
    // Repositories without origin are never fetched and not listed: with only those, nothing is shown.
    this.fetch.hidden = st.fetch.length === 0 && st.repos.length > 0;
    this.fetch.textContent = lastOk ? fmt(S.fetched, clock(lastOk)) : S.notFetched;
    this.fetch.classList.toggle('error', failing);
    this.fetch.title = lines.length ? lines.join('\n') : S.noRepositories;
    this.attention.textContent = fmt(S.attention, st.attentionCount);
    this.attention.classList.toggle('warn', st.attentionCount > 0);
    this.attention.setAttribute('aria-pressed', String(st.attentionOpen));
  }

  private updateFilterButton(): void {
    this.filterButton.classList.toggle('active', filterActive(this.filter));
  }
}
