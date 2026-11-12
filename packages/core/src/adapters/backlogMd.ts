import { parseDocument } from 'yaml';
import type { Item, ParseIssue, Program } from '../model';
import { isValidDate } from '../text';
import type { SourceFile, TaskSourceAdapter } from './types';

/**
 * Backlog.md adapter (spec §4.3). Format checked against Backlog.md v1.55.3:
 * `<dir>/tasks/*.md` and `<dir>/completed/*.md` are read; `drafts/` and `archive/` are skipped.
 * `<dir>` is `backlog` or the hidden `.backlog`, one of them, picked as Backlog.md does. Statuses
 * come from the root `backlog.config.yml` when it names a project, else `<dir>/config.yml`, else
 * `<dir>/config.yaml`, else the Backlog.md defaults.
 */

export const DEFAULT_BACKLOG_STATUSES: readonly string[] = ['To Do', 'In Progress', 'Done'];

const DIRS = ['backlog', '.backlog'];
const ROOT_CONFIG = 'backlog.config.yml';
/** Backlog.md ids never contain `/` (only Spec Kit ids do). */
const ID_RE = /^[A-Za-z0-9._-]+$/;
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

type YamlResult = { ok: true; data: unknown } | { ok: false; line: number; detail: string };

/**
 * Parses YAML into plain data. Aliases are refused (`maxAliasCount: 0`): Backlog.md files never
 * need them, and an alias bomb would otherwise expand in `toJS`. Never throws.
 */
function loadYaml(text: string): YamlResult {
  try {
    const doc = parseDocument(text);
    if (doc.errors.length > 0) {
      const e = doc.errors[0];
      return { ok: false, line: e.linePos ? e.linePos[0].line : 1, detail: yamlMessage(e.message) };
    }
    return { ok: true, data: doc.toJS({ maxAliasCount: 0 }) };
  } catch (e) {
    return { ok: false, line: 1, detail: yamlMessage(e instanceof Error ? e.message : String(e)) };
  }
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
  const y = loadYaml(preprocess(lines.slice(1, end)).join('\n'));
  // +1 for the opening --- line.
  if (!y.ok) return { ok: false, line: y.line + 1, detail: `invalid YAML front matter: ${y.detail}` };
  if (!isMapping(y.data)) return { ok: false, line: 1, detail: 'YAML front matter is not a mapping' };
  return { ok: true, data: y.data };
}

function isMapping(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
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
  const whole = loadYaml(file.text);
  if (whole.ok) return isMapping(whole.data) ? statusList(whole.data.statuses) : null;
  const lines = file.text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^statuses\s*:/.test(l));
  if (start !== -1) {
    let end = start + 1;
    while (end < lines.length && /^(\s+\S|\s*$)/.test(lines[end])) end++;
    const part = loadYaml(lines.slice(start, end).join('\n'));
    const list = part.ok && isMapping(part.data) ? statusList(part.data.statuses) : null;
    if (list) return list;
  }
  issues.push({
    path: file.path, line: whole.line, kind: 'syntax',
    detail: `invalid YAML, default statuses used: ${whole.detail}`,
  });
  return null;
}

/**
 * Line-based read of `project_name` / `backlog_directory`, as Backlog.md's
 * `parseBacklogConfigMetadata` does: the root config only counts when it names a project.
 */
function rootConfigMeta(text: string): { projectName: string; backlogDirectory: string } {
  let projectName = '';
  let backlogDirectory = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim().replace(/^['"]|['"]$/g, '');
    if ((key === 'project_name' || key === 'projectName') && value) projectName = value;
    else if (key === 'backlog_directory' || key === 'backlogDirectory') {
      backlogDirectory = value.replace(/^\.\//, '').replace(/\/+$/, '');
    }
  }
  return { projectName, backlogDirectory };
}

function newItem(): Item {
  return {
    id: '', title: '', group: '', stored: 'open', fileDone: false, fileStatusText: '',
    size: '', priority: '', area: '', created: '', note: '', spec: '', evidence: '',
    historyDate: '', historyCommit: '', depends: [], line: 1,
  };
}

function parseDir(dir: string, files: SourceFile[], config: SourceFile | undefined, issues: ParseIssue[]): Program | null {
  const kinds = files.map((f) => ({ f, c: classify(f.path)! }));
  const tasks = kinds.filter((k) => k.c.kind === 'task' || k.c.kind === 'completed');
  if (tasks.length === 0) return null;

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
  const seen = new Map<string, string>(); // lower-case id -> path of the file that kept it
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
    const first = seen.get(it.id.toLowerCase());
    if (first !== undefined) { issue(1, 'duplicate-id', `${it.id} is already defined in ${first}`); continue; }
    seen.set(it.id.toLowerCase(), f.path);
    it.title = str(d.title) || (nameMatch?.[2] ?? '').trim() || it.id;

    const status = str(d.status);
    it.fileStatusText = status;
    if (c.kind === 'completed') {
      it.stored = 'done';
      it.fileDone = true;
    } else {
      let idx = statuses.indexOf(status);
      if (idx === -1) idx = statuses.findIndex((s) => s.toLowerCase() === status.toLowerCase());
      if (status === '') {
        issue(1, 'missing-status', it.id);
      } else if (idx === -1) {
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
  parse(input: SourceFile[]) {
    const files = [...input].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const issues: ParseIssue[] = [];
    const inDir = (dir: string) => files.filter((f) => classify(f.path)?.dir === dir);
    const folderConfig = (own: SourceFile[], dir: string) =>
      own.find((f) => f.path === `${dir}/config.yml`) ?? own.find((f) => f.path === `${dir}/config.yaml`);

    // Folder and config resolution as in Backlog.md's resolveBacklogDirectory(): a root
    // backlog.config.yml that names a project wins; otherwise backlog/ with a config, .backlog/
    // with a config, backlog/, .backlog/ - only one folder is read.
    let dir = '';
    let config: SourceFile | undefined;
    const root = files.find((f) => f.path === ROOT_CONFIG);
    const meta = root ? rootConfigMeta(root.text) : null;
    if (root && meta && meta.projectName !== '') {
      config = root;
      if (meta.backlogDirectory !== '' && !DIRS.includes(meta.backlogDirectory)) {
        issues.push({
          path: ROOT_CONFIG, line: 1, kind: 'unsupported',
          detail: `backlog_directory "${meta.backlogDirectory}" is not read; Speclog reads backlog/ and .backlog/`,
        });
        return { programs: [], issues };
      }
      dir = meta.backlogDirectory;
    }
    if (dir === '') {
      dir = DIRS.find((d) => folderConfig(inDir(d), d)) ?? DIRS.find((d) => inDir(d).length > 0) ?? '';
      if (dir === '') return { programs: [], issues };
    }
    const own = inDir(dir);
    const p = parseDir(dir, own, config ?? folderConfig(own, dir), issues);
    return { programs: p ? [p] : [], issues };
  },
};
