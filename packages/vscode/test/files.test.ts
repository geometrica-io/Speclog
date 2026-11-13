// openFile: only paths that stay inside the repository are opened.
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { clampLine, resolveInRepo } from '../src/files';

const root = path.resolve('/work/repo');

describe('resolveInRepo', () => {
  it('resolves a relative path inside the repository', () => {
    expect(resolveInRepo(root, 'docs/tasks/a.md')).toBe(path.join(root, 'docs', 'tasks', 'a.md'));
    expect(resolveInRepo(root, 'docs/../README.md')).toBe(path.join(root, 'README.md'));
    expect(resolveInRepo(root, 'specs/001-x/tasks.md')).toBe(path.join(root, 'specs', '001-x', 'tasks.md'));
  });

  it('rejects ../ paths that escape the repository', () => {
    expect(resolveInRepo(root, '../other/a.md')).toBeUndefined();
    expect(resolveInRepo(root, 'docs/../../a.md')).toBeUndefined();
    expect(resolveInRepo(root, '..\\a.md')).toBeUndefined();
    expect(resolveInRepo(root, '..')).toBeUndefined();
  });

  it('rejects absolute paths, the root itself and empty paths', () => {
    expect(resolveInRepo(root, path.join(root, 'a.md'))).toBeUndefined();
    expect(resolveInRepo(root, '/etc/passwd')).toBeUndefined();
    expect(resolveInRepo(root, '\\a.md')).toBeUndefined();
    expect(resolveInRepo(root, 'C:\\Windows\\a.md')).toBeUndefined();
    expect(resolveInRepo(root, 'C:a.md')).toBeUndefined();
    expect(resolveInRepo(root, '\\\\server\\share\\a.md')).toBeUndefined();
    expect(resolveInRepo(root, '.')).toBeUndefined();
    expect(resolveInRepo(root, '')).toBeUndefined();
    expect(resolveInRepo(root, 'a\0b')).toBeUndefined();
  });

  it('does not treat a sibling folder sharing the prefix as inside', () => {
    expect(resolveInRepo(root, '../repo2/a.md')).toBeUndefined();
  });
});

describe('clampLine', () => {
  it('gives a non-negative integer or undefined', () => {
    expect(clampLine(7)).toBe(7);
    expect(clampLine(3.9)).toBe(3);
    expect(clampLine(-2)).toBe(0);
    expect(clampLine(Number.NaN)).toBeUndefined();
    expect(clampLine(Infinity)).toBeUndefined();
    expect(clampLine('4')).toBeUndefined();
    expect(clampLine(undefined)).toBeUndefined();
  });
});
