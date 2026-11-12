import type { Item, ParseIssue, Program } from '../model';
import { splitLines, trim } from '../text';
import { sortedByPath } from './files';
import type { SourceFile, TaskSourceAdapter } from './types';

/**
 * GitHub Spec Kit adapter (spec §4.3). Format checked against spec-kit v1.4.0
 * (`templates/tasks-template.md`, `templates/commands/tasks.md`): each `specs/<feature>/tasks.md`
 * is a program; `## ` headings are groups; `- [ ] T001 [P] [US1] Description` lines are items
 * (`[x]` or `[X]` = done in the file). Checkboxes without a `T<digits>` id are skipped.
 */

const FILE_RE = /^specs\/([^/]+)\/(tasks|spec)\.md$/;
const TASK_RE = /^\s*[-*]\s+\[([ xX])\]\s+(T\d+)(?=\s|$)(.*)$/;
const MARKER_RE = /^\[(P|US\d+)\]\s*/;
const DEPENDS_RE = /\(depends on\s+(T\d+(?:\s*(?:,|and)\s*T\d+)*)\s*\)/i;
/** Spec Kit's spec template titles every spec "# Feature Specification: <name>". */
const SPEC_TITLE_PREFIX = /^Feature Specification:\s*/i;
/** The folder name becomes the id prefix, so it must use id characters. */
const FEATURE_RE = /^[A-Za-z0-9._-]+$/;

function newItem(): Item {
  return {
    id: '', title: '', group: '', stored: 'open', fileDone: false, fileStatusText: '',
    size: '', priority: '', area: '', created: '', note: '', spec: '', evidence: '',
    historyDate: '', historyCommit: '', depends: [], line: 0,
  };
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function specTitle(text: string): string {
  for (const ln of splitLines(stripBom(text))) {
    if (ln.startsWith('# ')) return trim(ln.slice(2)).replace(SPEC_TITLE_PREFIX, '');
  }
  return '';
}

function parseTasks(feature: string, file: SourceFile, spec: SourceFile | undefined, issues: ParseIssue[]): Program {
  const program: Program = {
    path: file.path, format: 'specKit', title: (spec && specTitle(spec.text)) || feature,
    id: feature, area: '', created: '', spec: spec ? spec.path : '', items: [],
  };
  const lines = splitLines(stripBom(file.text));
  let group = '';
  let fence = '';
  const seen = new Map<string, number>(); // id -> line of its first definition
  for (let li = 0; li < lines.length; li++) {
    const ln = lines[li];
    const f = /^\s*(```|~~~)/.exec(ln);
    if (f) {
      if (fence === '') fence = f[1];
      else if (f[1] === fence) fence = '';
      continue;
    }
    if (fence !== '') continue;
    if (ln.startsWith('## ')) { group = trim(ln.slice(3)); continue; }
    const m = TASK_RE.exec(ln);
    if (!m) continue;
    const id = `${feature}/${m[2]}`;
    const first = seen.get(id);
    if (first !== undefined) {
      issues.push({ path: file.path, line: li + 1, kind: 'duplicate-id', detail: `${m[2]} is already defined on line ${first}` });
      continue;
    }
    seen.set(id, li + 1);
    const it = newItem();
    it.id = id;
    it.group = group;
    it.line = li + 1;
    it.spec = program.spec;
    it.fileStatusText = `[${m[1]}]`;
    it.fileDone = m[1] !== ' ';
    it.stored = it.fileDone ? 'done' : 'open';
    let rest = trim(m[3]);
    const markers: string[] = [];
    for (let mk = MARKER_RE.exec(rest); mk; mk = MARKER_RE.exec(rest)) {
      markers.push(`[${mk[1]}]`);
      rest = rest.slice(mk[0].length);
    }
    it.note = markers.join(' ');
    it.title = trim(rest);
    const dep = DEPENDS_RE.exec(rest);
    if (dep) it.depends = dep[1].split(/\s*(?:,|and)\s*/).map((t) => `${feature}/${t}`);
    program.items.push(it);
  }
  return program;
}

export const specKitAdapter: TaskSourceAdapter = {
  format: 'specKit',
  pathspecs: ['specs/'],
  idsCaseInsensitive: false,
  select(paths: string[]): string[] {
    return paths.filter((p) => FILE_RE.test(p));
  },
  parse(files: SourceFile[]) {
    const issues: ParseIssue[] = [];
    const tasks = new Map<string, SourceFile>();
    const specs = new Map<string, SourceFile>();
    for (const f of sortedByPath(files)) {
      const m = FILE_RE.exec(f.path);
      if (!m) continue;
      (m[2] === 'tasks' ? tasks : specs).set(m[1], f);
    }
    const programs: Program[] = [];
    for (const [feature, file] of tasks) {
      if (!FEATURE_RE.test(feature)) {
        issues.push({ path: file.path, line: 1, kind: 'syntax', detail: `feature folder "${feature}" is not a valid id prefix` });
        continue;
      }
      programs.push(parseTasks(feature, file, specs.get(feature), issues));
    }
    return { programs, issues };
  },
};
