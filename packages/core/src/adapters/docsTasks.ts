import type { ParseIssue, Program } from '../model';
import { parseDocsTasks } from './docsTasksParser';
import { sortedByPath } from './files';
import type { SourceFile, TaskSourceAdapter } from './types';

/** `docs/tasks/*.md`, direct children only (PM §4.1). */
const FILE_RE = /^docs\/tasks\/[^/]+\.md$/;

export const docsTasksAdapter: TaskSourceAdapter = {
  format: 'docsTasks',
  pathspecs: ['docs/tasks/'],
  idsCaseInsensitive: false,
  select(paths: string[]): string[] {
    return paths.filter((p) => FILE_RE.test(p));
  },
  parse(files: SourceFile[]) {
    const programs: Program[] = [];
    const issues: ParseIssue[] = [];
    for (const f of sortedByPath(files)) {
      const r = parseDocsTasks(f.text, f.path);
      programs.push(r.program);
      issues.push(...r.issues);
    }
    return { programs, issues };
  },
};
