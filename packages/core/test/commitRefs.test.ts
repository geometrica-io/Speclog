import { describe, it, expect } from 'vitest';
import { extractTaskRefs } from '../src/git/commitRefs';

describe('extractTaskRefs', () => {
  it('extracts Task and Task-Progress lines', () => {
    const r = extractTaskRefs('Fix x\n\nTask: S5.3\nTask: SFEA:G7\nTask-Progress: BL52.1\n');
    expect(r.done).toEqual([{ repo: '', id: 'S5.3' }, { repo: 'SFEA', id: 'G7' }]);
    expect(r.progress).toEqual([{ repo: '', id: 'BL52.1' }]);
  });

  it('case and leading space do not match', () => {
    expect(extractTaskRefs('task: S1').done).toEqual([]);
    expect(extractTaskRefs('  Task: S1').done).toEqual([]);
  });

  it('values are trimmed and comma split', () => {
    const r = extractTaskRefs('Task: S1, S2  \r\nTask-Progress:  X:Y \n');
    expect(r.done).toEqual([{ repo: '', id: 'S1' }, { repo: '', id: 'S2' }]);
    expect(r.progress).toEqual([{ repo: 'X', id: 'Y' }]);
  });

  it('mid-body Task line counts', () => {
    const r = extractTaskRefs('Subject\n\npara one\nTask: A1\nmore text\n\nlast');
    expect(r.done).toEqual([{ repo: '', id: 'A1' }]);
  });

  it('owner/name repo is kept', () => {
    const r = extractTaskRefs('Task: owner/name:G7\n');
    expect(r.done).toEqual([{ repo: 'owner/name', id: 'G7' }]);
  });
});
