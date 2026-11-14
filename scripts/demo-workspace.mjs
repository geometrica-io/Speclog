#!/usr/bin/env node
// Generates a demo workspace of fictional git repositories for screenshots and demos.
// Nothing here refers to a real project: repository names, task IDs, titles, authors and dates are
// all made up. Each repository uses one of the formats Speclog reads (docs/tasks, Backlog.md,
// Spec Kit) and has a git history with `Task:` lines, an unmerged branch and a few loose ends, so
// the board shows every status.
//
// Usage: node scripts/demo-workspace.mjs [--out <dir>] [--force]
//   --out    target folder (default: <os temp>/speclog-demo)
//   --force  replace a folder that this script created before (it carries a .speclog-demo marker)
// Then open <out>/speclog-demo.code-workspace in VS Code. Its workspace settings point
// speclog.roots at the demo folder only, so no other repository on the machine appears.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MARKER = '.speclog-demo';
const AUTHOR = { name: 'Demo Developer', email: 'demo@example.invalid' };
const DAY = 86400;

function parseArgs(argv) {
  const opts = { out: path.join(os.tmpdir(), 'speclog-demo'), force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') opts.out = path.resolve(argv[++i] ?? '');
    else if (argv[i] === '--force') opts.force = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return opts;
}

function prepareOut(out, force) {
  if (fs.existsSync(out) && fs.readdirSync(out).length > 0) {
    if (!fs.existsSync(path.join(out, MARKER))) {
      throw new Error(`${out} exists and was not created by this script; choose another --out.`);
    }
    if (!force) throw new Error(`${out} already holds a demo workspace; pass --force to replace it.`);
    fs.rmSync(out, { recursive: true, force: true });
  }
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, MARKER), 'Created by Speclog scripts/demo-workspace.mjs\n');
}

/** A tiny git driver for one repository; every commit gets the demo author and a fixed date. */
function repo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const nowSec = Math.floor(Date.now() / 1000);
  const git = (args, daysAgo = 0) => {
    const when = `${nowSec - Math.round(daysAgo * DAY)} +0000`;
    return execFileSync('git', ['-c', 'core.hooksPath=.speclog-demo-no-hooks', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_AUTHOR_NAME: AUTHOR.name, GIT_AUTHOR_EMAIL: AUTHOR.email, GIT_AUTHOR_DATE: when,
        GIT_COMMITTER_NAME: AUTHOR.name, GIT_COMMITTER_EMAIL: AUTHOR.email, GIT_COMMITTER_DATE: when,
      },
    });
  };
  git(['init', '--quiet', '--initial-branch=main']);
  const write = (rel, text) => {
    const file = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text.replace(/\r\n/g, '\n'));
  };
  const commit = (daysAgo, message, files = {}) => {
    for (const [rel, text] of Object.entries(files)) write(rel, text);
    git(['add', '--all']);
    git(['commit', '--quiet', '--allow-empty', '-m', message], daysAgo);
  };
  return { git, write, commit };
}

// ------------------------------------------------------------------------------------------ docs/tasks

const orbitTasks = (doneNote = '') => `# Billing service
program: BIL
area: Backend/Billing
created: 2026-09-02

## BIL.1 Invoice data model
status: open
size: M

## BIL.2 Tax rules per region
status: partial
size: L
note: EU and UK done; US states pending.${doneNote}

## BIL.3 Rounding error on multi-currency totals
status: bug
size: S
priority: high

## BIL.4 Choose the PDF engine
status: decision
size: S
note: Headless browser or a native library.

## BIL.5 Retry failed card payments
status: open
size: M
depends: BIL.1

## BIL.6 Webhook signature check
status: open
size: S
`;

const orbitAuth = `# Accounts and sign-in
program: ACC
area: Backend/Accounts
created: 2026-08-20

## ACC.1 Password reset by email
status: open
size: S

## ACC.2 Passkey sign-in
status: open
size: L

## ACC.3 Session timeout setting
status: verify
size: S
note: Shipped behind a flag; confirm with support.

## ACC.4 Audit log export
status: open
size: M

## ACC.5 Legacy OAuth provider
status: dropped
note: Provider shut down.
`;

