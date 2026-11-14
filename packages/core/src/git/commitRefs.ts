import { splitLines, trim } from '../text';

export interface TaskRef { repo: string; id: string; }   // repo "" = same repo; may be "owner/name"
export interface CommitRefs { done: TaskRef[]; progress: TaskRef[]; }

function addRefs(value: string, out: TaskRef[]): void {
  for (const raw of value.split(',')) {
    const item = trim(raw);
    if (!item) continue;
    const colon = item.indexOf(':');
    const ref: TaskRef = colon === -1
      ? { repo: '', id: item }
      : { repo: trim(item.slice(0, colon)), id: trim(item.slice(colon + 1)) };
    if (ref.id) out.push(ref);
  }
}

/** Reads "Task:" / "Task-Progress:" lines (line start, exact case) from a commit body. */
export function extractTaskRefs(body: string): CommitRefs {
  const refs: CommitRefs = { done: [], progress: [] };
  const progress = 'Task-Progress: ';
  const done = 'Task: ';
  for (const line of splitLines(body)) {
    if (line.startsWith(progress)) addRefs(line.slice(progress.length), refs.progress);
    else if (line.startsWith(done)) addRefs(line.slice(done.length), refs.done);
  }
  return refs;
}
