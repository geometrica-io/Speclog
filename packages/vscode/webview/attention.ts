// The Attention panel: rows grouped by kind with counts; a row click jumps to the item / repository or
// opens the file; the unverifiedSummary row has a "Trust current task files" button.
import type { AttentionItemDto, Strings } from '../src/protocol';
import { clear, focusedId, h, post, refocus } from './dom';
import { attentionGroups } from './viewModel';

export class AttentionView {
  readonly element: HTMLDivElement;
  private readonly collapsed = new Set<string>();
  private S: Strings | null = null;
  private items: AttentionItemDto[] = [];
  /** JSON of the shown rows: an identical post does not rebuild the table (focus stays). */
  private shown = '';

  constructor() {
    this.element = h('div', { class: 'attention' });
  }

  setStrings(S: Strings): void {
    this.S = S;
    this.render();
  }

  setItems(items: AttentionItemDto[]): void {
    const json = JSON.stringify(items);
    if (json === this.shown) return;
    this.shown = json;
    this.items = items;
    this.render();
  }

  private render(): void {
    const focus = focusedId(this.element);
    clear(this.element);
    const S = this.S;
    if (!S) return;
    if (this.items.length === 0) {
      this.element.append(h('div', { class: 'empty muted', text: S['att.empty'] }));
      return;
    }
    const table = h('table', { class: 'att-table' });
    table.append(h('thead', {}, h('tr', {},
      h('th', { text: S['att.repository'] }), h('th', { text: S['att.reference'] }), h('th', { text: S['att.detail'] }))));
    const body = h('tbody');
    for (const g of attentionGroups(this.items, S)) {
      const open = !this.collapsed.has(g.kind);
      const toggle = h('button', { class: `group-toggle ${open ? 'open' : 'closed'}`, text: `${g.title} (${g.rows.length})`,
        attrs: { 'aria-expanded': String(open), 'type': 'button', 'data-fid': `g-${g.kind}` } });
      toggle.addEventListener('click', () => {
        if (open) this.collapsed.add(g.kind);
        else this.collapsed.delete(g.kind);
        this.render();
      });
      body.append(h('tr', { class: 'group' }, h('td', { attrs: { colspan: '3' } }, toggle)));
      if (!open) continue;
      g.rows.forEach((r, ri) => {
        const detail = h('td', { class: 'detail' }, h('span', { text: r.detail }));
        if (r.button) {
          const b = h('button', { class: 'button small', text: r.button.text,
            attrs: { 'type': 'button', 'data-fid': `b-${g.kind}-${ri}` } });
          const action = r.button.action;
          b.addEventListener('click', (e) => { e.stopPropagation(); post(action); });
          detail.append(b);
        }
        const tr = h('tr', { class: r.action ? 'att-row clickable' : 'att-row' },
          h('td', { class: 'repo', text: r.repo }), h('td', { class: 'ref', text: r.ref, title: r.refTitle }), detail);
        if (r.action) {
          const action = r.action;
          tr.tabIndex = 0;
          tr.dataset.fid = `r-${g.kind}-${ri}`;
          tr.addEventListener('click', () => post(action));
          tr.addEventListener('keydown', (e) => {
            if (e.target === tr && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              post(action);
            }
          });
        }
        body.append(tr);
      });
    }
    table.append(body);
    this.element.append(table);
    refocus(this.element, focus);
  }
}
