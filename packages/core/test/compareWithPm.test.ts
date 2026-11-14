// scripts/compare-with-pm.mjs: the comparison logic against a small saved PM --check output (PM itself
// needs a desktop session, so the full run is manual).
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { pathToFileURL } from 'url';

interface Att { kind: string; repo: string; ref: string; detail: string }
interface Side { repos: Map<string, { done: number; total: number; other?: number }>; attention: Att[] }
interface Diff { repo: string; metric: string; onlyPm?: string[]; onlySpeclog?: string[]; reason?: string }
interface Script {
  parseList(s: string): string[];
  parsePm(text: string): Side;
  compare(pm: Side, sp: Side, explained?: Record<string, string>): { diffs: Diff[]; unexplained: Diff[] };
}

const scriptUrl = pathToFileURL(path.join(__dirname, '..', '..', '..', 'scripts', 'compare-with-pm.mjs')).href;
const load = async (): Promise<Script> => (await import(scriptUrl)) as Script;

const PM_OUTPUT = [
  'Alpha 3/5',
  'Beta 0/0',
  'attention: untagged-commit Alpha abc123 Fix things',
  'attention: format-issue Alpha docs/tasks/a.md:7 bad-status: x',
  'attention: no-tasks-dir Beta  ',
  '',
].join('\r\n');

describe('compare-with-pm', () => {
  it('parses the origin filter list; empty means every repository', async () => {
    const s = await load();
    expect(s.parseList('')).toEqual([]);
    expect(s.parseList('github.com/a/, github.com/b/,,')).toEqual(['github.com/a/', 'github.com/b/']);
  });

  it('parses PM --check output', async () => {
    const pm = (await load()).parsePm(PM_OUTPUT);
    expect([...pm.repos]).toEqual([['Alpha', { done: 3, total: 5 }], ['Beta', { done: 0, total: 0 }]]);
    expect(pm.attention.map((a) => [a.kind, a.repo, a.ref])).toEqual([
      ['untagged-commit', 'Alpha', 'abc123'], ['format-issue', 'Alpha', 'docs/tasks/a.md:7'], ['no-tasks-dir', 'Beta', ''],
    ]);
  });

  it('compares Attention as (kind, repo, ref), not only counts', async () => {
    const s = await load();
    const pm = s.parsePm(PM_OUTPUT);
    const sp = (refs: string[]): Side => ({
      repos: new Map([['Alpha', { done: 3, total: 5 }], ['Beta', { done: 0, total: 0 }]]),
      attention: [
        ...refs.map((ref) => ({ kind: 'untaggedCommit', repo: 'Alpha', ref, detail: '' })),
        { kind: 'formatIssue', repo: 'Alpha', ref: 'docs/tasks/a.md:7', detail: '' },
        { kind: 'noTaskFiles', repo: 'Beta', ref: '', detail: '' },
        { kind: 'unverifiedSummary', repo: 'Alpha', ref: '', detail: '' }, // Speclog only: not compared
      ],
    });
    expect(s.compare(pm, sp(['abc123'])).diffs).toEqual([]);
    // Same count, different commit: a difference.
    const other = s.compare(pm, sp(['fff999']));
    expect(other.unexplained.map((d) => [d.repo, d.metric, d.onlyPm, d.onlySpeclog])).toEqual([
      ['Alpha', 'attention untagged-commit', ['abc123'], ['fff999']],
    ]);
    const explained = s.compare(pm, sp(['fff999']), { 'Alpha|attention untagged-commit': 'known' });
    expect(explained.unexplained).toEqual([]);
    expect(explained.diffs[0].reason).toBe('known');
  });
});
