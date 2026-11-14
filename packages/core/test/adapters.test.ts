import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  ADAPTERS, backlogMdAdapter, docsTasksAdapter, normalizeId, specKitAdapter,
} from '../src/adapters';
import type { SourceFile, TaskSourceAdapter } from '../src/adapters';
import { parseDocsTasks } from '../src/adapters/docsTasksParser';
import type { Item, Program } from '../src/model';

const FIXTURES = join(__dirname, 'fixtures');

/** Reads a fixture tree as repo-relative files ("backlog/tasks/x.md"). */
function loadFixture(name: string): SourceFile[] {
  const root = join(FIXTURES, name);
  const out: SourceFile[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const abs = join(dir, entry);
      const relPath = rel === '' ? entry : `${rel}/${entry}`;
      if (statSync(abs).isDirectory()) walk(abs, relPath);
      else out.push({ path: relPath, text: readFileSync(abs, 'utf8') });
    }
  };
  walk(root, '');
  return out;
}

/** select() then parse(), as the snapshot builder will do. */
function run(adapter: TaskSourceAdapter, files: SourceFile[]) {
  const chosen = new Set(adapter.select(files.map((f) => f.path)));
  return adapter.parse(files.filter((f) => chosen.has(f.path)));
}

const allItems = (programs: Program[]): Item[] => programs.flatMap((p) => p.items);
const byId = (programs: Program[], id: string): Item | undefined =>
  allItems(programs).find((i) => i.id === id);

const backlogTask = (id: string, status: string, extra = '') =>
  `---\nid: ${id}\ntitle: Task ${id}\nstatus: ${status}\nassignee: []\n` +
  `created_date: '2026-11-01 10:00'\nlabels: []\ndependencies: []\n${extra}---\n\n## Description\n\nText.\n`;

describe('adapter registry', () => {
  it('lists docsTasks, backlogMd, specKit in order with their pathspecs', () => {
    expect(ADAPTERS.map((a) => a.format)).toEqual(['docsTasks', 'backlogMd', 'specKit']);
    expect(docsTasksAdapter.pathspecs).toEqual(['docs/tasks/']);
    expect(backlogMdAdapter.pathspecs).toContain('backlog/');
    expect(specKitAdapter.pathspecs).toEqual(['specs/']);
    expect(docsTasksAdapter.idsCaseInsensitive).toBe(false);
    expect(backlogMdAdapter.idsCaseInsensitive).toBe(true);
    expect(specKitAdapter.idsCaseInsensitive).toBe(false);
  });
});

describe('determinism', () => {
  it('parse results do not depend on the order of the files', () => {
    const docs: SourceFile[] = [
      { path: 'docs/tasks/b.md', text: '# B\n\n## B.1 One\nstatus: open\n' },
      { path: 'docs/tasks/a.md', text: '# A\n\n## A.1 One\n' },
    ];
    const backlog = [
      ...loadFixture('backlog-default'),
      { path: 'backlog/tasks/task-1 - Dup.md', text: backlogTask('TASK-1', 'Done') },
    ];
    const cases: [TaskSourceAdapter, SourceFile[]][] = [
      [docsTasksAdapter, docs], [backlogMdAdapter, backlog], [specKitAdapter, loadFixture('speckit')],
    ];
    for (const [adapter, files] of cases) {
      const forward = run(adapter, files);
      const reversed = run(adapter, [...files].reverse());
      expect(reversed).toEqual(forward);
      expect(forward.programs.map((p) => p.path)).toEqual([...forward.programs.map((p) => p.path)].sort());
    }
  });
});

describe('docsTasks adapter', () => {
  it('docsTasks adapter wraps parser', () => {
    const text = '# Demo\nprogram: BL1\n\n## BL1.1 First\nstatus: open\n\n## BL1.2 Second\nstatus: partial\n';
    const bad = '# Bad\n\n## BL2.1 No status\n';
    const files: SourceFile[] = [
      { path: 'docs/tasks/demo.md', text },
      { path: 'docs/tasks/bad.md', text: bad },
      { path: 'docs/tasks/notes.txt', text: 'x' },
      { path: 'docs/tasks/sub/deeper.md', text },
      { path: 'docs/other.md', text },
    ];
    expect(docsTasksAdapter.select(files.map((f) => f.path)).sort())
      .toEqual(['docs/tasks/bad.md', 'docs/tasks/demo.md']);
    const r = run(docsTasksAdapter, files);
    const direct = parseDocsTasks(text, 'docs/tasks/demo.md');
    expect(r.programs.find((p) => p.path === 'docs/tasks/demo.md')).toEqual(direct.program);
    expect(r.programs).toHaveLength(2);
    expect(r.issues.some((i) => i.path === 'docs/tasks/bad.md' && i.kind === 'missing-status')).toBe(true);
  });
});

