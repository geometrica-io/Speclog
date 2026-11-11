import { parseDocument } from 'yaml';
import type { Item, ParseIssue, Program } from '../model';
import { isValidDate } from '../text';
import type { SourceFile, TaskSourceAdapter } from './types';

/**
 * Backlog.md adapter (spec §4.3). Format checked against Backlog.md v1.55.3:
 * `<dir>/tasks/*.md` and `<dir>/completed/*.md` are read; `drafts/` and `archive/` are skipped.
 * `<dir>` is `backlog` or the hidden `.backlog`. Statuses come from the root `backlog.config.yml`,
 * else `<dir>/config.yml`, else `<dir>/config.yaml`, else the Backlog.md defaults.
 */

export const DEFAULT_BACKLOG_STATUSES: readonly string[] = ['To Do', 'In Progress', 'Done'];

const DIRS = ['backlog', '.backlog'];
const ROOT_CONFIG = 'backlog.config.yml';
const ID_RE = /^[A-Za-z0-9._/-]+$/;
/** File name `task-12 - Title.md` / `back-3.1 - Title.md` → id prefix. */
const FILE_ID_RE = /^([A-Za-z][A-Za-z0-9_]*-\d+(?:\.\d+)*)(?: - (.*))?\.md$/;

type Kind = 'task' | 'completed' | 'milestone' | 'config';

interface Classified { dir: string; kind: Kind; name: string; }

function classify(path: string): Classified | null {
  for (const dir of DIRS) {
    if (!path.startsWith(dir + '/')) continue;
    const rest = path.slice(dir.length + 1);
    if (rest === 'config.yml' || rest === 'config.yaml') return { dir, kind: 'config', name: rest };
    const m = /^(tasks|completed|milestones)\/([^/]+\.md)$/.exec(rest);
    if (!m || m[2].toLowerCase() === 'readme.md') return null;
    const kind: Kind = m[1] === 'tasks' ? 'task' : m[1] === 'completed' ? 'completed' : 'milestone';
    return { dir, kind, name: m[2] };
  }
  return null;
}

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(str).filter((s) => s !== '');
  const s = str(v);
  return s === '' ? [] : s.split(',').map((x) => x.trim()).filter((x) => x !== '');
}

/** Date part of a Backlog.md date ("2026-10-25", "2026-10-25 19:12", ISO, legacy dd-mm-yy). */
function datePart(v: unknown): string {
  const s = str(v).replace(/^['"]|['"]$/g, '');
  let m = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(s);
  if (m) return isValidDate(m[1]) ? m[1] : '';
  m = /^(\d{2})[-/.](\d{2})[-/.](\d{2})$/.exec(s);
  if (m) {
    const ymd = `20${m[3]}-${m[2]}-${m[1]}`;
    return isValidDate(ymd) ? ymd : '';
  }
  return '';
}

/**
 * Backlog.md writes `assignee: @name` / `reporter: @name` unquoted, which is not valid YAML;
 * Backlog.md quotes those values before parsing, so the same is done here.
 */
function preprocess(lines: string[]): string[] {
  return lines.map((line) => {
    const m = /^(\s*(?:assignee|reporter):\s*)(.*)$/.exec(line);
    if (!m) return line;
    const value = m[2].trim();
    if (!value.includes('@') || value.startsWith("'") || value.startsWith('"') || value.startsWith('-')) return line;
    return m[1] + JSON.stringify(value);
  });
}

type FrontMatter = { ok: true; data: Record<string, unknown> } | { ok: false; line: number; detail: string };

function readFrontMatter(text: string): FrontMatter {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/);
  if (lines[0].trimEnd() !== '---') return { ok: false, line: 1, detail: 'no YAML front matter' };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === '---') { end = i; break; }
  }
  if (end === -1) return { ok: false, line: 1, detail: 'YAML front matter is not closed' };
  const doc = parseDocument(preprocess(lines.slice(1, end)).join('\n'));
  if (doc.errors.length > 0) {
    const e = doc.errors[0];
    const at = e.linePos ? e.linePos[0].line + 1 : 1; // +1 for the opening ---
    return { ok: false, line: at, detail: `invalid YAML front matter: ${yamlMessage(e.message)}` };
  }
  const data: unknown = doc.toJS();
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, line: 1, detail: 'YAML front matter is not a mapping' };
  }
  return { ok: true, data: data as Record<string, unknown> };
}

/** First line of a yaml error, without its position (that counts from the front matter, not the file). */
function yamlMessage(message: string): string {
  return message.split('\n')[0].replace(/ at line \d+, column \d+:?$/, '');
}

function statusList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const list = v.map(str).filter((s) => s !== '');
  return list.length > 0 ? list : null;
}

/**
 * Reads `statuses` from a config file. Backlog.md reads its config line by line, so a config that
 * is not valid YAML as a whole still works there; when full parsing fails, the `statuses` entry
 * alone is parsed. Returns null (use defaults) when there is none; reports an issue only when
 * the file is unreadable and no `statuses` entry could be recovered.
 */
