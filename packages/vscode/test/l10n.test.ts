// Every vscode.l10n.t literal in src must have an entry in l10n/bundle.l10n.json, and the bundle holds no stale ones.
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const srcDir = path.join(__dirname, '..', 'src');

/** Keys of every l10n.t('...') call (single-quoted literal, as the project writes them). */
export function sourceKeys(): Set<string> {
  const keys = new Set<string>();
  const re = /l10n\.t\(\s*'((?:[^'\\]|\\.)*)'/g;
  for (const f of fs.readdirSync(srcDir).filter((n) => n.endsWith('.ts'))) {
    const text = fs.readFileSync(path.join(srcDir, f), 'utf8');
    for (const m of text.matchAll(re)) keys.add(m[1].replace(/\\(.)/g, '$1'));
  }
  return keys;
}

/** l10n.t( calls whose first argument is not a single-quoted literal (the bundle check would miss them). */
export function nonLiteralCalls(text: string): string[] {
  return [...text.matchAll(/l10n\.t\((?!\s*')[^)\n]*\)?/g)].map((m) => m[0]);
}

describe('l10n bundle', () => {
  const bundle = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'l10n', 'bundle.l10n.json'), 'utf8')) as Record<string, string>;
  const src = sourceKeys();
  it('every l10n.t call takes a single-quoted literal', () => {
    expect(nonLiteralCalls("l10n.t('a') l10n.t(\n  'b', x) l10n.t(\"c\") l10n.t(`d`) l10n.t(key)"))
      .toEqual(['l10n.t("c")', 'l10n.t(`d`)', 'l10n.t(key)']);
    const bad: string[] = [];
    for (const f of fs.readdirSync(srcDir).filter((n) => n.endsWith('.ts'))) {
      for (const c of nonLiteralCalls(fs.readFileSync(path.join(srcDir, f), 'utf8'))) bad.push(`${f}: ${c}`);
    }
    expect(bad).toEqual([]);
  });
  it('has an entry for every l10n.t literal', () => {
    expect([...src].filter((k) => !(k in bundle))).toEqual([]);
  });
  it('has no unused entries', () => {
    expect(Object.keys(bundle).filter((k) => !src.has(k))).toEqual([]);
  });
});
