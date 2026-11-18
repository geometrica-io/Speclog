// Webview entry: builds the layout (top bar; tree | properties; Attention panel at the bottom),
// renders the host's DTOs and sends intents. No user-visible text is hard-coded: it comes in "init".
import type { HostToWebview, Strings } from '../src/protocol';
import { AttentionView } from './attention';
import { h, post } from './dom';
import { AgentMenu } from './menu';
import { PropertiesView } from './properties';
import { TopBar } from './topBar';
import { TreeView } from './tree';
import { emptyTreeText, mergeOpenKeys, treeKeys } from './viewModel';

type StateMessage = Extract<HostToWebview, { type: 'state' }>;

const MIN_PANE_PX = 120;
const SPLIT_STEP_PX = 16;

let S: Strings | null = null;
let state: StateMessage | null = null;
let attentionOpen = false;
let attentionHeight = 180;
let treeFraction = 0.52;
let selectedKey = '';
let openKeys: string[] = [];
/** Local toggles the host has not confirmed in a state yet. */
let pendingToggles = new Map<string, boolean>();

const tree = new TreeView({
  select(key) {
    selectedKey = key;
    post({ type: 'select', key });
  },
  toggle(key, open) {
    openKeys = open ? [...openKeys, key] : openKeys.filter((k) => k !== key);
    pendingToggles.set(key, open);
    post({ type: 'toggle', key, open });
  },
  contextMenu(key, x, y) {
    menu.show(key, x, y, tree.element);
  },
});
const menu = new AgentMenu();
const props = new PropertiesView();
const attention = new AttentionView();
const topBar = new TopBar({
  setView: (view) => post({ type: 'setView', view }),
  setSort: (sort) => post({ type: 'setSort', sort }),
  setFilter: (filter) => post({ type: 'setFilter', filter }),
  preset: (preset) => post({ type: 'preset', preset }),
  toggleAttention: () => {
    attentionOpen = !attentionOpen;
    applyLayout();
    sendLayout();
    renderTopBar();
  },
});

const treePane = h('div', { class: 'pane tree-pane' }, tree.element);
const vsplit = h('div', { class: 'splitter vertical', attrs: { 'role': 'separator', 'aria-orientation': 'vertical', 'tabindex': '0' } });
const propsPane = h('div', { class: 'pane props-pane' }, props.element);
const main = h('div', { class: 'main' }, treePane, vsplit, propsPane);
const hsplit = h('div', { class: 'splitter horizontal', attrs: { 'role': 'separator', 'aria-orientation': 'horizontal', 'tabindex': '0' } });
const attentionPane = h('div', { class: 'pane attention-pane' }, attention.element);
const app = document.getElementById('app')!;
app.append(topBar.element, main, hsplit, attentionPane, menu.element);

function clampHeight(v: number): number {
  const max = Math.max(MIN_PANE_PX, app.clientHeight - topBar.element.offsetHeight - MIN_PANE_PX);
  return Math.round(Math.min(max, Math.max(40, v)));
}

function applyLayout(): void {
  hsplit.hidden = !attentionOpen;
  attentionPane.hidden = !attentionOpen;
  attentionPane.style.height = `${clampHeight(attentionHeight)}px`;
  treePane.style.flexBasis = `${(treeFraction * 100).toFixed(2)}%`;
}

function sendLayout(): void {
  post({ type: 'layout', attentionOpen, attentionHeight, treeFraction });
}

/** Pointer drag on a splitter; the layout is sent when the drag ends. */
function drag(el: HTMLElement, move: (e: PointerEvent) => void): void {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    const onMove = (m: PointerEvent) => { move(m); applyLayout(); };
    const onUp = () => {
      el.releasePointerCapture(e.pointerId);
      el.classList.remove('dragging');
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      sendLayout();
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  });
}

drag(vsplit, (e) => {
  const r = main.getBoundingClientRect();
  if (r.width <= 0) return;
  treeFraction = Math.min(0.9, Math.max(0.1, (e.clientX - r.left) / r.width));
});
drag(hsplit, (e) => {
  attentionHeight = clampHeight(app.getBoundingClientRect().bottom - e.clientY);
});
vsplit.addEventListener('keydown', (e) => {
  const w = main.clientWidth || 1;
  if (e.key === 'ArrowLeft') treeFraction = Math.max(0.1, treeFraction - SPLIT_STEP_PX / w);
  else if (e.key === 'ArrowRight') treeFraction = Math.min(0.9, treeFraction + SPLIT_STEP_PX / w);
  else return;
  e.preventDefault();
  applyLayout();
  sendLayout();
});
hsplit.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp') attentionHeight = clampHeight(attentionHeight + SPLIT_STEP_PX);
  else if (e.key === 'ArrowDown') attentionHeight = clampHeight(attentionHeight - SPLIT_STEP_PX);
  else return;
  e.preventDefault();
  applyLayout();
  sendLayout();
});
window.addEventListener('resize', applyLayout);

function renderTopBar(): void {
  if (!state) return;
  topBar.update({
    view: state.view, sort: state.sort, filter: state.filter, counts: state.counts, repos: state.repos, summary: state.summary, busy: state.busy,
    fetch: state.fetch, attentionCount: state.attention.length, attentionOpen,
  });
}

function renderState(m: StateMessage): void {
  if (state && (state.view !== m.view || state.sort !== m.sort)) pendingToggles = new Map();
  state = m;
  attentionOpen = m.ui.attentionOpen;
  attentionHeight = m.ui.attentionHeight;
  treeFraction = m.ui.treeFraction;
  selectedKey = m.ui.selectedKey;
  const merged = mergeOpenKeys(m.ui.openKeys, pendingToggles, treeKeys(m.tree));
  openKeys = merged.open;
  pendingToggles = merged.pending;
  applyLayout();
  renderTopBar();
  tree.setData(m.tree, openKeys, selectedKey, m.view, m.ui.reveal, S ? emptyTreeText(m.tree, m.busy, m.summary.items, S) : '');
  attention.setItems(m.attention);
}

window.addEventListener('message', (e: MessageEvent<HostToWebview>) => {
  const m = e.data;
  if (!m || typeof m !== 'object') return;
  switch (m.type) {
    case 'init':
      S = m.strings;
      topBar.setStrings(S);
      tree.setStrings(S);
      props.setStrings(S);
      menu.setStrings(S);
      attention.setStrings(S);
      if (state) renderState(state);
      else tree.setData({ key: 'root', label: '', kind: 'root', done: 0, total: 0, children: [] }, [], '', 'program', false, S['tree.scanning']);
      props.setDetails(null);
      break;
    case 'state':
      renderState(m);
      break;
    case 'status':
      if (!state) break;
      state = { ...state, busy: m.busy, fetch: m.fetch, attention: m.attention };
      // The scan ending changes "Scanning…" to the normal empty text without a new tree.
      if (S) tree.setMessage(emptyTreeText(state.tree, state.busy, state.summary.items, S));
      renderTopBar();
      attention.setItems(m.attention);
      break;
    case 'details':
      if (m.key === selectedKey || m.key === '') props.setDetails(m.details);
      menu.setDetails(m.details);
      break;
  }
});

// VS Code rewrites the theme variables (html style) and body classes on a theme or font change.
const themeObserver = new MutationObserver(() => tree.themeChanged());
themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

applyLayout();
post({ type: 'ready' });
