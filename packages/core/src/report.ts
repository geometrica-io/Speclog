// Report model: the numbers and item lists of a period, from the board's state at its start and end.
// Pure: no git, no vscode. Counting follows the board (Dropped out of total, Unverified not done) and
// covers items on main only; branch-only items appear only under In progress, when the end state is live.
import { normalizeId } from './adapters';
import type { Status } from './model';
import type { Period } from './reportPeriod';
import { curveDays, startDay } from './reportPeriod';
import { ReplaySession } from './replay';
import type { ReplayOptions, ReplayWarning } from './replay';
import type { RepoSnapshot } from './snapshot';
import type { ResolvedItem, UnverifiedMode, Workspace } from './status';

export interface Progress { done: number; total: number; }

export interface ReportItem {
  repo: string; repoPath: string; programPath: string; programTitle: string;
  id: string; title: string; status: Status; isNew: boolean;
  /** item.created or ''. */
  created: string;
  /** Finished: doneDate. */
  closedDate: string;
  /** Newest closing commit dated closedDate; absent for history-done items. */
  closedCommit?: { hash: string; subject: string };
  progressReason?: { kind: 'onBranch' | 'branchOnly' | 'partial' | 'commit'; branches: string[]; date: string };
  change?: 'reopened' | 'dropped' | 'removed';
}

export interface ProgramReport { path: string; title: string; start: Progress; end: Progress; }

export interface RepoReport {
  name: string; path: string; key: string;
  start: Progress; end: Progress; programs: ProgramReport[];
  /** One per curve day. */
  curve: Progress[];
  finished: ReportItem[]; inProgress: ReportItem[]; added: ReportItem[]; remaining: ReportItem[]; changed: ReportItem[];
}

/** A note about a selected repository's data (e.g. its last scan failed and older data was used). */
export interface ReportWarning { repo: string; message: string; }

export interface ReportModel {
  period: Period; startDay: string; curveDays: string[];
  /** The end state is the board's (the period ends today). */
  endIsLive: boolean;
  /** Selected repositories, in the order given. */
  repos: RepoReport[];
  total: { start: Progress; end: Progress; curve: Progress[] };
  /** Notes about the selected repositories' data, once each; [] when there are none. */
  warnings: ReportWarning[];
}

export interface ReportInput {
  period: Period; start: Workspace; end: Workspace; endIsLive: boolean;
  /** Ascending by day; the curve days. */
  curve: { day: string; workspace: Workspace }[];
  selectedRepoPaths: readonly string[];
  /** Replay warnings of any repository; only the selected repositories' ones reach the model. */
  warnings?: readonly ReplayWarning[];
}

export function percent(p: Progress): number | null {
  return p.total === 0 ? null : Math.round((100 * p.done) / p.total);
}

const keyOf = (r: ResolvedItem): string => `${r.repoPath}\u0000${r.program.format}\u0000${normalizeId(r.program.format, r.item.id)}`;

/** Items of a workspace by repository path, grouped once per workspace (curve days share workspaces). */
const grouped = new WeakMap<Workspace, Map<string, { all: ResolvedItem[]; main: ResolvedItem[] }>>();

function itemsOf(w: Workspace, repoPath: string): { all: ResolvedItem[]; main: ResolvedItem[] } {
  let g = grouped.get(w);
  if (!g) {
    g = new Map();
    for (const r of w.items) {
      let e = g.get(r.repoPath);
      if (!e) g.set(r.repoPath, (e = { all: [], main: [] }));
      e.all.push(r);
      if (!r.branchOnly) e.main.push(r);
    }
    grouped.set(w, g);
  }
  return g.get(repoPath) ?? { all: [], main: [] };
}

/** One repository's items of one workspace, on main only. */
function mainItems(w: Workspace, repoPath: string): ResolvedItem[] {
  return itemsOf(w, repoPath).main;
}

function progressOf(items: readonly ResolvedItem[]): Progress {
  const p: Progress = { done: 0, total: 0 };
  for (const r of items) {
    if (r.status === 'dropped') continue;
    p.total++;
    if (r.status === 'done') p.done++;
  }
  return p;
}

const ZERO: Progress = { done: 0, total: 0 };
const addProgress = (a: Progress, b: Progress): Progress => ({ done: a.done + b.done, total: a.total + b.total });

type Line = ReportItem & { line: number };

function byPlace(a: Line, b: Line): number {
  if (a.programPath !== b.programPath) return a.programPath < b.programPath ? -1 : 1;
  return a.line - b.line;
}

function toLine(r: ResolvedItem, isNew: boolean): Line {
  return {
    repo: r.repo, repoPath: r.repoPath, programPath: r.program.path, programTitle: r.program.title || r.program.path,
    id: r.item.id, title: r.item.title, status: r.status, isNew, created: r.item.created, closedDate: '',
    line: r.item.line,
  };
}

