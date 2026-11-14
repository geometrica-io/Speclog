// The panel's UI state kept in workspaceState, and validation of values coming from the webview or
// from storage. Pure (no `vscode`).
import { defaultFilter } from '@speclog/core';
import { filterFromDto, filterToDto } from './dto';
import { MAX_KEY_LENGTH } from './protocol';
import type { Status, ViewMode } from './protocol';

export const VIEWS: readonly ViewMode[] = ['program', 'area', 'time'];
export const MAX_KEYS = 20000;
/** Engine states arriving within this window are posted once. */
export const COALESCE_MS = 100;

/** Panel state remembered per workspace (the search text is not). */
export interface PersistedUi {
  view: ViewMode;
  statuses: Status[];
  sizes: string[];
  open: Record<ViewMode, string[]>;
  selected: Record<ViewMode, string>;
  attentionOpen: boolean;
  attentionHeight: number;
  treeFraction: number;
}

export function defaultUi(): PersistedUi {
  return {
    view: 'program', statuses: filterToDto(defaultFilter()).statuses, sizes: [], open: { program: [], area: [], time: [] },
    selected: { program: '', area: '', time: '' }, attentionOpen: false, attentionHeight: 180, treeFraction: 0.52,
  };
}

export const strList = (v: unknown, max = MAX_KEYS): string[] =>
  (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, max) : []);
export const num = (v: unknown, fallback: number, min: number, max: number): number =>
  (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
export const isView = (v: unknown): v is ViewMode => VIEWS.includes(v as ViewMode);
export const isStr = (v: unknown): v is string => typeof v === 'string';
export const isKey = (v: unknown): v is string => isStr(v) && v.length <= MAX_KEY_LENGTH;

/** Validates stored UI state (it may come from an older version). */
export function readUi(raw: unknown): PersistedUi {
  const d = defaultUi();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const per = <T>(v: unknown, f: (x: unknown) => T): Record<ViewMode, T> => {
    const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    return { program: f(o.program), area: f(o.area), time: f(o.time) };
  };
  return {
    view: isView(r.view) ? r.view : d.view,
    statuses: Array.isArray(r.statuses) ? filterToDto(filterFromDto({ statuses: strList(r.statuses) as Status[] })).statuses : d.statuses,
    sizes: strList(r.sizes, 50),
    open: per(r.open, (x) => strList(x)),
    selected: per(r.selected, (x) => (isStr(x) ? x : '')),
    attentionOpen: r.attentionOpen === true,
    attentionHeight: num(r.attentionHeight, d.attentionHeight, 40, 4000),
    treeFraction: num(r.treeFraction, d.treeFraction, 0.1, 0.9),
  };
}

/** Validates the stored trust cutoffs (globalState): repoKey -> non-empty commit string. */
export function readTrustCommits(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isStr(v) && v !== '') out[k] = v;
  return out;
}

/** Validates the stored hidden repositories (globalState): distinct non-empty repo keys. */
export function readHiddenRepos(raw: unknown): string[] {
  return [...new Set(strList(raw).filter((k) => k !== ''))];
}
