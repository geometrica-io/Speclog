// DOM helpers and the host channel of the webview.
import type { WebviewToHost } from '../src/protocol';

interface VsCodeApi { postMessage(message: unknown): void; }
declare function acquireVsCodeApi(): VsCodeApi;

const api = acquireVsCodeApi();

export function post(m: WebviewToHost): void {
  api.postMessage(m);
}

export interface Props {
  class?: string;
  text?: string;
  title?: string;
  attrs?: Record<string, string>;
}

/** Creates an element; text is always set as text (never parsed as HTML). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.title) el.title = props.title;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  for (const c of children) el.append(c);
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** The data-fid of the focused element inside container, to restore after a re-render. */
export function focusedId(container: Element): string | undefined {
  const a = document.activeElement;
  return a instanceof HTMLElement && container.contains(a) ? a.dataset.fid : undefined;
}

export function refocus(container: Element, id: string | undefined): void {
  if (id === undefined) return;
  (container.querySelector(`[data-fid="${CSS.escape(id)}"]`) as HTMLElement | null)?.focus();
}