function orbitApi(out) {
  const r = repo(path.join(out, 'orbit-api'));
  r.commit(60, 'Set up the service skeleton', { 'README.md': '# orbit-api\n\nFictional demo service.\n', 'src/index.ts': 'export {};\n' });
  r.commit(58, 'Track work in docs/tasks', { 'docs/tasks/billing.md': orbitTasks(), 'docs/tasks/accounts.md': orbitAuth });
  r.commit(40, 'Add the invoice tables\n\nTask-Progress: BIL.1', { 'src/billing/invoice.ts': 'export interface Invoice { id: string }\n' });
  r.commit(33, 'Apply EU and UK tax rules\n\nTask-Progress: BIL.2', { 'src/billing/tax.ts': 'export const regions = ["EU", "UK"];\n' });
  r.commit(21, 'Send password reset links\n\nTask: ACC.1', { 'src/accounts/reset.ts': 'export function reset() {}\n' });
  r.commit(14, 'Verify webhook signatures\n\nTask: BIL.6', { 'src/billing/webhook.ts': 'export function verify() { return true; }\n' });
  r.commit(9, 'Export the audit log as CSV\n\nTask: ACC.4', { 'src/accounts/audit.ts': 'export function exportCsv() {}\n' });
  r.commit(3, 'Tidy the request logger', { 'src/log.ts': 'export const log = console.log;\n' });

  // Unmerged branch: passkeys closed there, not yet on main → "On branch".
  r.git(['switch', '--quiet', '-c', 'feature/passkeys']);
  r.commit(4, 'Sign in with passkeys\n\nTask: ACC.2', { 'src/accounts/passkey.ts': 'export function signIn() {}\n' });
  r.git(['switch', '--quiet', 'main']);

  // Branch that only adds a new item (branch-only item).
  r.git(['switch', '--quiet', '-c', 'feature/refunds']);
  r.commit(2, 'Plan partial refunds', {
    'docs/tasks/billing.md': `${orbitTasks()}\n## BIL.7 Partial refunds\nstatus: open\nsize: M\n`,
  });
  r.git(['switch', '--quiet', 'main']);
}

const harborTasks = `# Command line
program: CLI
area: Tools/CLI
created: 2026-10-01

## CLI.1 Config file discovery
status: open
size: S

## CLI.2 Shell completions
status: open
size: M

## CLI.3 Colour output on Windows terminals
status: bug
size: S

## CLI.4 Plugin API
status: decision
size: L
depends: CLI.1
`;

function harborCli(out) {
  const r = repo(path.join(out, 'harbor-cli'));
  r.commit(30, 'Start the CLI', { 'README.md': '# harbor-cli\n\nFictional demo CLI.\n', 'bin/harbor.js': '#!/usr/bin/env node\n' });
  r.commit(29, 'Track work in docs/tasks', { 'docs/tasks/cli.md': harborTasks });
  r.commit(12, 'Find the config file upwards from the working folder\n\nTask: CLI.1', { 'src/config.js': 'module.exports = {};\n' });
  r.commit(6, 'Generate bash and zsh completions\n\nTask-Progress: CLI.2', { 'src/completions.js': 'module.exports = {};\n' });
}

// ------------------------------------------------------------------------------------------ Backlog.md

const backlogConfig = `project_name: "Lumen Web"
default_status: "To Do"
statuses: ["To Do", "In Progress", "Done"]
labels: []
date_format: yyyy-mm-dd
task_prefix: "task"
auto_commit: false
`;

function backlogTask(id, title, status, { labels = [], deps = [], created = '2026-10-05' } = {}) {
  const list = (xs) => (xs.length ? `\n${xs.map((x) => `  - ${x}`).join('\n')}` : ' []');
  return `---
id: ${id}
title: ${title}
status: ${status}
assignee: []
created_date: '${created}'
labels:${list(labels)}
dependencies:${list(deps)}
---

## Description

${title}.
`;
}

