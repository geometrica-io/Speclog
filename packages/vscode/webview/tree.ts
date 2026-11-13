// The task tree with virtual scrolling: only the rows in view (plus a margin) exist in the DOM.
// Keyboard: Up/Down move, Right opens / goes to the first child, Left closes / goes to the parent,
// Home/End/PageUp/PageDown, Enter or Space selects (focus alone never selects).
import type { Strings, TreeNodeDto, ViewMode } from '../src/protocol';
import { clear, h } from './dom';
import { TreeRow, rowsForTree, statusClass, statusLabel } from './viewModel';
import { STATUS_ORDER } from '../src/protocol';

const OVERSCAN = 12;
const INDENT_PX = 16;

export interface TreeCallbacks {
  select(key: string): void;
  toggle(key: string, open: boolean): void;
}

export class TreeView {
  readonly element: HTMLDivElement;
  private readonly spacer: HTMLDivElement;
  private readonly message: HTMLDivElement;
  private tree: TreeNodeDto | null = null;
  private rows: TreeRow[] = [];
  private open = new Set<string>();
  private selected = '';
  private focusKey = '';
  private view: ViewMode = 'program';
  private S: Strings | null = null;
  private rowH = 22;
  private frame = 0;

  constructor(private readonly cb: TreeCallbacks) {
    this.spacer = h('div', { class: 'tree-spacer', attrs: { role: 'presentation' } });
    this.message = h('div', { class: 'tree-message muted' });
    this.element = h('div', { class: 'tree', attrs: { role: 'tree', tabindex: '0' } }, this.message, this.spacer);
    this.element.addEventListener('scroll', () => this.schedule());
    this.element.addEventListener('click', (e) => this.onClick(e));
    this.element.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    this.element.addEventListener('keydown', (e) => this.onKey(e));
    this.element.addEventListener('focus', () => {
      if (!this.focusKey && this.rows.length > 0) this.setFocus(this.indexOf(this.selected) >= 0 ? this.indexOf(this.selected) : 0);
    });
    new ResizeObserver(() => { this.measure(); this.schedule(); }).observe(this.element);
  }

  setStrings(S: Strings): void {
    this.S = S;
    this.element.setAttribute('aria-label', S['tree.label']);
    this.measurePills();
  }

  /** New data from the host; reveal scrolls the selected row into view. */
  setData(tree: TreeNodeDto, openKeys: string[], selectedKey: string, view: ViewMode, reveal: boolean, emptyText: string): void {
    this.tree = tree;
    this.open = new Set(openKeys);
    this.selected = selectedKey;
    this.view = view;
    this.message.textContent = emptyText;
    this.message.hidden = emptyText === '';
    this.relayout();
    if (reveal) {
      const i = this.indexOf(selectedKey);
      if (i >= 0) {
        this.focusKey = selectedKey;
        this.scrollToRow(i, true);
      }
    }
    this.render();
  }

  setSelected(key: string): void {
    this.selected = key;
    this.render();
  }

  private relayout(): void {
    this.rows = this.tree ? rowsForTree(this.tree, this.open) : [];
    this.spacer.style.height = `${this.rows.length * this.rowH}px`;
    if (this.focusKey && this.indexOf(this.focusKey) < 0) this.focusKey = '';
  }

  private indexOf(key: string): number {
    return key === '' ? -1 : this.rows.findIndex((r) => r.key === key);
  }

  /** Row height from a probe row (follows the theme font size and zoom). */
  private measure(): void {
    const probe = h('div', { class: 'row', text: 'Ag' });
    probe.style.visibility = 'hidden';
    this.spacer.append(probe);
    const hgt = probe.getBoundingClientRect().height;
    probe.remove();
    if (hgt > 0 && Math.abs(hgt - this.rowH) > 0.5) {
      this.rowH = hgt;
      this.spacer.style.height = `${this.rows.length * this.rowH}px`;
    }
  }

