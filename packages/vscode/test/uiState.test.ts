// Stored panel state is validated: bad or old values fall back to defaults.
import { describe, expect, it } from 'vitest';
import { MAX_KEY_LENGTH } from '../src/protocol';
import { defaultUi, isKey, readUi } from '../src/uiState';

describe('readUi', () => {
  it('gives the defaults for missing or broken state', () => {
    expect(readUi(undefined)).toEqual(defaultUi());
    expect(readUi('x')).toEqual(defaultUi());
    expect(defaultUi().statuses).not.toContain('dropped');
  });

  it('keeps valid values and drops invalid ones', () => {
    const ui = readUi({
      view: 'time', statuses: ['bug', 'nonsense', 3], sizes: ['M', 1], open: { program: ['a', 2], area: 'x' },
      selected: { time: 'k', area: 5 }, attentionOpen: true, attentionHeight: 1e9, treeFraction: -1,
    });
    expect(ui).toMatchObject({
      view: 'time', statuses: ['bug'], sizes: ['M'], open: { program: ['a'], area: [], time: [] },
      selected: { program: '', area: '', time: 'k' }, attentionOpen: true, attentionHeight: 4000, treeFraction: 0.1,
    });
    expect(readUi({ view: 'bogus' }).view).toBe('program');
  });
});

describe('isKey', () => {
  it('accepts strings up to the key length limit', () => {
    expect(isKey('p/C:/repo')).toBe(true);
    expect(isKey('x'.repeat(MAX_KEY_LENGTH))).toBe(true);
    expect(isKey('x'.repeat(MAX_KEY_LENGTH + 1))).toBe(false);
    expect(isKey(5)).toBe(false);
  });
});