function lumenWeb(out) {
  const r = repo(path.join(out, 'lumen-web'));
  const titles = {
    1: 'Landing page layout', 2: 'Dark theme', 3: 'Image lazy loading',
    4: 'Contact form validation', 5: 'Cookie banner', 6: 'Sitemap generation',
  };
  const file = (n) => `backlog/tasks/task-${n} - ${titles[n].replace(/ /g, '-')}.md`;
  const t = (n, status, extra) => [file(n), backlogTask(`task-${n}`, titles[n], status, extra)];
  const files = Object.fromEntries([
    t(1, 'To Do', { labels: ['ui'] }),
    t(2, 'In Progress', { labels: ['ui'] }),
    t(3, 'To Do', { labels: ['performance'] }),
    t(4, 'To Do'),
    t(5, 'To Do', { deps: ['task-4'] }),
    t(6, 'To Do'),
  ]);
  r.commit(45, 'Start the site', { 'README.md': '# lumen-web\n\nFictional demo website.\n', 'index.html': '<!doctype html>\n' });
  r.commit(44, 'Add the backlog', { 'backlog/config.yml': backlogConfig, ...files });
  // Done with evidence: file says Done and the commit carries Task:.
  r.commit(20, 'Validate the contact form\n\nTask: task-4', {
    'src/contact.js': 'export function validate() {}\n',
    ...Object.fromEntries([t(4, 'Done')]),
  });
  // Done in the file only, no Task: line → Unverified.
  r.commit(11, 'Update the backlog', Object.fromEntries([t(6, 'Done')]));
  r.commit(5, 'Lazy-load gallery images\n\nTask-Progress: task-3', { 'src/gallery.js': 'export const lazy = true;\n' });
}

// ------------------------------------------------------------------------------------------ Spec Kit

const specMd = (title, branch) => `# Feature Specification: ${title}

**Feature Branch**: \`${branch}\`

**Created**: 2026-10-12

**Status**: Draft
`;

const tasksMd = (title, lines) => `---

description: "Task list for ${title}"
---

# Tasks: ${title}

## Phase 1: Setup

${lines.join('\n')}
`;

function atlasMobile(out) {
  const r = repo(path.join(out, 'atlas-mobile'));
  const offline = (marks) => tasksMd('Offline Maps', [
    `- [${marks[0]}] T001 Create the tile cache module`,
    `- [${marks[1]}] T002 [P] Download tiles for a selected region`,
    `- [${marks[2]}] T003 Show cached regions in settings`,
    `- [${marks[3]}] T004 Expire tiles older than 30 days`,
  ]);
  const share = tasksMd('Trip Sharing', [
    '- [ ] T001 Share a trip link',
    '- [ ] T002 [P] Read-only trip view',
    '- [ ] T003 Revoke a shared link',
  ]);
  r.commit(50, 'Start the app', { 'README.md': '# atlas-mobile\n\nFictional demo app.\n', 'app/main.ts': 'export {};\n' });
  r.commit(48, 'Specify offline maps and trip sharing', {
    'specs/001-offline-maps/spec.md': specMd('Offline Maps', '001-offline-maps'),
    'specs/001-offline-maps/tasks.md': offline([' ', ' ', ' ', ' ']),
    'specs/002-trip-sharing/spec.md': specMd('Trip Sharing', '002-trip-sharing'),
    'specs/002-trip-sharing/tasks.md': share,
  });
  r.commit(25, 'Add the tile cache\n\nTask: 001-offline-maps/T001', {
    'app/tiles/cache.ts': 'export class TileCache {}\n',
    'specs/001-offline-maps/tasks.md': offline(['x', ' ', ' ', ' ']),
  });
  r.commit(16, 'Download tiles per region\n\nTask: 001-offline-maps/T002', {
    'app/tiles/download.ts': 'export function download() {}\n',
    'specs/001-offline-maps/tasks.md': offline(['x', 'x', ' ', ' ']),
  });
  // Ticked by hand without a Task: line → Unverified.
  r.commit(7, 'Update tasks', { 'specs/001-offline-maps/tasks.md': offline(['x', 'x', 'x', ' ']) });

  r.git(['switch', '--quiet', '-c', '002-trip-sharing']);
  r.commit(3, 'Share a trip link\n\nTask: 002-trip-sharing/T001', { 'app/share/link.ts': 'export function link() {}\n' });
  r.git(['switch', '--quiet', 'main']);
}

// ------------------------------------------------------------------------------------------ main

function writeWorkspace(out) {
  const ws = {
    folders: [{ path: '.' }],
    settings: { 'speclog.roots': [out], 'speclog.fetch.enabled': false },
  };
  const file = path.join(out, 'speclog-demo.code-workspace');
  fs.writeFileSync(file, `${JSON.stringify(ws, null, 2)}\n`);
  return file;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  prepareOut(opts.out, opts.force);
  orbitApi(opts.out);
  harborCli(opts.out);
  lumenWeb(opts.out);
  atlasMobile(opts.out);
  const ws = writeWorkspace(opts.out);
  console.log(`Demo workspace ready: ${ws}`);
  console.log(`Open it with: code "${ws}"`);
}

try {
  main();
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
