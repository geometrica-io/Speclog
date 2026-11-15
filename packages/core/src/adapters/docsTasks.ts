import type { ParseIssue, Program } from '../model';
import { parseDocsTasks } from './docsTasksParser';
import { memo, sortedByPath } from './files';
import type { ParseCache, SourceFile, TaskSourceAdapter } from './types';

/** `docs/tasks/*.md`, direct children only (PM §4.1). */
const FILE_RE = /^docs\/tasks\/[^/]+\.md$/;

export const docsTasksAdapter: TaskSourceAdapter = {
  format: 'docsTasks',
  pathspecs: ['docs/tasks/'],
  idsCaseInsensitive: false,
  select(paths: string[]): string[] {
    return paths.filter((p) => FILE_RE.test(p));
  },
  parse(files: SourceFile[], cache?: ParseCache) {
    const programs: Program[] = [];
    const issues: ParseIssue[] = [];
    for (const f of sortedByPath(files)) {
      const r = memo(cache, 'docsTasks', [f], () => parseDocsTasks(f.text, f.path));
      programs.push(r.program);
      issues.push(...r.issues);
    }
    return { programs, issues };
  },
};