describe('Backlog.md adapter', () => {
  const def = loadFixture('backlog-default');

  it('backlog default statuses map to open/partial/done', () => {
    const r = run(backlogMdAdapter, def);
    expect(r.issues).toEqual([]);
    expect(r.programs).toHaveLength(1);
    const p = r.programs[0];
    expect(p.format).toBe('backlogMd');
    expect(p.title).toBe('Backlog');
    expect(p.path).toBe('backlog/');

    const t1 = byId(r.programs, 'TASK-1')!;
    expect(t1.stored).toBe('open');
    expect(t1.fileDone).toBe(false);
    expect(t1.fileStatusText).toBe('To Do');
    const t2 = byId(r.programs, 'TASK-2')!;
    expect(t2.stored).toBe('partial');
    expect(t2.fileStatusText).toBe('In Progress');
    const t3 = byId(r.programs, 'TASK-3')!;
    expect(t3.stored).toBe('done');
    expect(t3.fileDone).toBe(true);
    expect(t3.fileStatusText).toBe('Done');
  });

  it('backlog fields map to title, area, depends, created, group and line', () => {
    const r = run(backlogMdAdapter, def);
    const t1 = byId(r.programs, 'TASK-1')!;
    expect(t1.title).toBe('Set up the project');
    expect(t1.area).toBe('setup');
    expect(t1.created).toBe('2026-10-20');
    expect(t1.group).toBe('First Release'); // milestone id m-1 resolved via backlog/milestones/
    expect(t1.priority).toBe('high');
    expect(t1.line).toBe(1);
    const t2 = byId(r.programs, 'TASK-2')!; // '@alice' reporter is accepted like Backlog.md does
    expect(t2.title).toBe('Add login form');
    expect(t2.area).toBe('frontend');
    expect(t2.depends).toEqual(['TASK-1']);
    expect(t2.created).toBe('2026-10-25');
    expect(t2.group).toBe('');
    const t3 = byId(r.programs, 'TASK-3')!;
    expect(t3.depends).toEqual(['TASK-1', 'TASK-2']);
    expect(t3.created).toBe('2026-10-27'); // unquoted date stays a date string
    expect(t3.group).toBe('Release 1');    // milestone without a file stays as written
    expect(t3.area).toBe('');
  });

  it('backlog custom statuses from config.yml', () => {
    const r = run(backlogMdAdapter, loadFixture('backlog-custom'));
    expect(r.issues).toEqual([]);
    const st = ['TASK-1', 'TASK-2', 'TASK-3', 'TASK-4'].map((id) => byId(r.programs, id)!);
    expect(st.map((i) => i.stored)).toEqual(['open', 'partial', 'partial', 'done']);
    expect(st.map((i) => i.fileDone)).toEqual([false, false, false, true]);
    expect(st.map((i) => i.fileStatusText)).toEqual(['Backlog', 'Doing', 'Review', 'Shipped']);
  });

  it('backlog root backlog.config.yml with a project name wins over backlog/config.yml', () => {
    const files: SourceFile[] = [
      { path: 'backlog.config.yml', text: 'project_name: "Demo"\nstatuses: ["Todo", "Doing", "Finished"]\n' },
      { path: 'backlog/config.yml', text: 'project_name: "Demo"\nstatuses: ["To Do", "Finished", "Done"]\n' },
      { path: 'backlog/tasks/task-1 - A.md', text: backlogTask('TASK-1', 'Finished') },
    ];
    const r = run(backlogMdAdapter, files);
    expect(r.issues).toEqual([]);
    expect(byId(r.programs, 'TASK-1')!.fileDone).toBe(true);
  });

  it('backlog root config without a project name is ignored, as Backlog.md does', () => {
    const files: SourceFile[] = [
      { path: 'backlog.config.yml', text: 'statuses: ["Todo", "Doing", "Finished"]\n' },
      { path: 'backlog/tasks/task-1 - A.md', text: backlogTask('TASK-1', 'Finished') },
    ];
    const r = run(backlogMdAdapter, files);
    expect(byId(r.programs, 'TASK-1')!.stored).toBe('open'); // defaults: "Finished" is unknown
    expect(r.issues.map((i) => i.kind)).toEqual(['bad-status']);
  });

  it('backlog root config backlog_directory picks the folder; a custom folder is reported', () => {
    const both: SourceFile[] = [
      { path: 'backlog/config.yml', text: 'statuses: [A, B]\n' },
      { path: 'backlog/tasks/task-1 - A.md', text: backlogTask('TASK-1', 'A') },
      { path: '.backlog/tasks/task-2 - B.md', text: backlogTask('TASK-2', 'To Do') },
    ];
    // Without a root config Backlog.md reads one folder: backlog/ (it has a config).
    const plain = run(backlogMdAdapter, both);
    expect(plain.programs.map((p) => p.path)).toEqual(['backlog/']);
    expect(byId(plain.programs, 'TASK-2')).toBeUndefined();

    const hidden = run(backlogMdAdapter, [
      { path: 'backlog.config.yml', text: 'project_name: Demo\nbacklog_directory: .backlog\n' }, ...both,
    ]);
    expect(hidden.programs.map((p) => p.path)).toEqual(['.backlog/']);
    expect(byId(hidden.programs, 'TASK-2')!.stored).toBe('open');

    const custom = run(backlogMdAdapter, [
      { path: 'backlog.config.yml', text: 'project_name: Demo\nbacklog_directory: planning/backlog\n' }, ...both,
    ]);
    expect(custom.programs).toEqual([]);
    expect(custom.issues).toEqual([
      { path: 'backlog.config.yml', line: 1, kind: 'unsupported', detail: expect.stringContaining('planning/backlog') },
    ]);
  });

  it('backlog root config: a trailing # comment on an unquoted value is not part of it', () => {
    const files: SourceFile[] = [
      { path: 'backlog.config.yml', text: 'project_name: Demo  # the demo\nbacklog_directory: backlog  # main\n' },
      { path: 'backlog/tasks/task-1 - A.md', text: backlogTask('TASK-1', 'To Do') },
    ];
    const r = run(backlogMdAdapter, files);
    expect(r.issues).toEqual([]);
    expect(r.programs.map((p) => p.path)).toEqual(['backlog/']);
    // Quoted: "#" is part of the value.
    const q = run(backlogMdAdapter, [
      { path: 'backlog.config.yml', text: 'project_name: "Demo"\nbacklog_directory: "backlog # x"\n' }, files[1],
    ]);
    expect(q.programs).toEqual([]);
    expect(q.issues[0].detail).toContain('"backlog # x"');
  });

  it('backlog alias-bomb front matter → one syntax issue, other tasks still read', () => {
    const bomb =
      '---\nid: TASK-50\ntitle: Bomb\nstatus: To Do\n' +
      'a: &a ["x", "x", "x", "x", "x", "x", "x", "x", "x"]\n' +
      'b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a]\n' +
      'c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b]\n' +
      'd: &d [*c, *c, *c, *c, *c, *c, *c, *c, *c]\n' +
      'e: &e [*d, *d, *d, *d, *d, *d, *d, *d, *d]\n' +
      'f: [*e, *e, *e, *e, *e, *e, *e, *e, *e]\n---\n';
    const oneAlias = '---\nid: TASK-51\ntitle: &t Alias\nstatus: To Do\nnote: *t\n---\n';
    const r = run(backlogMdAdapter, [
      ...def,
      { path: 'backlog/tasks/task-50 - Bomb.md', text: bomb },
      { path: 'backlog/tasks/task-51 - Alias.md', text: oneAlias },
    ]);
    expect(r.issues.map((i) => [i.path, i.kind])).toEqual([
      ['backlog/tasks/task-50 - Bomb.md', 'syntax'],
      ['backlog/tasks/task-51 - Alias.md', 'syntax'],
    ]);
    expect(byId(r.programs, 'TASK-50')).toBeUndefined();
    expect(allItems(r.programs)).toHaveLength(6);

    const cfg = run(backlogMdAdapter, [
      { path: 'backlog/config.yml', text: 'x: &x [a, b]\ny: *x\nstatuses: [A, B]\n' },
      { path: 'backlog/tasks/task-1 - A.md', text: backlogTask('TASK-1', 'B') },
    ]);
    expect(byId(cfg.programs, 'TASK-1')!.fileDone).toBe(true); // statuses entry recovered on its own
  });

  it('backlog same id in two files → duplicate-id on the later path, later file dropped', () => {
    const files: SourceFile[] = [
      { path: 'backlog/tasks/task-1 - B copy.md', text: backlogTask('task-1', 'Done') },
      { path: 'backlog/tasks/task-1 - A.md', text: backlogTask('TASK-1', 'To Do') },
    ];
    const r = run(backlogMdAdapter, files);
    expect(allItems(r.programs).map((i) => [i.id, i.stored])).toEqual([['TASK-1', 'open']]);
    expect(r.issues).toEqual([
      { path: 'backlog/tasks/task-1 - B copy.md', line: 1, kind: 'duplicate-id', detail: expect.stringContaining('task-1 - A.md') },
    ]);
  });

  it('backlog id with a slash is a syntax issue', () => {
    const r = run(backlogMdAdapter, [{ path: 'backlog/tasks/task-1 - A.md', text: backlogTask('TASK/1', 'To Do') }]);
    expect(allItems(r.programs)).toEqual([]);
    expect(r.issues.map((i) => i.kind)).toEqual(['syntax']);
  });

  it('backlog empty or missing status → missing-status', () => {
    const r = run(backlogMdAdapter, [
      { path: 'backlog/tasks/task-1 - A.md', text: backlogTask('TASK-1', '') },
      { path: 'backlog/tasks/task-2 - B.md', text: '---\nid: TASK-2\ntitle: B\n---\n' },
    ]);
    expect(allItems(r.programs).map((i) => i.stored)).toEqual(['open', 'open']);
    expect(r.issues.map((i) => [i.path, i.line, i.kind])).toEqual([
      ['backlog/tasks/task-1 - A.md', 1, 'missing-status'],
      ['backlog/tasks/task-2 - B.md', 1, 'missing-status'],
    ]);
  });

  it('backlog missing config uses defaults', () => {
    const r = run(backlogMdAdapter, def.filter((f) => f.path !== 'backlog/config.yml'));
    expect(r.issues).toEqual([]);
    expect(byId(r.programs, 'TASK-1')!.stored).toBe('open');
    expect(byId(r.programs, 'TASK-2')!.stored).toBe('partial');
    expect(byId(r.programs, 'TASK-3')!.fileDone).toBe(true);
  });

  it('backlog completed folder is done', () => {
    const files: SourceFile[] = [
      ...def,
      { path: 'backlog/completed/task-5 - Odd.md', text: backlogTask('TASK-5', 'In Progress') },
    ];
    const r = run(backlogMdAdapter, files);
    const t0 = byId(r.programs, 'task-0')!;
    expect(t0.stored).toBe('done');
    expect(t0.fileDone).toBe(true);
    expect(t0.title).toBe('Initial commit');
    expect(t0.group).toBe('First Release');
    const t5 = byId(r.programs, 'TASK-5')!;
    expect(t5.stored).toBe('done');
    expect(t5.fileDone).toBe(true);
    expect(t5.fileStatusText).toBe('In Progress');
    expect(r.issues).toEqual([]);
  });

  it('backlog drafts skipped', () => {
    const paths = def.map((f) => f.path);
    const chosen = backlogMdAdapter.select(paths);
    expect(chosen.some((p) => p.includes('/drafts/'))).toBe(false);
    expect(chosen.some((p) => p.includes('/archive/'))).toBe(false);
    const r = run(backlogMdAdapter, def);
    expect(byId(r.programs, 'DRAFT-1')).toBeUndefined();
    expect(byId(r.programs, 'TASK-9')).toBeUndefined(); // archive/tasks
    expect(allItems(r.programs).map((i) => i.id).sort())
      .toEqual(['TASK-1', 'TASK-12.1', 'TASK-2', 'TASK-3', 'task-0', 'task-12']);
  });

  it('backlog ids are case-insensitive (`TASK-12` matches `task-12`)', () => {
    const r = run(backlogMdAdapter, def);
    const parent = byId(r.programs, 'task-12')!;
    expect(parent).toBeDefined();
    expect(backlogMdAdapter.idsCaseInsensitive).toBe(true);
    expect(normalizeId('backlogMd', 'TASK-12')).toBe(normalizeId('backlogMd', parent.id));
    expect(normalizeId('backlogMd', 'Task-12.1')).toBe(normalizeId('backlogMd', 'TASK-12.1'));
    expect(normalizeId('specKit', 'f/T001')).not.toBe(normalizeId('specKit', 'f/t001'));
    expect(normalizeId('docsTasks', 'BL1.1')).not.toBe(normalizeId('docsTasks', 'bl1.1'));
  });

  it('backlog subtask task-12.1 is its own item', () => {
    const r = run(backlogMdAdapter, def);
    const parent = byId(r.programs, 'task-12')!;
    const sub = byId(r.programs, 'TASK-12.1')!;
    expect(parent.title).toBe('Payment flow');
    expect(sub.title).toBe('Card validation');
    expect(sub.stored).toBe('open');
    expect(parent.stored).toBe('partial');
    expect(normalizeId('backlogMd', sub.id)).not.toBe(normalizeId('backlogMd', parent.id));
  });

  it('unparseable YAML front matter → syntax issue, other tasks still read', () => {
    const broken = '---\nid: TASK-7\ntitle: [unclosed\nstatus: To Do\n---\n\nBody\n';
    const noFront = '# Just markdown\n';
    const files: SourceFile[] = [
      ...def,
      { path: 'backlog/tasks/task-7 - Broken.md', text: broken },
      { path: 'backlog/tasks/task-8 - No-front-matter.md', text: noFront },
    ];
    const r = run(backlogMdAdapter, files);
    const syn = r.issues.filter((i) => i.kind === 'syntax');
    expect(syn.map((i) => i.path).sort())
      .toEqual(['backlog/tasks/task-7 - Broken.md', 'backlog/tasks/task-8 - No-front-matter.md']);
    expect(syn.every((i) => i.line >= 1)).toBe(true);
    expect(byId(r.programs, 'TASK-7')).toBeUndefined();
    expect(allItems(r.programs)).toHaveLength(6);
  });

  it('backlog status not in config → open + bad-status issue on line 1', () => {
    const files: SourceFile[] = [
      { path: 'backlog/config.yml', text: 'statuses: ["To Do", "In Progress", "Done"]\n' },
      { path: 'backlog/tasks/task-1 - A.md', text: backlogTask('TASK-1', 'Blocked') },
      { path: 'backlog/tasks/task-2 - B.md', text: backlogTask('TASK-2', 'done') },
    ];
    const r = run(backlogMdAdapter, files);
    const t1 = byId(r.programs, 'TASK-1')!;
    expect(t1.stored).toBe('open');
    expect(t1.fileDone).toBe(false);
    expect(t1.fileStatusText).toBe('Blocked');
    expect(r.issues).toEqual([
      { path: 'backlog/tasks/task-1 - A.md', line: 1, kind: 'bad-status', detail: expect.stringContaining('Blocked') },
    ]);
    expect(byId(r.programs, 'TASK-2')!.fileDone).toBe(true); // status names match case-insensitively
  });

  it('backlog id missing → taken from the file name, syntax issue when neither exists', () => {
    const noId = (title: string) => `---\ntitle: ${title}\nstatus: To Do\n---\n`;
    const files: SourceFile[] = [
      { path: 'backlog/tasks/task-12 - Title.md', text: noId('Twelve') },
      { path: 'backlog/tasks/back-3.1 - Sub.md', text: noId('Prefixed subtask') },
      { path: 'backlog/tasks/notes.md', text: noId('Loose') },
    ];
    const r = run(backlogMdAdapter, files);
    expect(byId(r.programs, 'task-12')!.title).toBe('Twelve');
    expect(byId(r.programs, 'back-3.1')!.title).toBe('Prefixed subtask');
    expect(allItems(r.programs)).toHaveLength(2);
    expect(r.issues).toEqual([
      { path: 'backlog/tasks/notes.md', line: 1, kind: 'syntax', detail: expect.any(String) },
    ]);
  });

  it('backlog reads CRLF files and the hidden .backlog/ folder', () => {
    const crlf = (s: string) => s.replace(/\n/g, '\r\n');
    const files: SourceFile[] = [
      { path: '.backlog/config.yml', text: crlf('statuses:\n  - Open\n  - Closed\n') },
      { path: '.backlog/tasks/task-1 - A.md', text: crlf(backlogTask('TASK-1', 'Closed')) },
    ];
    const r = run(backlogMdAdapter, files);
    expect(r.issues).toEqual([]);
    expect(r.programs[0].path).toBe('.backlog/');
    expect(byId(r.programs, 'TASK-1')!.fileDone).toBe(true);
  });

  it('backlog config that is not YAML keeps a readable statuses entry, else reports it', () => {
    const task = { path: 'backlog/tasks/task-1 - A.md', text: backlogTask('TASK-1', 'Shipped') };
    const salvaged = run(backlogMdAdapter, [
      { path: 'backlog/config.yml', text: 'default_assignee: @me\nstatuses: [Open, Shipped]\n' }, task,
    ]);
    expect(salvaged.issues).toEqual([]);
    expect(byId(salvaged.programs, 'TASK-1')!.fileDone).toBe(true);
    const broken = run(backlogMdAdapter, [{ path: 'backlog/config.yml', text: 'statuses: [Open, Shipped\n' }, task]);
    expect(broken.issues.map((i) => [i.path, i.kind])).toEqual([
      ['backlog/config.yml', 'syntax'], ['backlog/tasks/task-1 - A.md', 'bad-status'],
    ]);
    expect(broken.issues[0].detail).not.toMatch(/at line/);
  });

  it('no backlog task files → no program', () => {
    const r = run(backlogMdAdapter, [{ path: 'backlog/config.yml', text: 'statuses: [A, B]\n' }]);
    expect(r.programs).toEqual([]);
  });
});