  /** Pills share the widest label's width, so titles end at the same x. */
  private measurePills(): void {
    if (!this.S) return;
    const box = h('div', { class: 'pill-probe' });
    for (const s of STATUS_ORDER) box.append(h('span', { class: statusClass(s), text: statusLabel(s, this.S) }));
    document.body.append(box);
    let w = 0;
    for (const c of Array.from(box.children)) w = Math.max(w, c.getBoundingClientRect().width);
    box.remove();
    if (w > 0) this.element.style.setProperty('--pill-width', `${Math.ceil(w)}px`);
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render(): void {
    clear(this.spacer);
    if (!this.S || this.rows.length === 0) {
      this.element.removeAttribute('aria-activedescendant');
      return;
    }
    const top = this.element.scrollTop;
    const height = this.element.clientHeight || 600;
    const first = Math.max(0, Math.floor(top / this.rowH) - OVERSCAN);
    const last = Math.min(this.rows.length, Math.ceil((top + height) / this.rowH) + OVERSCAN);
    for (let i = first; i < last; i++) this.spacer.append(this.rowElement(i));
    const fi = this.indexOf(this.focusKey);
    if (fi >= first && fi < last) this.element.setAttribute('aria-activedescendant', `row-${fi}`);
    else this.element.removeAttribute('aria-activedescendant');
  }

  private rowElement(i: number): HTMLDivElement {
    const r = this.rows[i];
    const n = r.node;
    const S = this.S!;
    const selectKey = n.kind === 'placeholder' ? n.selectKey ?? '' : n.key;
    const classes = ['row'];
    if (selectKey === this.selected && this.selected !== '') classes.push('selected');
    if (r.key === this.focusKey) classes.push('focused');
    const el = h('div', { class: classes.join(' '), attrs: {
      'role': 'treeitem', 'id': `row-${i}`, 'data-index': String(i), 'aria-level': String(r.depth + 1),
      'aria-selected': String(selectKey === this.selected),
    } });
    if (r.expandable) el.setAttribute('aria-expanded', String(r.open));
    el.style.top = `${i * this.rowH}px`;
    el.style.paddingLeft = `${4 + r.depth * INDENT_PX}px`;
    el.append(h('span', { class: `twisty${r.expandable ? (r.open ? ' open' : ' closed') : ''}`, attrs: { 'aria-hidden': 'true' } }));
    if (n.kind === 'item') {
      el.append(h('span', { class: 'id', text: n.id ?? '' }));
      if (this.view !== 'program' && n.repo) el.append(h('span', { class: 'repo muted', text: n.repo }));
      el.append(h('span', { class: `label${n.status === 'done' ? ' muted' : ''}`, text: n.label }));
      if (n.status) el.append(h('span', { class: `${statusClass(n.status)} row-pill`, text: statusLabel(n.status, S) }));
      el.title = `${n.repo ?? ''} · ${n.id ?? ''}\n${n.label}`;
    } else if (n.kind === 'placeholder') {
      el.append(h('span', { class: 'label muted', text: n.label }));
    } else {
      el.append(h('span', { class: 'label', text: n.label }), h('span', { class: 'count', text: `${n.done} / ${n.total}` }));
      el.title = n.label;
    }
    return el;
  }

  private rowIndexOf(e: Event): number {
    const row = (e.target as HTMLElement).closest('.row');
    return row ? Number(row.getAttribute('data-index')) : -1;
  }

  private onClick(e: MouseEvent): void {
    const i = this.rowIndexOf(e);
    if (i < 0 || i >= this.rows.length) return;
    const r = this.rows[i];
    this.focusKey = r.key;
    if ((e.target as HTMLElement).classList.contains('twisty') && r.expandable) {
      this.toggle(i, !r.open);
      return;
    }
    this.select(i);
  }

  private onDoubleClick(e: MouseEvent): void {
    const i = this.rowIndexOf(e);
    if (i < 0 || (e.target as HTMLElement).classList.contains('twisty')) return;
    const r = this.rows[i];
    if (r.expandable) this.toggle(i, !r.open);
  }

  private select(i: number): void {
    const n = this.rows[i].node;
    const key = n.kind === 'placeholder' ? n.selectKey ?? '' : n.key;
    if (key === '') return;
    this.selected = key;
    this.render();
    this.cb.select(key);
  }

  private toggle(i: number, open: boolean): void {
    const key = this.rows[i].key;
    if (open) this.open.add(key);
    else this.open.delete(key);
    this.focusKey = key;
    this.relayout();
    this.render();
    this.cb.toggle(key, open);
  }

  private setFocus(i: number): void {
    if (this.rows.length === 0) return;
    const k = Math.max(0, Math.min(this.rows.length - 1, i));
    this.focusKey = this.rows[k].key;
    this.scrollToRow(k, false);
    this.render();
  }

  private scrollToRow(i: number, center: boolean): void {
    const el = this.element;
    const y = i * this.rowH;
    const view = el.clientHeight;
    if (center) el.scrollTop = Math.max(0, y - (view - this.rowH) / 2);
    else if (y < el.scrollTop) el.scrollTop = y;
    else if (y + this.rowH > el.scrollTop + view) el.scrollTop = y + this.rowH - view;
  }

  private onKey(e: KeyboardEvent): void {
    if (this.rows.length === 0) return;
    let i = this.indexOf(this.focusKey);
    if (i < 0) i = Math.max(0, this.indexOf(this.selected));
    const r = this.rows[i];
    const page = Math.max(1, Math.floor(this.element.clientHeight / this.rowH) - 1);
    switch (e.key) {
      case 'ArrowDown': this.setFocus(this.focusKey ? i + 1 : i); break;
      case 'ArrowUp': this.setFocus(i - 1); break;
      case 'PageDown': this.setFocus(i + page); break;
      case 'PageUp': this.setFocus(i - page); break;
      case 'Home': this.setFocus(0); break;
      case 'End': this.setFocus(this.rows.length - 1); break;
      case 'ArrowRight':
        if (r.expandable && !r.open) this.toggle(i, true);
        else if (r.expandable) this.setFocus(i + 1);
        break;
      case 'ArrowLeft':
        if (r.expandable && r.open) this.toggle(i, false);
        else if (r.parent >= 0) this.setFocus(r.parent);
        break;
      case 'Enter':
      case ' ':
        this.focusKey = r.key;
        this.select(i);
        break;
      default:
        return;
    }
    e.preventDefault();
  }
}
