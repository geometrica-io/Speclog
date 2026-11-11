import type { Item, ParseIssue, ParseResult, Program, Status } from '../model';
import { isValidDate, splitLines, trim } from '../text';

const FILE_STATUSES: readonly Status[] = ['open', 'partial', 'bug', 'verify', 'decision', 'dropped', 'done'];
const SIZES = ['XS', 'S', 'M', 'L', 'XL'];
const ID_RE = /^[A-Za-z0-9._/-]+$/;

function newItem(): Item {
  return {
    id: '', title: '', group: '', stored: 'open', fileDone: false, fileStatusText: '',
    size: '', priority: '', area: '', created: '', note: '', spec: '', evidence: '',
    historyDate: '', historyCommit: '', depends: [], line: 0,
  };
}

/** "key: value" with key [a-z-]+. */
function splitField(line: string): { key: string; value: string } | null {
  const m = /^([a-z-]+):/.exec(line);
  if (!m) return null;
  return { key: m[1], value: trim(line.slice(m[0].length)) };
}

function splitDepends(v: string): string[] {
  const out: string[] = [];
  for (const raw of v.split(',')) {
    const part = trim(raw);
    if (part !== '' && part !== '—' && part !== '–' && part !== '-') out.push(part);
  }
  return out;
}

/** Parses a docs/tasks Markdown file (port of PM TaskFile.cpp). */
export function parseDocsTasks(text: string, path: string): ParseResult {
  const program: Program = {
    path, format: 'docsTasks', title: '', id: '', area: '', created: '', spec: '', items: [],
  };
  const issues: ParseIssue[] = [];
  const issue = (line: number, kind: string, detail: string) => issues.push({ path, line, kind, detail });

  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = splitLines(text);
  let haveTitle = false;
  let group = '';
  let cur: Item | null = null; // null = program level
  let skipItem = false;
  let curHasStatus = false;
  let curDoneSeen = false;

  const finishItem = () => {
    if (!cur || skipItem) return;
    if (!curHasStatus) issue(cur.line, 'missing-status', cur.id);
    else if (cur.stored === 'done' && !curDoneSeen) issue(cur.line, 'bad-status', 'status done requires a done field');
    if (curDoneSeen && cur.stored !== 'done') {
      if (curHasStatus) issue(cur.line, 'bad-status', 'done field requires status done');
      cur.historyDate = '';
      cur.historyCommit = '';
    }
    cur.fileDone = cur.stored === 'done' && curDoneSeen;
  };

  for (let li = 0; li < lines.length; li++) {
    const lineNo = li + 1;
    const ln = lines[li];
    if (trim(ln) === '') continue;

    if (ln.startsWith('### ')) {
      // Fields between a group heading and the next item belong to no item.
      finishItem();
      cur = null;
      skipItem = false;
      group = trim(ln.slice(4));
      continue;
    }
    if (ln.startsWith('## ')) {
      finishItem();
      const rest = trim(ln.slice(3));
      const sp = rest.search(/[ \t]/);
      const id = sp === -1 ? rest : rest.slice(0, sp);
      const title = sp === -1 ? '' : trim(rest.slice(sp));
      if (id === '' || !ID_RE.test(id)) {
        issue(lineNo, 'syntax', 'bad item id: ' + id);
        cur = newItem();
        skipItem = true;
        continue;
      }
      if (program.items.some((it) => it.id === id)) {
        issue(lineNo, 'duplicate-id', id);
        cur = newItem();
        skipItem = true;
        continue;
      }
      cur = newItem();
      program.items.push(cur);
      skipItem = false;
      cur.id = id;
      cur.title = title;
      cur.group = group;
      cur.line = lineNo;
      curHasStatus = false;
      curDoneSeen = false;
      continue;
    }
    if (ln.startsWith('# ')) {
      if (haveTitle) { issue(lineNo, 'syntax', 'second program title'); continue; }
      haveTitle = true;
      program.title = trim(ln.slice(2));
      continue;
    }

    const f = splitField(ln);
    if (!f) { issue(lineNo, 'syntax', ln); continue; }
    const key = f.key;
    let value = f.value;
    // A trailing backslash joins the next line.
    while (value.endsWith('\\') && li + 1 < lines.length) {
      value = trim(value.slice(0, -1));
      const next = trim(lines[++li]);
      value += value === '' ? next : ' ' + next;
    }
    if (value.endsWith('\\')) value = trim(value.slice(0, -1));

    if (!haveTitle) { issue(lineNo, 'syntax', 'field before program title'); continue; }

    if (!cur) {
      if (group !== '') { issue(lineNo, 'syntax', 'field after group heading'); continue; }
      if (key === 'program') program.id = value;
      else if (key === 'spec') program.spec = value;
      else if (key === 'area') program.area = value;
      else if (key === 'created') {
        if (!isValidDate(value)) issue(lineNo, 'bad-date', value); // reported, then dropped
        else program.created = value;
      } else issue(lineNo, 'unknown-field', key);
      continue;
    }

    const it = cur;
    if (key === 'status') {
      curHasStatus = true;
      it.fileStatusText = value;
      const st = FILE_STATUSES.find((s) => s === value);
      if (st) it.stored = st;
      else if (!skipItem) issue(lineNo, 'bad-status', value);
    } else if (key === 'size') {
      if (!SIZES.includes(value)) { if (!skipItem) issue(lineNo, 'bad-size', value); }
      else it.size = value;
    } else if (key === 'priority') it.priority = value;
    else if (key === 'area') it.area = value;
    else if (key === 'created') {
      if (!isValidDate(value)) { if (!skipItem) issue(lineNo, 'bad-date', value); }
      else it.created = value;
    } else if (key === 'note') it.note = value;
    else if (key === 'spec') it.spec = value;
    else if (key === 'evidence') it.evidence = value;
    else if (key === 'depends') it.depends.push(...splitDepends(value));
    else if (key === 'done') {
      curDoneSeen = true;
      const sp = value.search(/[ \t]/);
      const date = sp === -1 ? value : value.slice(0, sp);
      const commit = trim(value.slice(date.length));
      if (!isValidDate(date)) {
        if (!skipItem) issue(lineNo, 'bad-date', value);
      } else {
        it.historyDate = date;
        it.historyCommit = commit === '-' ? '' : commit;
      }
    } else if (!skipItem) issue(lineNo, 'unknown-field', key);
  }
  finishItem();

  for (const it of program.items) {
    if (it.area === '') it.area = program.area;
    if (it.created === '') it.created = program.created;
    if (it.spec === '') it.spec = program.spec;
  }
  return { program, issues };
}