function setClosing(r: ResolvedItem, l: Line): void {
  l.closedDate = r.doneDate;
  // Same-day order across repositories is not guaranteed, so prefer the item's own repository.
  const same = r.commits.filter((x) => x.closes && x.date === r.doneDate);
  const c = same.find((x) => x.repo === r.repo) ?? same[0];
  if (c) l.closedCommit = { hash: c.hash, subject: c.subject };
}

function reasonOf(r: ResolvedItem, from: string, to: string, live: boolean): ReportItem['progressReason'] {
  const dates = r.commits.filter((c) => c.date >= from && c.date <= to).map((c) => c.date).sort();
  const last = dates.length ? dates[dates.length - 1] : '';
  if (live && r.branchOnly) return { kind: 'branchOnly', branches: r.branches, date: last };
  if (live && r.status === 'onBranch') return { kind: 'onBranch', branches: r.branches, date: last };
  if (r.status === 'partial') return { kind: 'partial', branches: [], date: last };
  if (last) return { kind: 'commit', branches: [], date: last };
  return undefined;
}

function strip(l: Line): ReportItem {
  const { line: _line, ...rest } = l;
  return rest;
}

function programReports(start: ResolvedItem[], end: ResolvedItem[]): ProgramReport[] {
  const titles = new Map<string, string>();
  for (const r of [...end, ...start]) if (!titles.has(r.program.path)) titles.set(r.program.path, r.program.title || r.program.path);
  return [...titles.keys()].sort().map((path) => ({
    path, title: titles.get(path)!,
    start: progressOf(start.filter((r) => r.program.path === path)),
    end: progressOf(end.filter((r) => r.program.path === path)),
  }));
}

function repoReport(path: string, input: ReportInput): RepoReport {
  const { period, start, end, endIsLive, curve } = input;
  const info = [...end.snapshots, ...start.snapshots].find((s) => s.repo.path === path)?.repo;
  const startMain = mainItems(start, path);
  const startBy = new Map(startMain.map((r) => [keyOf(r), r]));
  const endMain = mainItems(end, path);
  const endKeys = new Set(endMain.map(keyOf));

  const finished: Line[] = [];
  const inProgress: Line[] = [];
  const added: Line[] = [];
  const remaining: Line[] = [];
  const changed: Line[] = [];

  // Every end item that is not Done at both ends and not Dropped at both ends is in exactly one of
  // Finished / In progress / Remaining / Changed (Done-at-both and Dropped-at-both items are in no list).
  // Added also lists the items that are new (they appear in their state list too).
  for (const r of endMain) {
    const before = startBy.get(keyOf(r));
    const l = toLine(r, !before);
    if (!before && r.status !== 'dropped') added.push({ ...l });
    if (r.status === 'dropped') {
      // Created and dropped inside the period counts too (isNew); dropped at both ends does not.
      if (before?.status !== 'dropped') changed.push({ ...l, change: 'dropped' });
    } else if (before?.status === 'done' && r.status !== 'done') {
      changed.push({ ...l, change: 'reopened' });
    } else if (r.status === 'done') {
      if (before?.status !== 'done') {
        setClosing(r, l);
        finished.push(l);
      }
    } else {
      const reason = reasonOf(r, period.from, period.to, endIsLive);
      if (reason) inProgress.push({ ...l, progressReason: reason });
      else remaining.push(l);
    }
  }
  if (endIsLive) {
    for (const r of itemsOf(end, path).all) {
      if (!r.branchOnly || r.status === 'dropped') continue;
      inProgress.push({ ...toLine(r, false), progressReason: reasonOf(r, period.from, period.to, true) });
    }
  }
  for (const r of startMain) {
    if (r.status !== 'dropped' && !endKeys.has(keyOf(r))) changed.push({ ...toLine(r, false), change: 'removed' });
  }
  for (const list of [finished, inProgress, added, remaining, changed]) list.sort(byPlace);

  return {
    name: info?.name ?? path, path, key: info?.key ?? path,
    start: progressOf(startMain), end: progressOf(endMain),
    programs: programReports(startMain, endMain),
    curve: curve.map((c) => progressOf(mainItems(c.workspace, path))),
    finished: finished.map(strip), inProgress: inProgress.map(strip), added: added.map(strip),
    remaining: remaining.map(strip), changed: changed.map(strip),
  };
}

/** The selected repositories' warnings, once each; an unselected repository's warnings are dropped. */
function warningsOf(input: ReportInput): ReportWarning[] {
  const selected = new Set(input.selectedRepoPaths);
  const seen = new Set<string>();
  const out: ReportWarning[] = [];
  for (const w of input.warnings ?? []) {
    const k = `${w.repo}\u0000${w.message}`;
    if (!selected.has(w.repoPath) || seen.has(k)) continue;
    seen.add(k);
    out.push({ repo: w.repo, message: w.message });
  }
  return out;
}

