import { describe, it, expect } from 'vitest';
import { parseDocsTasks } from '../src/adapters/docsTasksParser';
import type { ParseResult } from '../src/model';

const kSpecExample =
  '# Başlangıç rijitliği — açık uçlar\n' +
  'program: BL52\n' +
  'spec: docs/superpowers/specs/2026-11-07-initial-stiffness-from-nonlinear-case-design.md\n' +
  'area: Analiz/Burkulma\n' +
  'created: 2026-11-07\n' +
  '\n' +
  '## BL52.1 Yük durumu tabanlı burkulma\n' +
  'status: open\n' +
  'size: M\n' +
  'note: bucklingParams.initialStiffnessCaseId seçilebiliyor ve kaydediliyor ama kullanılmıyor.\n' +
  'depends: —\n' +
  '\n' +
  '## BL52.7 Tapered elemanlarda geri hesap tutarsızlığı\n' +
  'status: bug\n' +
  'size: S\n' +
  'area: Analiz/Kesit\n' +
  'evidence: absent "BuildLocalStiffnessTapered" in src/analysis/FEASolver_Recover.cpp\n';

const toCrlf = (s: string) => s.replace(/\n/g, '\r\n');
const hasIssue = (r: ParseResult, kind: string) => r.issues.some((i) => i.kind === kind);
const countIssue = (r: ParseResult, kind: string) => r.issues.filter((i) => i.kind === kind).length;

