#!/usr/bin/env node
// Acceptance comparison: Speclog core vs ProjectManager (PM) `--check` on the same repositories.
//
//   npm run build
//   node scripts/compare-with-pm.mjs [--root C:\Antigravity] [--pm-exe <ProjectManager.exe>]
//                                    [--pm-output <saved --check output>] [--origin-filter a,b]
//
// PM side: runs `<pm-exe> --check --root <root>` (PM creates an invisible GLFW window, so it needs a
// desktop session), or reads a saved output with --pm-output. Speclog side: the built core
// (packages/core/dist), no fetch; --origin-filter (comma-separated, default: empty = every
// repository) should match the origin filter PM was run with.
//
// Compared per repository (keyed by folder name, as PM does): done/total of docs/tasks items
// (PM's total excludes Dropped) and, for every Attention kind PM also has, the sorted list of refs
// (PM PrintCheck prints "<ref>:<line>" when a line is known; see speclogRef).
// Differences listed in EXPLAINED are known and intentional; any other difference makes the script
// exit 1.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

/** PM's kind name -> Speclog's. Kinds only Speclog has are not compared. */
export const KINDS = {
  'stale-branch': 'staleBranch', 'untagged-commit': 'untaggedCommit', 'evidence-conflict': 'evidenceConflict',
  'unknown-ref': 'unknownRef', 'format-issue': 'formatIssue', 'duplicate-id': 'duplicateId',
  'no-tasks-dir': 'noTaskFiles', 'history-done-after-since': 'historyDoneAfterSince',
  'fetch-failing': 'fetchFailing', 'git-error': 'gitError',
};
const SPECLOG_TO_PM = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [v, k]));
/** Known intentional differences: "<repo>|<metric>" -> reason. */
const EXPLAINED = {};
/** PM's defaults (Attention.h staleBranchDays = 7, MainWindow.cpp kFetchFailSec = 3600). */
const STALE_BRANCH_DAYS = 7;
const FETCH_FAIL_SECONDS = 3600;

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

/** "a, b,,c" -> ["a", "b", "c"]; "" -> [] (every repository). */
export function parseList(s) {
  return s.split(',').map((x) => x.trim()).filter((x) => x !== '');
}

/** PM `--check` output -> { repos: Map(folder -> { done, total }), attention: [{ kind, repo, ref, detail }] }. */
export function parsePm(text) {
  const repos = new Map();
  const attention = [];
  for (const line of text.split(/\r?\n/)) {
    let m = /^attention: (\S+) (\S+) ?(\S*)(?: (.*))?$/.exec(line);
    if (m) { attention.push({ kind: m[1], repo: m[2], ref: m[3], detail: m[4] ?? '' }); continue; }
    m = /^(\S+) (\d+)\/(\d+)$/.exec(line);
    if (m) repos.set(m[1], { done: Number(m[2]), total: Number(m[3]) });
  }
  return { repos, attention };
}

async function speclog(root, originFilter) {
  const core = require(path.join(here, '..', 'packages', 'core', 'dist', 'index.js'));
  const { repos } = await core.discoverRepos({ workspaceFolders: [], roots: [root], exclude: [], originFilter });
  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
  const snaps = await core.mapLimit(repos, 6, (r) => core.buildSnapshot(r, { today }));
  const ws = core.resolveAll(snaps, 'unverified');
  const att = core.computeAttention(ws, {
    today, staleBranchDays: STALE_BRANCH_DAYS, recentDays: core.RECENT_DAYS, fetchFailSeconds: FETCH_FAIL_SECONDS,
  }, [], Math.floor(Date.now() / 1000));
  const folder = (p) => path.basename(p);
  const per = new Map(repos.map((r) => [folder(r.path), { done: 0, total: 0, other: 0 }]));
  for (const it of ws.items) {
    const c = per.get(folder(it.repoPath));
    if (it.program.format !== 'docsTasks') { c.other++; continue; } // PM reads docs/tasks only
    if (it.status === 'done') c.done++;
    if (it.status !== 'dropped') c.total++;
  }
  const attention = att.map((a) => ({
    kind: a.kind, repo: folder(a.repoPath), ref: speclogRef(a), detail: a.detail,
  }));
  return { repos: per, attention };
}

/**
 * PM kinds whose rows carry a line: PrintCheck appends ":<line>" when line > 0, and only format-issue
 * rows set one (Attention.cpp: parse issues and done-without-since).
 */
const LINE_KINDS = new Set(['formatIssue']);

/** A Speclog Attention row's ref written the way PM prints it for the same kind. */
export function speclogRef(a) {
  return LINE_KINDS.has(a.kind) && a.line > 0 ? `${a.ref}:${a.line}` : a.ref;
}

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Elements of a not in b, as multisets. */
function minus(a, b) {
  const left = [...b];
  const out = [];
  for (const x of a) {
    const i = left.indexOf(x);
    if (i >= 0) left.splice(i, 1);
    else out.push(x);
  }
  return out;
}

/**
 * Compares parsed PM output with Speclog's results (same shape; Speclog kind names on the Speclog
 * side). Pure; returns the table rows and every difference.
 */