export function buildReport(input: ReportInput): ReportModel {
  const repos = input.selectedRepoPaths.map((p) => repoReport(p, input));
  const sum = (pick: (r: RepoReport) => Progress): Progress => repos.reduce((a, r) => addProgress(a, pick(r)), ZERO);
  return {
    period: input.period,
    startDay: startDay(input.period),
    curveDays: input.curve.map((c) => c.day),
    endIsLive: input.endIsLive,
    repos,
    total: {
      start: sum((r) => r.start),
      end: sum((r) => r.end),
      curve: input.curve.map((_, i) => sum((r) => r.curve[i])),
    },
    warnings: warningsOf(input),
  };
}

export interface ReplayDaysOptions {
  snapshots: readonly RepoSnapshot[]; today: string; period: Period; mode: UnverifiedMode; signal?: AbortSignal;
  onProgress?: (doneSteps: number, totalSteps: number) => void;
  /** Opens a repository's blob reader (tests: to count readers); default: a new BlobReader. */
  openBlobReader?: ReplayOptions['openBlobReader'];
}

/** The replayed board of every curve day except a today the live workspace stands in for, and the warnings. */
export interface ReplayedDays { byDay: ReadonlyMap<string, Workspace>; warnings: readonly ReplayWarning[]; }

/**
 * Replays each distinct curve day once. Null with the error when a replay read fails or the run is cancelled;
 * the session is closed in every case.
 */
export async function replayDays(o: ReplayDaysOptions): Promise<{ days: ReplayedDays | null; error: string }> {
  const days = curveDays(o.period);
  const endIsLive = o.period.to === o.today;
  const toReplay = days.filter((d) => !(endIsLive && d === o.today));
  const total = toReplay.length;
  o.onProgress?.(0, total);
  const session = new ReplaySession(o.snapshots, o.mode, o.signal, { openBlobReader: o.openBlobReader });
  try {
    const byDay = new Map<string, Workspace>();
    const warnings = new Map<string, ReplayWarning>();
    for (const d of toReplay) {
      if (o.signal?.aborted) return { days: null, error: 'cancelled' };
      const r = await session.at(d);
      if (r.error) return { days: null, error: r.error };
      for (const w of r.warnings) warnings.set(`${w.repoPath}\u0000${w.message}`, w);
      byDay.set(d, r.workspace);
      o.onProgress?.(byDay.size, total);
    }
    if (o.signal?.aborted) return { days: null, error: 'cancelled' };
    return { days: { byDay, warnings: [...warnings.values()] }, error: '' };
  } finally {
    await session.close();
  }
}

/**
 * The newest replay, reused while the snapshots (element by element), the mode, today and the period stay the
 * same: a new repository selection then only rebuilds the report.
 */
export class ReplayCache {
  private entry: { key: ReplayDaysOptions; days: ReplayedDays } | undefined;

  get(o: ReplayDaysOptions): ReplayedDays | undefined {
    const k = this.entry?.key;
    if (!k || k.mode !== o.mode || k.today !== o.today || k.period.from !== o.period.from || k.period.to !== o.period.to) return undefined;
    if (k.snapshots.length !== o.snapshots.length || k.snapshots.some((s, i) => s !== o.snapshots[i])) return undefined;
    return this.entry!.days;
  }

  set(o: ReplayDaysOptions, days: ReplayedDays): void {
    this.entry = { key: { snapshots: [...o.snapshots], mode: o.mode, today: o.today, period: { ...o.period } }, days };
  }
}

export interface ComputeReportOptions extends ReplayDaysOptions {
  live: Workspace; selectedRepoPaths: readonly string[];
  /** Reuses an earlier replay of the same snapshots and period (see ReplayCache). */
  cache?: ReplayCache;
}

/** The report from replayed days; the live workspace stands in for today when the period ends today. */
export function reportFromDays(days: ReplayedDays, o: { period: Period; today: string; live: Workspace; selectedRepoPaths: readonly string[] }): ReportModel {
  const curve = curveDays(o.period);
  const endIsLive = o.period.to === o.today;
  const wsOf = (d: string): Workspace => days.byDay.get(d) ?? o.live;
  return buildReport({
    period: o.period, start: wsOf(curve[0]), end: wsOf(curve[curve.length - 1]),
    endIsLive, curve: curve.map((day) => ({ day, workspace: wsOf(day) })), selectedRepoPaths: o.selectedRepoPaths,
    warnings: days.warnings,
  });
}

/** Replays each distinct day once (or reuses the cache's replay) and builds the report. */
export async function computeReport(o: ComputeReportOptions): Promise<{ model: ReportModel | null; error: string }> {
  let days = o.cache?.get(o);
  if (days) {
    o.onProgress?.(days.byDay.size, days.byDay.size);
  } else {
    const r = await replayDays(o);
    if (!r.days) return { model: null, error: r.error };
    days = r.days;
    o.cache?.set(o, days);
  }
  if (o.signal?.aborted) return { model: null, error: 'cancelled' };
  return { model: reportFromDays(days, o), error: '' };
}
