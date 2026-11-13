// The Filter dropdown: presets, status checkboxes with counts, hidden repositories, sizes.
import type { FilterDto, FilterPreset, RepoDto, Status, Strings } from '../src/protocol';
import { STATUS_ORDER } from '../src/protocol';
import { clear, focusedId, h, refocus } from './dom';
import { statusClass, statusLabel, toggleInSet } from './viewModel';

export const SIZES = ['XS', 'S', 'M', 'L', 'XL', ''];
const NON_DROPPED: readonly Status[] = STATUS_ORDER.filter((s) => s !== 'dropped');

/** Anything beyond the default (all but dropped, every repository and size, no search). */
export function filterActive(f: FilterDto): boolean {
  const st = new Set(f.statuses);
  const defaultStatuses = st.size === NON_DROPPED.length && NON_DROPPED.every((s) => st.has(s));
  return !defaultStatuses || f.hiddenRepos.length > 0 || f.sizes.length > 0 || f.search !== '';
}

export class FilterPopup {
  readonly element: HTMLDivElement;
  private S: Strings | null = null;
  private filter: FilterDto = { statuses: [], hiddenRepos: [], sizes: [], search: '' };
  private counts: Record<Status, number> | null = null;
  private repos: RepoDto[] = [];

  /** onPreset: the host applies the preset (hidden repositories and the search are kept). */
  constructor(private readonly onChange: (f: FilterDto) => void, private readonly onPreset: (p: FilterPreset) => void) {
    this.element = h('div', { class: 'filter-popup', attrs: { role: 'dialog' } });
    this.element.hidden = true;
    this.element.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close(true);
      }
    });
  }

  /** Called when it closes; restore focus to the button. */
  onClose: (focusButton: boolean) => void = () => undefined;

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  setStrings(S: Strings): void {
    this.S = S;
    this.element.setAttribute('aria-label', S.filter);
  }

  setData(filter: FilterDto, counts: Record<Status, number>, repos: RepoDto[]): void {
    this.filter = filter;
    this.counts = counts;
    this.repos = repos;
    if (this.isOpen) this.render();
  }

  open(): void {
    this.element.hidden = false;
    this.render();
    (this.element.querySelector('button, input') as HTMLElement | null)?.focus();
  }

  close(focusButton: boolean): void {
    if (!this.isOpen) return;
    this.element.hidden = true;
    this.onClose(focusButton);
  }

  private change(f: FilterDto): void {
    this.filter = f;
    this.render();
    this.onChange(f);
  }

  private checkbox(label: Node, checked: boolean, on: (v: boolean) => void): HTMLLabelElement {
    const input = h('input', { attrs: { type: 'checkbox' } });
    input.checked = checked;
    input.addEventListener('change', () => on(input.checked));
    return h('label', { class: 'check' }, input, label);
  }

  private render(): void {
    const S = this.S;
    if (!S) return;
    const focusId = focusedId(this.element);
    clear(this.element);
    const f = this.filter;

    this.element.append(h('div', { class: 'section-title', text: S['filter.presets'] }));
    const presets = h('div', { class: 'presets' });
    const names: [FilterPreset, string][] = [['all', S['preset.all']], ['open', S['preset.open']], ['done', S['preset.done']],
      ['onBranch', S['preset.onBranch']], ['bugs', S['preset.bugs']]];
    for (const [p, text] of names) {
      const b = h('button', { class: 'button', text, attrs: { 'type': 'button', 'data-fid': `p-${p}` } });
      b.addEventListener('click', () => this.onPreset(p));
      presets.append(b);
    }
    this.element.append(presets);

    this.element.append(h('div', { class: 'section-title', text: S['filter.status'] }));
    const statuses = h('div', { class: 'status-grid' });
    for (const s of STATUS_ORDER) {
      const on = f.statuses.includes(s);
      const cb = this.checkbox(h('span', { class: statusClass(s), text: statusLabel(s, S) }), on, (v) => {
        const next = v ? [...f.statuses, s] : f.statuses.filter((x) => x !== s);
        this.change({ ...f, statuses: STATUS_ORDER.filter((x) => next.includes(x)) });
      });
      cb.querySelector('input')!.dataset.fid = `s-${s}`;
      statuses.append(cb, h('span', { class: 'count', text: String(this.counts?.[s] ?? 0) }));
    }
    this.element.append(statuses);

    this.element.append(h('div', { class: 'section-title', text: S['filter.repositories'] }));
    const repos = h('div', { class: 'repo-list' });
    if (this.repos.length === 0) repos.append(h('div', { class: 'muted', text: S.noRepositories }));
    this.repos.forEach((r, i) => {
      const cb = this.checkbox(document.createTextNode(r.name), !f.hiddenRepos.includes(r.key), (v) => {
        const hidden = v ? f.hiddenRepos.filter((k) => k !== r.key) : [...f.hiddenRepos, r.key];
        this.change({ ...f, hiddenRepos: hidden });
      });
      cb.title = r.key;
      cb.querySelector('input')!.dataset.fid = `r-${i}`;
      repos.append(cb);
    });
    this.element.append(repos);

    this.element.append(h('div', { class: 'section-title', text: S['filter.size'] }));
    const sizes = h('div', { class: 'sizes' });
    for (const size of SIZES) {
      const on = f.sizes.length === 0 || f.sizes.includes(size);
      const cb = this.checkbox(document.createTextNode(size === '' ? S['filter.noSize'] : size), on, (v) => {
        this.change({ ...f, sizes: toggleInSet(f.sizes, SIZES, size, v) });
      });
      cb.querySelector('input')!.dataset.fid = `z-${size}`;
      sizes.append(cb);
    }
    this.element.append(sizes);

    refocus(this.element, focusId);
  }
}
