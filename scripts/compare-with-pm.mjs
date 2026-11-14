#!/usr/bin/env node
// Acceptance comparison: Speclog core vs ProjectManager (PM) `--check` on the same repositories.
//
//   npm run build
//   node scripts/compare-with-pm.mjs [--root C:\Antigravity] [--pm-exe <ProjectManager.exe>]
//                                    [--pm-output <saved --check output>]
//
// PM side: runs `<pm-exe> --check --root <root>` (PM creates an invisible GLFW window, so it needs a
// desktop session), or reads a saved output with --pm-output. Speclog side: the built core
// (packages/core/dist) with originFilter github.com/ovasoft41/ + github.com/geometrica-io/, no fetch.
//
// Compared per repository (keyed by folder name, as PM does): done/total of docs/tasks items
// (PM's total excludes Dropped) and the count of every Attention kind PM also has. Differences listed
// in EXPLAINED are known and intentional; any other difference makes the script exit 1.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const core = require(path.join(here, '..', 'packages', 'core', 'dist', 'index.js'));

const ORIGIN_FILTER = ['github.com/ovasoft41/', 'github.com/geometrica-io/'];
/** PM's kind name -> Speclog's. Kinds only Speclog has are not compared. */
const KINDS = {
  'stale-branch': 'staleBranch', 'untagged-commit': 'untaggedCommit', 'evidence-conflict': 'evidenceConflict',
  'unknown-ref': 'unknownRef', 'format-issue': 'formatIssue', 'duplicate-id': 'duplicateId',
  'no-tasks-dir': 'noTaskFiles', 'history-done-after-since': 'historyDoneAfterSince',
  'fetch-failing': 'fetchFailing', 'git-error': 'gitError',
};
const SPECLOG_TO_PM = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [v, k]));
/** Known intentional differences: "<repo>|<metric>" -> reason. */
const EXPLAINED = {};

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function parsePm(text) {
  const repos = new Map(); // folder name -> { done, total }
  const attention = []; // { kind, repo, ref, detail }
  for (const line of text.split(/\r?\n/)) {
    let m = /^attention: (\S+) (\S+) ?(\S*)(?: (.*))?$/.exec(line);
    if (m) { attention.push({ kind: m[1], repo: m[2], ref: m[3], detail: m[4] ?? '' }); continue; }
    m = /^(\S+) (\d+)\/(\d+)$/.exec(line);
    if (m) repos.set(m[1], { done: Number(m[2]), total: Number(m[3]) });
  }
  return { repos, attention };
}

async function speclog(root) {
  const { repos } = await core.discoverRepos({ workspaceFolders: [], roots: [root], exclude: [], originFilter: ORIGIN_FILTER });
  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
  const snaps = await core.mapLimit(repos, 6, (r) => core.buildSnapshot(r, { today }));
  const ws = core.resolveAll(snaps, 'unverified');
  const att = core.computeAttention(ws, { today, staleBranchDays: 7, recentDays: core.RECENT_DAYS, fetchFailSeconds: 3600 }, [], Math.floor(Date.now() / 1000));
  const folder = (p) => path.basename(p);
  const per = new Map(repos.map((r) => [folder(r.path), { done: 0, total: 0, other: 0 }]));
  for (const it of ws.items) {
    const c = per.get(folder(it.repoPath));
    if (it.program.format !== 'docsTasks') { c.other++; continue; } // PM reads docs/tasks only
    if (it.status === 'done') c.done++;
    if (it.status !== 'dropped') c.total++;
  }
  const attention = att.map((a) => ({ kind: a.kind, repo: folder(a.repoPath), ref: a.ref, detail: a.detail }));
  return { repos: per, attention };
}

const pad = (s, n) => String(s).padEnd(n);

function counts(list, mapKind, repo) {
  const o = {};
  for (const a of list) {
    const k = mapKind(a.kind);
    if (a.repo === repo && k) o[k] = (o[k] ?? 0) + 1;
  }
  return o;
}

