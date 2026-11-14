// package.json `%key%` references and package.nls.json must agree, in both directions.
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const root = path.join(__dirname, '..');
const pkgText = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
const nls = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.json'), 'utf8')) as Record<string, string>;
const used = new Set([...pkgText.matchAll(/"%([^%"]+)%"/g)].map((m) => m[1]));

describe('package.nls.json', () => {
  it('defines every %key% used in package.json', () => {
    expect([...used].filter((k) => !(k in nls))).toEqual([]);
  });
  it('has no unused entries', () => {
    expect(Object.keys(nls).filter((k) => !used.has(k))).toEqual([]);
  });
});

describe('settings', () => {
  it('the agent command is a per-machine setting (machine-overridable)', () => {
    const props = (JSON.parse(pkgText) as { contributes: { configuration: { properties: Record<string, { scope?: string }> } } })
      .contributes.configuration.properties;
    expect(props['speclog.agent.terminalCommand'].scope).toBe('machine-overridable');
  });
});