describe('docs/tasks parser', () => {
  it('parses program header and items', () => {
    const r = parseDocsTasks(kSpecExample, 'docs/tasks/bl52.md');
    expect(r.issues).toEqual([]);
    expect(r.program.path).toBe('docs/tasks/bl52.md');
    expect(r.program.format).toBe('docsTasks');
    expect(r.program.title).toBe('Başlangıç rijitliği — açık uçlar');
    expect(r.program.id).toBe('BL52');
    expect(r.program.items.length).toBe(2);
    const [a, b] = r.program.items;
    expect(a.id).toBe('BL52.1');
    expect(a.title).toBe('Yük durumu tabanlı burkulma');
    expect(a.stored).toBe('open');
    expect(a.fileStatusText).toBe('open');
    expect(a.fileDone).toBe(false);
    expect(a.size).toBe('M');
    expect(a.line).toBe(7);
    expect(a.depends).toEqual([]);
    expect(b.id).toBe('BL52.7');
    expect(b.stored).toBe('bug');
    expect(b.area).toBe('Analiz/Kesit');
    expect(b.evidence).toBe('absent "BuildLocalStiffnessTapered" in src/analysis/FEASolver_Recover.cpp');
  });

  it('items inherit program area created spec', () => {
    const r = parseDocsTasks(kSpecExample, 'p.md');
    const a = r.program.items[0];
    expect(a.area).toBe('Analiz/Burkulma');
    expect(a.created).toBe('2026-11-07');
    expect(a.spec).toBe(r.program.spec);
    expect(a.spec).not.toBe('');
    expect(r.program.items[1].area).toBe('Analiz/Kesit');
  });

  it('group heading sets item group', () => {
    const r = parseDocsTasks(
      '# EC3\nprogram: EC3\n\n## G1 Before any group\nstatus: open\n### S5 Burkulma\n' +
        '## S5.3 Eğilme burkulması\nstatus: open\n### S6 Kesme\n## S6.1 Kesme\nstatus: partial\n',
      'p.md',
    );
    expect(r.issues).toEqual([]);
    expect(r.program.items.map((i) => i.group)).toEqual(['', 'S5 Burkulma', 'S6 Kesme']);
  });

  it('backslash continues a value', () => {
    const r = parseDocsTasks('# P\n## A1 One\nstatus: open\nnote: birinci \\\nikinci\n', 'p.md');
    expect(r.issues).toEqual([]);
    expect(r.program.items[0].note).toBe('birinci ikinci');
  });

  it('crlf input parses identically', () => {
    const a = parseDocsTasks(kSpecExample, 'p.md');
    const b = parseDocsTasks(toCrlf(kSpecExample), 'p.md');
    expect(b.issues).toEqual([]);
    expect(b.program).toEqual(a.program);
  });

  it('duplicate id reported', () => {
    const r = parseDocsTasks('# P\n## A1 First\nstatus: open\n## A1 Second\nstatus: open\n', 'p.md');
    expect(countIssue(r, 'duplicate-id')).toBe(1);
    for (const i of r.issues) if (i.kind === 'duplicate-id') expect(i.line).toBe(4);
  });

  it('unknown field reported not fatal', () => {
    const r = parseDocsTasks('# P\n## A1 First\nstatus: open\ncolour: red\n', 'p.md');
    expect(hasIssue(r, 'unknown-field')).toBe(true);
    expect(r.program.items.length).toBe(1);
    expect(r.program.items[0].id).toBe('A1');
  });

  it('status done only with done field', () => {
    const r = parseDocsTasks(
      '# P\n## A1 One\nstatus: done\ndone: 2026-08-21 abc1234\n' +
        '## A2 Two\nstatus: done\ndone: 2026-08-21 -\n## A3 Three\nstatus: done\n',
      'p.md',
    );
    expect(r.program.items.length).toBe(3);
    const [a, b, c] = r.program.items;
    expect(a.stored).toBe('done');
    expect(a.fileDone).toBe(true);
    expect(a.historyDate).toBe('2026-08-21');
    expect(a.historyCommit).toBe('abc1234');
    expect(b.stored).toBe('done');
    expect(b.historyDate).toBe('2026-08-21');
    expect(b.historyCommit).toBe('');
    expect(c.fileDone).toBe(false);
    expect(countIssue(r, 'bad-status')).toBe(1);
    for (const i of r.issues) if (i.kind === 'bad-status') expect(i.line).toBe(8);
  });

  it('onbranch is not valid in a file', () => {
    expect(hasIssue(parseDocsTasks('# P\n## A1 One\nstatus: onbranch\n', 'p.md'), 'bad-status')).toBe(true);
    expect(hasIssue(parseDocsTasks('# P\n## A1 One\nstatus: unverified\n', 'p.md'), 'bad-status')).toBe(true);
  });

  it('missing status reported', () => {
    const r = parseDocsTasks('# P\n## A1 One\nsize: S\n', 'p.md');
    expect(hasIssue(r, 'missing-status')).toBe(true);
    expect(r.program.items.length).toBe(1);
  });

  it('bad date reported', () => {
    expect(hasIssue(parseDocsTasks('# P\ncreated: 2026/11/07\n## A1 One\nstatus: open\n', 'p.md'), 'bad-date')).toBe(true);
  });

  it('bad size reported', () => {
    expect(hasIssue(parseDocsTasks('# P\n## A1 One\nstatus: open\nsize: XXL\n', 'p.md'), 'bad-size')).toBe(true);
  });

  it('depends splits on comma', () => {
    const r = parseDocsTasks(
      '# P\n## A1 One\nstatus: open\ndepends: G7, SFEA:S5.3\n## A2 Two\nstatus: open\ndepends: —\n',
      'p.md',
    );
    expect(r.program.items[0].depends).toEqual(['G7', 'SFEA:S5.3']);
    expect(r.program.items[1].depends).toEqual([]);
  });

  it('stray line is a syntax issue', () => {
    expect(hasIssue(parseDocsTasks('# P\nhello world\n## A1 One\nstatus: open\n', 'p.md'), 'syntax')).toBe(true);
  });

  it('bad id is a syntax issue', () => {
    expect(hasIssue(parseDocsTasks('# P\n## A#1 One\nstatus: open\n', 'p.md'), 'syntax')).toBe(true);
  });

  it('slash and underscore are valid in ids', () => {
    const r = parseDocsTasks('# P\n## feat_x/T1.2-a One\nstatus: open\n', 'p.md');
    expect(r.issues).toEqual([]);
    expect(r.program.items[0].id).toBe('feat_x/T1.2-a');
  });

  it('turkish text survives', () => {
    const r = parseDocsTasks('# P\n## A1 İç kuvvet çıktısı ğüşıöç\nstatus: open\n', 'p.md');
    expect(r.program.items[0].title).toBe('İç kuvvet çıktısı ğüşıöç');
  });

  it('UTF-8 BOM at the start is tolerated', () => {
    const r = parseDocsTasks('﻿' + kSpecExample, 'p.md');
    expect(r.issues).toEqual([]);
    expect(r.program.title).toBe('Başlangıç rijitliği — açık uçlar');
    expect(r.program.items.length).toBe(2);
  });

  it('fields after a group heading belong to no item', () => {
    const r = parseDocsTasks(
      '# P\n## A1 One\nstatus: open\n### G Group\nnote: stray\n## A2 Two\nstatus: open\n',
      'p.md',
    );
    expect(r.program.items.length).toBe(2);
    expect(r.program.items[0].note).toBe('');
    expect(countIssue(r, 'syntax')).toBe(1);
    expect(r.issues[0].line).toBe(5);
    expect(r.program.items[1].group).toBe('G Group');
  });

  it('invalid size and created values are reported and dropped', () => {
    const r = parseDocsTasks(
      '# P\ncreated: 2026-02-30\n## A1 One\nstatus: open\nsize: XXL\ncreated: 2026-13-01\n',
      'p.md',
    );
    expect(countIssue(r, 'bad-date')).toBe(2);
    expect(countIssue(r, 'bad-size')).toBe(1);
    expect(r.program.items.length).toBe(1);
    expect(r.program.created).toBe('');
    expect(r.program.items[0].size).toBe('');
    expect(r.program.items[0].created).toBe('');
  });

  it('done field without status done is an issue', () => {
    const r = parseDocsTasks('# P\n## A1 One\nstatus: open\ndone: 2026-01-02 -\n', 'p.md');
    expect(countIssue(r, 'bad-status')).toBe(1);
    expect(r.program.items[0].stored).toBe('open');
    expect(r.program.items[0].fileDone).toBe(false);
    expect(r.program.items[0].historyDate).toBe('');
  });

  it('crlf with a continued value', () => {
    const r = parseDocsTasks('# P\r\n## A1 One\r\nstatus: open\r\nnote: first \\\r\nsecond\r\n', 'p.md');
    expect(r.issues).toEqual([]);
    expect(r.program.items[0].note).toBe('first second');
  });

  it('continuation on the last line ends the value', () => {
    const r = parseDocsTasks('# P\n## A1 One\nstatus: open\nnote: dangling \\', 'p.md');
    expect(r.issues).toEqual([]);
    expect(r.program.items[0].note).toBe('dangling');
  });

  it('unknown program-level field is reported', () => {
    const r = parseDocsTasks('# P\nowner: me\n## A1 One\nstatus: open\n', 'p.md');
    expect(countIssue(r, 'unknown-field')).toBe(1);
    expect(r.issues[0].line).toBe(2);
    expect(r.issues[0].detail).toBe('owner');
    expect(r.program.items.length).toBe(1);
  });
});