async function main() {
  const root = arg('--root', 'C:\\Antigravity');
  const saved = arg('--pm-output', '');
  let pmText;
  if (saved) pmText = readFileSync(saved, 'utf8');
  else {
    const exe = arg('--pm-exe', 'C:\\Antigravity\\ProjectManager\\build\\Debug\\ProjectManager.exe');
    if (!existsSync(exe)) { console.error(`PM executable not found: ${exe}`); process.exit(2); }
    pmText = execFileSync(exe, ['--check', '--root', root], { encoding: 'utf8', maxBuffer: 1 << 28 });
  }
  const pm = parsePm(pmText);
  if (pm.repos.size === 0) { console.error('PM output has no repository lines (did PM --check fail?)'); process.exit(2); }
  const sp = await speclog(root);

  const names = [...new Set([...pm.repos.keys(), ...sp.repos.keys()])].sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1);
  const identity = (k) => k;
  const toPm = (k) => SPECLOG_TO_PM[k];
  const diffs = []; // { repo, metric, pm, speclog }
  const rows = [];
  const attRows = [];
  for (const n of names) {
    const a = pm.repos.get(n);
    const b = sp.repos.get(n);
    const as = a ? `${a.done}/${a.total}` : '-';
    const bs = b ? `${b.done}/${b.total}` : '-';
    rows.push([n, as, bs, as === bs ? 'ok' : 'DIFF', b && b.other ? `(+${b.other} non-docs/tasks items not compared)` : '']);
    if (as !== bs) diffs.push({ repo: n, metric: 'done/total', pm: as, speclog: bs });
    const pa = counts(pm.attention, identity, n);
    const sa = counts(sp.attention, toPm, n);
    for (const k of Object.keys(KINDS)) {
      if (!pa[k] && !sa[k]) continue;
      const same = (pa[k] ?? 0) === (sa[k] ?? 0);
      attRows.push([n, k, pa[k] ?? 0, sa[k] ?? 0, same ? 'ok' : 'DIFF']);
      if (!same) diffs.push({ repo: n, metric: `attention ${k}`, pm: pa[k] ?? 0, speclog: sa[k] ?? 0 });
    }
  }

  console.log('Per-repository done/total (docs/tasks items; PM total excludes Dropped)');
  console.log(`${pad('repo', 28)}${pad('PM', 10)}${pad('Speclog', 10)}${pad('result', 8)}note`);
  for (const r of rows) console.log(`${pad(r[0], 28)}${pad(r[1], 10)}${pad(r[2], 10)}${pad(r[3], 8)}${r[4]}`);

  console.log('\nAttention counts of kinds PM also has (rows where either side lists any)');
  console.log(`${pad('repo', 28)}${pad('kind', 26)}${pad('PM', 6)}${pad('Speclog', 9)}result`);
  for (const r of attRows) console.log(`${pad(r[0], 28)}${pad(r[1], 26)}${pad(r[2], 6)}${pad(r[3], 9)}${r[4]}`);

  const extraKinds = {};
  for (const a of sp.attention) if (!SPECLOG_TO_PM[a.kind]) extraKinds[a.kind] = (extraKinds[a.kind] ?? 0) + 1;
  console.log(`\nSpeclog-only attention kinds (not compared): ${JSON.stringify(extraKinds)}`);

  // Ref-level detail, to explain count differences.
  const refSet = (list, kind, repo) => new Set(list.filter((a) => a.repo === repo && a.kind === kind).map((a) => a.ref));
  for (const d of diffs) {
    const m = /^attention (.+)$/.exec(d.metric);
    if (!m) continue;
    const pmRefs = refSet(pm.attention, m[1], d.repo);
    const spRefs = refSet(sp.attention, KINDS[m[1]], d.repo);
    d.onlyPm = [...pmRefs].filter((x) => !spRefs.has(x));
    d.onlySpeclog = [...spRefs].filter((x) => !pmRefs.has(x));
  }

  const unexplained = [];
  console.log('\nDifferences');
  if (diffs.length === 0) console.log('none');
  for (const d of diffs) {
    d.reason = EXPLAINED[`${d.repo}|${d.metric}`];
    if (!d.reason) unexplained.push(d);
    console.log(`- ${d.repo} / ${d.metric}: PM ${d.pm}, Speclog ${d.speclog} -> ${d.reason ? `explained: ${d.reason}` : 'UNEXPLAINED'}`);
    if (d.onlyPm?.length) console.log(`    only in PM: ${d.onlyPm.slice(0, 10).join(', ')}${d.onlyPm.length > 10 ? ' ...' : ''}`);
    if (d.onlySpeclog?.length) console.log(`    only in Speclog: ${d.onlySpeclog.slice(0, 10).join(', ')}${d.onlySpeclog.length > 10 ? ' ...' : ''}`);
  }
  console.log(`\n${unexplained.length === 0 ? 'EQUAL (all differences explained)' : `${unexplained.length} UNEXPLAINED difference(s)`}`);
  process.exit(unexplained.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
