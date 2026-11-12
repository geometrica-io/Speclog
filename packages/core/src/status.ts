// Status engine: port of ProjectManager src/core/StatusEngine.cpp, extended with the hand-written
// status rules of Backlog.md / Spec Kit (spec §4.4–§4.5) and owner-qualified repository names (§6).
// The status on screen comes from git: a closing commit on main, then one on an unmerged branch,
// then the task file.
import { normalizeId } from './adapters';
import type { TaskRef } from './git/commitRefs';
import type { CommitInfo } from './git/repo';
import type { Item, Program, SourceFormat, Status } from './model';
import type { RepoSnapshot } from './snapshot';

/** speclog.unverifiedDone: how a Backlog.md / Spec Kit "done" without git evidence is shown. */
export type UnverifiedMode = 'unverified' | 'done' | 'open';

export interface CommitLink { repo: string; hash: string; date: string; subject: string; closes: boolean; }

export interface ResolvedItem {
  repo: string;
  /** Per-repository settings key (origin URL, else path); clones of one origin share it. */
  repoKey: string;
  /** RepoInfo.path: unique per clone. */
  repoPath: string;
  /** A program inside Workspace.snapshots. */
  program: Program;
  item: Item;
  status: Status;
  /** docs/tasks only: done from the file's history (status: done + done:). */
  historical: boolean;
  /** Done in the file now and at the repository's trust cutoff: shown as Done (from file). */
  trustedFromFile: boolean;
  /** Done in the file without git evidence, shown as done because the mode is "done". */
  flaggedUnverified: boolean;
  /** The item exists only on an unmerged branch. */
  branchOnly: boolean;
  /** Newest closing commit on main, or the docs/tasks history date; "" otherwise. */
  doneDate: string;
  /** Branches holding a closing commit. */
  branches: string[];
  commits: CommitLink[];
}

export interface Workspace {
  /** Owned; ResolvedItem.program points into these. */
  snapshots: RepoSnapshot[];
  items: ResolvedItem[];
  unknownRefs: { repo: string; hash: string; refRepo: string; refId: string }[];
  duplicates: { repo: string; id: string; paths: string[] }[];
  /** A bare repository name in a Task line that matches several repositories (resolves nowhere). */
  ambiguousRepoRefs: { repo: string; hash: string; refRepo: string }[];
  /** repoPath -> that repository's ids, for findItem / findDependency. */
  itemIndex: Map<string, RepoItemIndex>;
}

/** Ids of one repository's items, as indexes into Workspace.items. */
export interface RepoItemIndex {
  exact: Map<string, number>;
  /** Folded id -> item, case-insensitive formats (Backlog.md) only. */
  foldedCi: Map<string, number>;
}

/** Formats whose status is written by hand, so a "done" in the file needs git evidence. */
const HAND_WRITTEN: readonly SourceFormat[] = ['backlogMd', 'specKit'];