describe('Spec Kit adapter', () => {
  const sk = loadFixture('speckit');

  it('selects only specs/<feature>/tasks.md and spec.md', () => {
    const paths = [
      ...sk.map((f) => f.path),
      'specs/001-photo-albums/plan.md',
      'specs/001-photo-albums/contracts/api.md',
      'specs/tasks.md',
      'docs/specs/004-x/tasks.md',
    ];
    expect(specKitAdapter.select(paths).sort()).toEqual([
      'specs/001-photo-albums/spec.md',
      'specs/001-photo-albums/tasks.md',
      'specs/002-user-auth/tasks.md',
      'specs/003-empty/tasks.md',
    ]);
  });

  it('speckit phases become groups and ids are feature-qualified', () => {
    const r = run(specKitAdapter, sk);
    expect(r.issues).toEqual([]);
    const p = r.programs.find((x) => x.id === '001-photo-albums')!;
    expect(p.format).toBe('specKit');
    expect(p.path).toBe('specs/001-photo-albums/tasks.md');
    expect(p.title).toBe('Photo Albums');
    expect(p.spec).toBe('specs/001-photo-albums/spec.md');
    expect(p.items.map((i) => i.id)).toEqual([
      '001-photo-albums/T001', '001-photo-albums/T002', '001-photo-albums/T003',
      '001-photo-albums/T004', '001-photo-albums/T005',
      '001-photo-albums/T010', '001-photo-albums/T012', '001-photo-albums/T014',
    ]);
    const g = (id: string) => p.items.find((i) => i.id === `001-photo-albums/${id}`)!.group;
    expect(g('T001')).toBe('Phase 1: Setup (Shared Infrastructure)');
    expect(g('T004')).toBe('Phase 2: Foundational (Blocking Prerequisites)');
    expect(g('T012')).toBe('Phase 3: User Story 1 - Create an album (Priority: P1) 🎯 MVP');
    const t14 = p.items.find((i) => i.id === '001-photo-albums/T014')!;
    expect(t14.depends).toEqual(['001-photo-albums/T012', '001-photo-albums/T013']);
    expect(t14.spec).toBe('specs/001-photo-albums/spec.md');
    expect(p.items[0].line).toBe(21);
  });

  it('speckit program without spec.md uses the folder name', () => {
    const r = run(specKitAdapter, sk);
    const p = r.programs.find((x) => x.id === '002-user-auth')!;
    expect(p.title).toBe('002-user-auth');
    expect(p.spec).toBe('');
  });

  it('speckit [x] sets fileDone, markers go to note', () => {
    const r = run(specKitAdapter, sk);
    const t1 = byId(r.programs, '001-photo-albums/T001')!;
    expect(t1.fileDone).toBe(true);
    expect(t1.stored).toBe('done');
    expect(t1.fileStatusText).toBe('[X]');
    expect(t1.title).toBe('Create project structure per implementation plan');
    const t2 = byId(r.programs, '001-photo-albums/T002')!;
    expect(t2.fileDone).toBe(true);
    expect(t2.fileStatusText).toBe('[x]');
    const t3 = byId(r.programs, '001-photo-albums/T003')!;
    expect(t3.fileDone).toBe(false);
    expect(t3.stored).toBe('open');
    expect(t3.fileStatusText).toBe('[ ]');
    expect(t3.note).toBe('[P]');
    expect(t3.title).toBe('Configure linting and formatting tools');
    const t10 = byId(r.programs, '001-photo-albums/T010')!;
    expect(t10.note).toBe('[P] [US1]');
    expect(t10.title).toBe('Contract test for POST /albums in tests/contract/test_albums.py');
  });

  it('speckit duplicate T001 across features is fine', () => {
    const r = run(specKitAdapter, sk);
    expect(r.issues).toEqual([]);
    expect(byId(r.programs, '001-photo-albums/T001')).toBeDefined();
    const other = byId(r.programs, '002-user-auth/T001')!;
    expect(other.title).toBe('Create auth module skeleton in src/auth/');
    expect(byId(r.programs, '002-user-auth/T002')!.note).toBe('[P]');
  });

  it('speckit checkboxes without a T-id and code fences are skipped; empty tasks.md is a program', () => {
    const r = run(specKitAdapter, sk);
    expect(allItems(r.programs).some((i) => i.title.includes('Review the album copy'))).toBe(false);
    expect(byId(r.programs, '001-photo-albums/T099')).toBeUndefined();
    const empty = r.programs.find((x) => x.id === '003-empty')!;
    expect(empty.items).toEqual([]);
    expect(r.programs).toHaveLength(3);
  });

  it('speckit feature folder that is not a valid id prefix → syntax issue', () => {
    const r = run(specKitAdapter, [{ path: 'specs/my feature/tasks.md', text: '- [ ] T001 Do it\n' }]);
    expect(r.programs).toEqual([]);
    expect(r.issues).toEqual([
      { path: 'specs/my feature/tasks.md', line: 1, kind: 'syntax', detail: expect.any(String) },
    ]);
  });

  it('speckit same T-id twice in one tasks.md → duplicate-id on the second, second dropped', () => {
    const text = '## Phase 1\n\n- [ ] T001 First\n- [x] T001 Again\n- [ ] T002 Next\n';
    const r = run(specKitAdapter, [{ path: 'specs/001-a/tasks.md', text }]);
    expect(allItems(r.programs).map((i) => [i.id, i.title])).toEqual([
      ['001-a/T001', 'First'], ['001-a/T002', 'Next'],
    ]);
    expect(r.issues).toEqual([
      { path: 'specs/001-a/tasks.md', line: 4, kind: 'duplicate-id', detail: expect.stringContaining('line 3') },
    ]);
  });

  it('speckit reads CRLF files', () => {
    const files = sk.map((f) => ({ path: f.path, text: f.text.replace(/\n/g, '\r\n') }));
    const r = run(specKitAdapter, files);
    expect(byId(r.programs, '001-photo-albums/T003')!.title).toBe('Configure linting and formatting tools');
    expect(r.programs.find((x) => x.id === '001-photo-albums')!.title).toBe('Photo Albums');
  });
});