function readStatuses(file: SourceFile, issues: ParseIssue[]): string[] | null {
  const doc = parseDocument(file.text);
  if (doc.errors.length === 0) {
    const data: unknown = doc.toJS();
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return statusList((data as Record<string, unknown>).statuses);
    }
    return null;
  }
  const lines = file.text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^statuses\s*:/.test(l));
  if (start !== -1) {
    let end = start + 1;
    while (end < lines.length && /^(\s+\S|\s*$)/.test(lines[end])) end++;
    const part = parseDocument(lines.slice(start, end).join('\n'));
    if (part.errors.length === 0) {
      const data = part.toJS() as Record<string, unknown> | null;
      const list = data ? statusList(data.statuses) : null;
      if (list) return list;
    }
  }
  const e = doc.errors[0];
  issues.push({
    path: file.path, line: e.linePos ? e.linePos[0].line : 1, kind: 'syntax',
    detail: `invalid YAML, default statuses used: ${yamlMessage(e.message)}`,
  });
  return null;
}

function newItem(): Item {
  return {
    id: '', title: '', group: '', stored: 'open', fileDone: false, fileStatusText: '',
    size: '', priority: '', area: '', created: '', note: '', spec: '', evidence: '',
    historyDate: '', historyCommit: '', depends: [], line: 1,
  };
}

function parseDir(dir: string, files: SourceFile[], rootConfig: SourceFile | undefined, issues: ParseIssue[]): Program | null {
  const kinds = files.map((f) => ({ f, c: classify(f.path)! }));
  const tasks = kinds.filter((k) => k.c.kind === 'task' || k.c.kind === 'completed');
  if (tasks.length === 0) return null;

  const config = rootConfig
    ?? kinds.find((k) => k.c.kind === 'config' && k.c.name === 'config.yml')?.f
    ?? kinds.find((k) => k.c.kind === 'config' && k.c.name === 'config.yaml')?.f;
  const statuses = (config && readStatuses(config, issues)) || [...DEFAULT_BACKLOG_STATUSES];

  const milestones = new Map<string, string>();
  for (const k of kinds) {
    if (k.c.kind !== 'milestone') continue;
    const fm = readFrontMatter(k.f.text);
    if (!fm.ok) continue;
    const id = str(fm.data.id);
    const title = str(fm.data.title);
    if (id !== '' && title !== '') milestones.set(id.toLowerCase(), title);
  }

  const program: Program = {
    path: `${dir}/`, format: 'backlogMd', title: 'Backlog', id: '', area: '', created: '', spec: '', items: [],
  };
  for (const { f, c } of tasks) {
    const issue = (line: number, kind: string, detail: string) => issues.push({ path: f.path, line, kind, detail });
    const fm = readFrontMatter(f.text);
    if (!fm.ok) { issue(fm.line, 'syntax', fm.detail); continue; }
    const d = fm.data;
    const nameMatch = FILE_ID_RE.exec(c.name);

    const it = newItem();
    it.id = str(d.id) || (nameMatch ? nameMatch[1] : '');
    if (it.id === '') { issue(1, 'syntax', 'no id in the front matter or the file name'); continue; }
    if (!ID_RE.test(it.id)) { issue(1, 'syntax', `invalid id "${it.id}"`); continue; }
    it.title = str(d.title) || (nameMatch?.[2] ?? '').trim() || it.id;

    const status = str(d.status);
    it.fileStatusText = status;
    if (c.kind === 'completed') {
      it.stored = 'done';
      it.fileDone = true;
    } else {
      let idx = statuses.indexOf(status);
      if (idx === -1) idx = statuses.findIndex((s) => s.toLowerCase() === status.toLowerCase());
      if (idx === -1) {
        issue(1, 'bad-status', `status "${status}" is not one of: ${statuses.join(', ')}`);
      } else if (idx === statuses.length - 1 && statuses.length > 1) {
        it.stored = 'done';
        it.fileDone = true;
      } else if (idx > 0) {
        it.stored = 'partial';
      }
    }

    it.area = strList(d.labels)[0] ?? '';
    it.depends = strList(d.dependencies);
    it.created = datePart(d.created_date);
    it.priority = str(d.priority);
    const milestone = str(d.milestone);
    it.group = milestones.get(milestone.toLowerCase()) ?? milestone;
    program.items.push(it);
  }
  return program;
}

export const backlogMdAdapter: TaskSourceAdapter = {
  format: 'backlogMd',
  pathspecs: ['backlog/', '.backlog/', ROOT_CONFIG],
  idsCaseInsensitive: true,
  select(paths: string[]): string[] {
    return paths.filter((p) => p === ROOT_CONFIG || classify(p) !== null);
  },
  parse(files: SourceFile[]) {
    const issues: ParseIssue[] = [];
    const programs: Program[] = [];
    const rootConfig = files.find((f) => f.path === ROOT_CONFIG);
    for (const dir of DIRS) {
      const own = files.filter((f) => classify(f.path)?.dir === dir);
      const p = parseDir(dir, own, rootConfig, issues);
      if (p) programs.push(p);
    }
    return { programs, issues };
  },
};
