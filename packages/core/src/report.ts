// Report model: the numbers and item lists of a period, from the board's state at its start and end.
// Pure: no git, no vscode. Counting follows the board (Dropped out of total, Unverified not done) and
// covers items on main only; branch-only items appear only under In progress, when the end state is live.
import { normalizeId } from './adapters';
import type { Status } from './model';
import type { Period } from './reportPeriod';
import { curveDays, startDay } from './reportPeriod';
import { ReplaySession } from './replay';
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

export interface ReportModel {
  period: Period; startDay: string; curveDays: string[];
  /** The end state is the board's (the period ends today). */
  endIsLive: boolean;
  /** Selected repositories, in the order given. */
  repos: RepoReport[];
  total: { start: Progress; end: Progress; curve: Progress[] };
}

export interface ReportInput {
  period: Period; start: Workspace; end: Workspace; endIsLive: boolean;
  /** Ascending by day; the curve days. */
  curve: { day: string; workspace: Workspace }[];
  selectedRepoPaths: readonly string[];
}

export function percent(p: Progress): number | null {
  return p.total === 0 ? null : Math.round((100 * p.done) / p.total);
}

const keyOf = (r: ResolvedItem): string => `${r.repoPath}\u0000${r.program.format}\u0000${normalizeId(r.program.format, r.item.id)}`;

/** One repository's items of one workspace, on main only. */
function mainItems(w: Workspace, repoPath: string): ResolvedItem[] {
  return w.items.filter((r) => r.repoPath === repoPath && !r.branchOnly);
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
    for (const r of end.items) {
      if (r.repoPath !== path || !r.branchOnly || r.status === 'dropped') continue;
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
  };
}

export interface ComputeReportOptions {
  snapshots: readonly RepoSnapshot[]; live: Workspace; today: string; period: Period; mode: UnverifiedMode;
  selectedRepoPaths: readonly string[]; signal?: AbortSignal;
  onProgress?: (doneSteps: number, totalSteps: number) => void;
}

/** Replays each distinct day once (the live workspace stands in for today) and builds the report. */
export async function computeReport(o: ComputeReportOptions): Promise<{ model: ReportModel | null; error: string }> {
  const days = curveDays(o.period);
  const endIsLive = o.period.to === o.today;
  const toReplay = days.filter((d) => !(endIsLive && d === o.today));
  const total = toReplay.length;
  o.onProgress?.(0, total);
  const session = new ReplaySession(o.snapshots, o.mode, o.signal);
  try {
    const byDay = new Map<string, Workspace>();
    for (const d of toReplay) {
      if (o.signal?.aborted) return { model: null, error: 'cancelled' };
      const r = await session.at(d);
      if (r.error) return { model: null, error: r.error };
      byDay.set(d, r.workspace);
      o.onProgress?.(byDay.size, total);
    }
    if (o.signal?.aborted) return { model: null, error: 'cancelled' };
    const wsOf = (d: string): Workspace => byDay.get(d) ?? o.live;
    return {
      model: buildReport({
        period: o.period, start: wsOf(days[0]), end: wsOf(days[days.length - 1]),
        endIsLive, curve: days.map((day) => ({ day, workspace: wsOf(day) })), selectedRepoPaths: o.selectedRepoPaths,
      }),
      error: '',
    };
  } finally {
    await session.close();
  }
}