export function compare(pm, sp, explained = EXPLAINED) {
  const names = [...new Set([...pm.repos.keys(), ...sp.repos.keys()])]
    .sort((a, b) => byText(a.toLowerCase(), b.toLowerCase()) || byText(a, b));
  const refsOf = (list, kind, repo) => list.filter((a) => a.repo === repo && a.kind === kind).map((a) => a.ref).sort(byText);
  const diffs = []; // { repo, metric, pm, speclog, onlyPm?, onlySpeclog?, reason? }
  const rows = [];
  const attRows = [];
  for (const n of names) {
    const a = pm.repos.get(n);
    const b = sp.repos.get(n);
    const as = a ? `${a.done}/${a.total}` : '-';
    const bs = b ? `${b.done}/${b.total}` : '-';
    rows.push([n, as, bs, as === bs ? 'ok' : 'DIFF', b && b.other ? `(+${b.other} non-docs/tasks items not compared)` : '']);
    if (as !== bs) diffs.push({ repo: n, metric: 'done/total', pm: as, speclog: bs });
    for (const [k, sk] of Object.entries(KINDS)) {
      const pr = refsOf(pm.attention, k, n);
      const sr = refsOf(sp.attention, sk, n);
      if (pr.length === 0 && sr.length === 0) continue;
      const same = pr.length === sr.length && pr.every((x, i) => x === sr[i]);
      attRows.push([n, k, pr.length, sr.length, same ? 'ok' : 'DIFF']);
      if (!same) {
        diffs.push({ repo: n, metric: `attention ${k}`, pm: pr.length, speclog: sr.length, onlyPm: minus(pr, sr), onlySpeclog: minus(sr, pr) });
      }
    }
  }
  for (const d of diffs) d.reason = explained[`${d.repo}|${d.metric}`];
  const extraKinds = {};
  for (const a of sp.attention) if (!SPECLOG_TO_PM[a.kind]) extraKinds[a.kind] = (extraKinds[a.kind] ?? 0) + 1;
  return { rows, attRows, diffs, unexplained: diffs.filter((d) => !d.reason), extraKinds };
}

const pad = (s, n) => String(s).padEnd(n);

async function main() {
  const root = arg('--root', 'C:\\Antigravity');
  const saved = arg('--pm-output', '');
  const originFilter = parseList(arg('--origin-filter', ''));
  let pmText;
  if (saved) pmText = readFileSync(saved, 'utf8');
  else {
    const exe = arg('--pm-exe', 'C:\\Antigravity\\ProjectManager\\build\\Debug\\ProjectManager.exe');
    if (!existsSync(exe)) { console.error(`PM executable not found: ${exe}`); process.exit(2); }
    pmText = execFileSync(exe, ['--check', '--root', root], { encoding: 'utf8', maxBuffer: 1 << 28 });
  }
  const pm = parsePm(pmText);
  if (pm.repos.size === 0) { console.error('PM output has no repository lines (did PM --check fail?)'); process.exit(2); }
  const r = compare(pm, await speclog(root, originFilter));

  console.log('Per-repository done/total (docs/tasks items; PM total excludes Dropped)');
  console.log(`${pad('repo', 28)}${pad('PM', 10)}${pad('Speclog', 10)}${pad('result', 8)}note`);
  for (const x of r.rows) console.log(`${pad(x[0], 28)}${pad(x[1], 10)}${pad(x[2], 10)}${pad(x[3], 8)}${x[4]}`);

  console.log('\nAttention (kind, repo, ref) of kinds PM also has (rows where either side lists any)');
  console.log(`${pad('repo', 28)}${pad('kind', 26)}${pad('PM', 6)}${pad('Speclog', 9)}result`);
  for (const x of r.attRows) console.log(`${pad(x[0], 28)}${pad(x[1], 26)}${pad(x[2], 6)}${pad(x[3], 9)}${x[4]}`);
  console.log(`\nSpeclog-only attention kinds (not compared): ${JSON.stringify(r.extraKinds)}`);

  console.log('\nDifferences');
  if (r.diffs.length === 0) console.log('none');
  for (const d of r.diffs) {
    console.log(`- ${d.repo} / ${d.metric}: PM ${d.pm}, Speclog ${d.speclog} -> ${d.reason ? `explained: ${d.reason}` : 'UNEXPLAINED'}`);
    if (d.onlyPm?.length) console.log(`    only in PM: ${d.onlyPm.slice(0, 10).join(', ')}${d.onlyPm.length > 10 ? ' ...' : ''}`);
    if (d.onlySpeclog?.length) console.log(`    only in Speclog: ${d.onlySpeclog.slice(0, 10).join(', ')}${d.onlySpeclog.length > 10 ? ' ...' : ''}`);
  }
  console.log(`\n${r.unexplained.length === 0 ? 'EQUAL (all differences explained)' : `${r.unexplained.length} UNEXPLAINED difference(s)`}`);
  process.exit(r.unexplained.length === 0 ? 0 : 1);
}

// Run only as a script; tests import the pure functions above.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(2); });
}
