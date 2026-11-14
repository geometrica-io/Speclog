// The item row context menu: one entry, Send to agent. Its state comes from the item's details (the
// host computes availability); until they arrive the entry is disabled. Escape, a click elsewhere,
// scrolling or losing focus closes it.
import type { DetailsDto, Strings } from '../src/protocol';
import { h, post } from './dom';

export class AgentMenu {
  readonly element: HTMLDivElement;
  private readonly entry: HTMLButtonElement;
  private key = '';
  private returnFocus: HTMLElement | null = null;

  constructor() {
    this.entry = h('button', { class: 'menu-entry', attrs: { 'type': 'button', 'role': 'menuitem', 'aria-disabled': 'true' } });
    this.element = h('div', { class: 'context-menu', attrs: { role: 'menu' } }, this.entry);
    this.element.hidden = true;
    this.entry.addEventListener('click', () => {
      if (this.entry.getAttribute('aria-disabled') === 'true') return;
      const key = this.key;
      this.hide();
      post({ type: 'sendToAgent', key });
    });
    this.element.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault();
        this.hide();
      }
    });
    this.element.addEventListener('focusout', (e) => {
      if (!this.element.contains(e.relatedTarget as Node | null)) this.hide(false);
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this.element.hidden && !this.element.contains(e.target as Node)) this.hide(false);
    }, true);
    window.addEventListener('blur', () => this.hide(false));
    document.addEventListener('scroll', () => this.hide(false), true);
  }

  setStrings(S: Strings): void {
    this.entry.textContent = S['agent.send'];
  }

  /** Opens the menu for an item row at (x, y) in viewport pixels. */
  show(key: string, x: number, y: number, returnFocus: HTMLElement): void {
    this.key = key;
    this.returnFocus = returnFocus;
    this.setEnabled(false, '');
    this.element.hidden = false;
    const r = this.element.getBoundingClientRect();
    this.element.style.left = `${Math.max(0, Math.min(x, window.innerWidth - r.width))}px`;
    this.element.style.top = `${Math.max(0, Math.min(y, window.innerHeight - r.height))}px`;
    this.entry.focus();
  }

  /** Details of the selected node; only those of the menu's item change it. */
  setDetails(d: DetailsDto | null): void {
    if (this.element.hidden || !d || d.kind !== 'item' || d.key !== this.key) return;
    this.setEnabled(d.agent.enabled, d.agent.reason);
  }

  hide(refocus = true): void {
    if (this.element.hidden) return;
    this.element.hidden = true;
    this.key = '';
    if (refocus) this.returnFocus?.focus();
    this.returnFocus = null;
  }

  /** aria-disabled (not disabled) keeps the entry focusable, so its reason tooltip stays reachable. */
  private setEnabled(enabled: boolean, reason: string): void {
    this.entry.setAttribute('aria-disabled', String(!enabled));
    if (reason) this.entry.title = reason;
    else this.entry.removeAttribute('title');
  }
}