/** ASCII case folding, as PM compares repository names. */
function fold(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** True when the format's ids ignore case (Backlog.md). */
function caseInsensitive(format: SourceFormat): boolean {
  return normalizeId(format, 'A') !== 'A';
}

type RepoMatch = { kind: 'found'; index: number } | { kind: 'unknown' } | { kind: 'ambiguous' };

/**
 * Resolves the repository part of "Repo:Id" written in repository self: "name" matches a repository
 * name ignoring case, "owner/name" matches owner and name ignoring case. Clones of one origin (same
 * key) are one repository, whose target is the first clone. A bare name naming self resolves to
 * self; otherwise several distinct repositories are ambiguous.
 */
function resolveRepo(snapshots: readonly RepoSnapshot[], name: string, self: number): RepoMatch {
  const slash = name.lastIndexOf('/');
  const owner = slash === -1 ? null : fold(name.slice(0, slash));
  const bare = fold(slash === -1 ? name : name.slice(slash + 1));
  const hits: number[] = [];
  snapshots.forEach((s, k) => {
    if (fold(s.repo.name) !== bare) return;
    if (owner !== null && fold(s.repo.owner) !== owner) return;
    hits.push(k);
  });
  if (hits.length === 0) return { kind: 'unknown' };
  if (owner === null && hits.includes(self)) return { kind: 'found', index: self };
  if (new Set(hits.map((k) => snapshots[k].repo.key)).size > 1) return { kind: 'ambiguous' };
  return { kind: 'found', index: hits[0] };
}

/** The item an id refers to: exact, else ignoring case among case-insensitive formats. */
function lookup(index: RepoItemIndex, id: string): number | undefined {
  return index.exact.get(id) ?? index.foldedCi.get(fold(id));
}

/** Item lookup of one repository: exact ids, plus folded ids of case-insensitive formats. */
class RepoIndex implements RepoItemIndex {
  readonly exact = new Map<string, number>();
  readonly foldedCi = new Map<string, number>();
  /** Folded id -> first item of any format. */
  private readonly foldedAny = new Map<string, number>();

  /** The item a Task line id refers to. */
  find(id: string): number | undefined {
    return lookup(this, id);
  }

  /** The existing item a new item (format, id) clashes with: same id, ignoring case if either side ignores it. */
  clash(format: SourceFormat, id: string): number | undefined {
    const e = this.exact.get(id);
    if (e !== undefined) return e;
    return caseInsensitive(format) ? this.foldedAny.get(fold(id)) : this.foldedCi.get(fold(id));
  }

  add(format: SourceFormat, id: string, index: number): void {
    const f = fold(id);
    if (!this.exact.has(id)) this.exact.set(id, index);
    if (!this.foldedAny.has(f)) this.foldedAny.set(f, index);
    if (caseInsensitive(format) && !this.foldedCi.has(f)) this.foldedCi.set(f, index);
  }
}

/** Per-item evidence gathered from commits while resolving. */
interface Acc {
  closedOnMain: boolean;
  newestMainClose: string;
  branches: string[];
  commits: CommitLink[];
  /** "repo key\nhash" -> index in commits; clones of one origin share a commit's link. */
  linkByKey: Map<string, number>;
}

const trustKey = (format: SourceFormat, id: string) => `${format}\0${normalizeId(format, id)}`;

export function resolveAll(snapshots: RepoSnapshot[], mode: UnverifiedMode): Workspace {
  const w: Workspace = { snapshots: [...snapshots], items: [], unknownRefs: [], duplicates: [], ambiguousRepoRefs: [],
    itemIndex: new Map() };
  const indexes: RepoIndex[] = [];
  const repoOfItem: number[] = []; // item -> snapshot index

  // Pass 1: items (main programs first, then branch-only), duplicates.
  w.snapshots.forEach((s, ri) => {
    const index = new RepoIndex();
    indexes.push(index);
    if (!w.itemIndex.has(s.repo.path)) w.itemIndex.set(s.repo.path, { exact: index.exact, foldedCi: index.foldedCi });
    const add = (p: Program, t: Item, branchOnly: boolean) => {
      index.add(p.format, t.id, w.items.length);
      repoOfItem.push(ri);
      const r: ResolvedItem = {
        repo: s.repo.name, repoKey: s.repo.key, repoPath: s.repo.path, program: p, item: t, status: 'open', historical: false,
        trustedFromFile: false, flaggedUnverified: false, branchOnly, doneDate: '', branches: [], commits: [],
      };
      w.items.push(r);
    };
    const paths = new Map<number, string[]>(); // first item -> paths holding its id
    const dupOrder: number[] = [];
    for (const p of s.programs) {
      for (const t of p.items) {
        const first = index.clash(p.format, t.id);
        if (first === undefined) {
          paths.set(w.items.length, [p.path]);
          add(p, t, false);
          continue;
        }
        const ps = paths.get(first)!;
        if (!ps.includes(p.path)) {
          ps.push(p.path);
          if (ps.length === 2) dupOrder.push(first);
        }
      }
    }
    for (const k of dupOrder) w.duplicates.push({ repo: s.repo.name, id: w.items[k].item.id, paths: paths.get(k)! });
    for (const b of s.branches) {
      for (const p of b.programs) {
        for (const t of p.items) if (index.clash(p.format, t.id) === undefined) add(p, t, true);
      }
    }
  });

  // Pass 2: walk every commit, attach it to the items it references.
  const acc: Acc[] = w.items.map(() => ({
    closedOnMain: false, newestMainClose: '', branches: [], commits: [], linkByKey: new Map(),
  }));
  const seenUnknown = new Set<string>();
  const seenAmbiguous = new Set<string>();
  w.snapshots.forEach((s, ri) => {
    const visit = (c: CommitInfo, branch: string | null) => {
      const handle = (ref: TaskRef, closes: boolean) => {
        let target = ri;
        if (ref.repo) {
          const m = resolveRepo(w.snapshots, ref.repo, ri);
          if (m.kind === 'ambiguous') {
            const key = [ri, c.hash, fold(ref.repo)].join('\n');
            if (!seenAmbiguous.has(key)) {
              seenAmbiguous.add(key);
              w.ambiguousRepoRefs.push({ repo: s.repo.name, hash: c.hash, refRepo: ref.repo });
            }
            return;
          }
          target = m.kind === 'found' ? m.index : -1;
        }
        const it = target === -1 ? undefined : indexes[target].find(ref.id);
        if (it === undefined) {
          const key = [ri, c.hash, ref.repo, ref.id].join('\n');
          if (!seenUnknown.has(key)) {
            seenUnknown.add(key);
            w.unknownRefs.push({ repo: s.repo.name, hash: c.hash, refRepo: ref.repo, refId: ref.id });
          }
          return;
        }
        const a = acc[it];
        const lk = `${s.repo.key}\n${c.hash}`;
        const li = a.linkByKey.get(lk);
        if (li === undefined) {
          a.linkByKey.set(lk, a.commits.length);
          a.commits.push({ repo: s.repo.name, hash: c.hash, date: c.date, subject: c.subject, closes });
        } else if (closes) {
          a.commits[li].closes = true;
        }
        if (!closes) return;
        if (branch === null) {
          a.closedOnMain = true;
          if (c.date > a.newestMainClose) a.newestMainClose = c.date;
        } else if (!a.branches.includes(branch)) {
          a.branches.push(branch);
        }
      };
      for (const r of c.refs.done) handle(r, true);
      for (const r of c.refs.progress) handle(r, false);
    };
    for (const c of s.mainCommits) visit(c, null);
    for (const b of s.branches) for (const c of b.commits) visit(c, b.tip.name);
  });

  // Items done in the files at each repository's trust cutoff.
  const doneAtTrust = w.snapshots.map((s) => {
    const done = new Set<string>();
    if (!s.trustCommit) return done;
    for (const p of s.programsAtTrust) for (const t of p.items) if (t.fileDone) done.add(trustKey(p.format, t.id));
    return done;
  });

  // Pass 3: status per spec §4.4 (main close, then branch close, then the file per §4.5).
  w.items.forEach((r, i) => {
    const a = acc[i];
    r.commits = a.commits;
    r.branches = a.branches;
    const format = r.program.format;
    if (a.closedOnMain) {
      r.status = 'done';
      r.doneDate = a.newestMainClose;
    } else if (r.branches.length > 0 || r.branchOnly) {
      r.status = 'onBranch';
    } else if (!HAND_WRITTEN.includes(format)) {
      // docs/tasks (PM): "done" in the file is history, kept as done.
      if (r.item.stored === 'done') {
        r.status = 'done';
        r.historical = true;
        r.doneDate = r.item.historyDate;
      } else {
        r.status = r.item.stored;
      }
    } else if (!r.item.fileDone) {
      r.status = r.item.stored;
    } else if (doneAtTrust[repoOfItem[i]].has(trustKey(format, r.item.id))) {
      r.status = 'done';
      r.trustedFromFile = true;
    } else if (mode === 'unverified') {
      r.status = 'unverified';
    } else if (mode === 'done') {
      r.status = 'done';
      r.flaggedUnverified = true;
    } else {
      r.status = 'open';
    }
  });
  return w;
}

/** The snapshot repo names: a key or path (exact), else a name ignoring case; the first such; -1 if none. */
function snapshotIndex(w: Workspace, repo: string): number {
  const exact = w.snapshots.findIndex((s) => s.repo.key === repo || s.repo.path === repo);
  if (exact !== -1) return exact;
  const name = fold(repo);
  return w.snapshots.findIndex((s) => fold(s.repo.name) === name);
}

/**
 * The item with id in repo (a repository key, path or name; a key or name shared by several
 * repositories gives the first one, a path is unique). Ids match exactly, or ignoring case for
 * formats whose ids ignore case.
 */
export function findItem(w: Workspace, repo: string, id: string): ResolvedItem | undefined {
  const k = snapshotIndex(w, repo);
  if (k === -1) return undefined;
  const index = w.itemIndex.get(w.snapshots[k].repo.path);
  const i = index ? lookup(index, id) : undefined;
  return i === undefined ? undefined : w.items[i];
}

/**
 * A depends entry of an item in fromRepo (a key, path or name as for findItem): "Id" (same
 * repository) or "Repo:Id", where Repo follows the "Task: Repo:Id" rule (name or owner/name ignoring
 * case; a name shared by distinct repositories other than fromRepo resolves nowhere).
 */
export function findDependency(w: Workspace, fromRepo: string, dep: string): ResolvedItem | undefined {
  const colon = dep.indexOf(':');
  if (colon === -1) return findItem(w, fromRepo, dep);
  const m = resolveRepo(w.snapshots, dep.slice(0, colon), snapshotIndex(w, fromRepo));
  if (m.kind !== 'found') return undefined;
  return findItem(w, w.snapshots[m.index].repo.path, dep.slice(colon + 1));
}
