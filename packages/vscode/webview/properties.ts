// The property table: label / value rows in collapsible groups (like Visual Studio's Properties window).
import type { DetailsDto, Strings } from '../src/protocol';
import { clear, focusedId, h, post, refocus } from './dom';
import { PropValue, formatDetails, statusClass, statusLabel } from './viewModel';

export class PropertiesView {
  readonly element: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly header: HTMLDivElement;
  /** Collapsed group titles; kept while the panel lives. */
  private readonly collapsed = new Set<string>();
  private S: Strings | null = null;
  private details: DetailsDto | null = null;
  /** JSON of the shown details: an identical post does not rebuild the table (focus stays). */
  private shown = '';

  constructor() {
    this.header = h('div', { class: 'pane-header' });
    this.body = h('div', { class: 'props-body' });
    this.element = h('div', { class: 'props' }, this.header, this.body);
  }

  setStrings(S: Strings): void {
    this.S = S;
    this.header.textContent = S['props.title'];
    this.render();
  }

  setDetails(d: DetailsDto | null): void {
    const json = JSON.stringify(d);
    if (json === this.shown) return;
    this.shown = json;
    this.details = d;
    this.render();
  }

  private render(): void {
    const focus = focusedId(this.body);
    clear(this.body);
    const S = this.S;
    if (!S) return;
    if (!this.details) {
      this.body.append(h('div', { class: 'empty muted', text: S['props.empty'] }));
      return;
    }
    const table = h('table', { class: 'props-table' });
    formatDetails(this.details, S).forEach((g, gi) => {
      const open = !this.collapsed.has(g.title);
      const toggle = h('button', { class: `group-toggle ${open ? 'open' : 'closed'}`, text: g.title,
        attrs: { 'aria-expanded': String(open), 'type': 'button', 'data-fid': `g-${gi}` } });
      toggle.addEventListener('click', () => {
        if (open) this.collapsed.add(g.title);
        else this.collapsed.delete(g.title);
        this.render();
      });
      table.append(h('tr', { class: 'group' }, h('td', { attrs: { colspan: '2' } }, toggle)));
      if (!open) return;
      g.rows.forEach((row, ri) => {
        const label = h('td', { class: 'label-cell' });
        if (row.pill) label.append(h('span', { class: statusClass(row.pill), text: statusLabel(row.pill, S) }));
        else label.textContent = row.label;
        table.append(h('tr', {}, label, h('td', { class: 'value-cell' }, this.value(row.value, S, `v-${gi}-${ri}`))));
      });
    });
    this.body.append(table);
    refocus(this.body, focus);
  }

  /** fid: stable id of focusable values (links), for restoring focus after a rebuild. */
  private value(v: PropValue, S: Strings, fid: string): Node {
    switch (v.kind) {
      case 'text': {
        const cls = ['value'];
        if (v.muted) cls.push('muted');
        if (v.error) cls.push('error');
        if (v.right) cls.push('right');
        if (v.wrap) cls.push('wrap');
        return h('div', { class: cls.join(' '), text: v.text, title: v.title });
      }
      case 'link': {
        const a = h('button', { class: `link${v.muted ? ' muted' : ''}`, text: v.text, title: v.title,
          attrs: { 'type': 'button', 'data-fid': fid } });
        a.addEventListener('click', () => post(v.action));
        if (!v.pill) return a;
        return h('div', { class: 'value inline' }, a, h('span', { class: statusClass(v.pill), text: statusLabel(v.pill, S) }));
      }
      case 'pill': {
        const d = h('div', { class: 'value inline' }, h('span', { class: statusClass(v.status), text: statusLabel(v.status, S) }));
        if (v.note) d.append(h('span', { class: 'muted', text: v.note }));
        return d;
      }
      case 'list': {
        const d = h('div', { class: 'value list' });
        v.items.forEach((item, k) => d.append(this.value(item, S, `${fid}-${k}`)));
        return d;
      }
      case 'progress': {
        const bar = h('div', { class: 'progress-fill' });
        bar.style.width = `${Math.round(Math.min(1, Math.max(0, v.fraction)) * 100)}%`;
        return h('div', { class: 'progress', attrs: { 'role': 'progressbar', 'aria-valuenow': String(Math.round(v.fraction * 100)),
          'aria-valuemin': '0', 'aria-valuemax': '100' } }, bar, h('span', { class: 'progress-text', text: v.text }));
      }
    }
  }
}
