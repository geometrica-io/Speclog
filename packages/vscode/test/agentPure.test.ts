// Agent delivery helpers: pure, vscode-free.
import { describe, expect, it } from 'vitest';
import {
  isInsideWorkspace,
  needsPromptFile,
  promptFileName,
  resolveDelivery,
  resolveExecutable,
  staleFiles,
  type AgentTarget,
  type Delivery,
} from '../src/agentPure';

describe('resolveDelivery', () => {
  const rows: [AgentTarget, boolean, boolean, Delivery][] = [
    ['auto', true, true, 'chat'],
    ['auto', true, false, 'clipboardOpenWindow'],
    ['auto', false, true, 'clipboard'],
    ['auto', false, false, 'clipboardOpenWindow'],
    ['chat', true, true, 'chat'],
    ['chat', true, false, 'clipboardOpenWindow'],
    ['chat', false, true, 'clipboard'],
    ['chat', false, false, 'clipboardOpenWindow'],
    ['terminal', true, true, 'terminal'],
    ['terminal', true, false, 'terminal'],
    ['terminal', false, true, 'terminal'],
    ['terminal', false, false, 'terminal'],
    ['clipboard', true, true, 'clipboard'],
    ['clipboard', true, false, 'clipboard'],
    ['clipboard', false, true, 'clipboard'],
    ['clipboard', false, false, 'clipboard'],
  ];
  it.each(rows)('%s chat=%s inWorkspace=%s -> %s', (s, chat, inWs, want) => {
    expect(resolveDelivery(s, chat, inWs)).toBe(want);
  });
});

describe('isInsideWorkspace', () => {
  it('handles case and spaces', () => {
    expect(isInsideWorkspace('C:\\Users\\Ali Ş\\Repo', ['c:\\users\\ali ş'], 'win32')).toBe(true);
    expect(isInsideWorkspace('/Users/Ali/Repo', ['/users/ali'], 'linux')).toBe(false);
    expect(isInsideWorkspace('/users/ali/Repo', ['/users/ali'], 'linux')).toBe(true);
    expect(isInsideWorkspace('C:\\a\\repo2', ['C:\\a\\repo'], 'win32')).toBe(false);
    expect(isInsideWorkspace('C:\\a\\repo', ['C:\\a\\repo'], 'win32')).toBe(true);
    expect(isInsideWorkspace('/a/repo2', ['/a/repo'], 'linux')).toBe(false);
    expect(isInsideWorkspace('/a/repo', ['/a/repo'], 'linux')).toBe(true);
    expect(isInsideWorkspace('/a/repo', [], 'linux')).toBe(false);
  });
});

describe('resolveExecutable', () => {
  it('returns undefined for a missing command', () => {
    expect(resolveExecutable('claude', '/usr/bin:/bin', '', 'linux', () => false)).toBeUndefined();
    expect(resolveExecutable('claude', 'C:\\bin', '.EXE;.CMD', 'win32', () => false)).toBeUndefined();
  });
  it('finds claude.cmd via PATHEXT on win32', () => {
    const exists = (p: string) => p === 'C:\\npm\\claude.cmd';
    expect(resolveExecutable('claude', 'C:\\bin;C:\\npm', '.COM;.EXE;.BAT;.CMD', 'win32', exists)).toBe(
      'C:\\npm\\claude.cmd',
    );
  });
  it('finds /usr/local/bin/claude on linux', () => {
    const exists = (p: string) => p === '/usr/local/bin/claude';
    expect(resolveExecutable('claude', '/usr/bin:/usr/local/bin', '', 'linux', exists)).toBe('/usr/local/bin/claude');
  });
  it('checks paths with a separator as-is', () => {
    expect(resolveExecutable('/opt/x/claude', '', '', 'linux', (p) => p === '/opt/x/claude')).toBe('/opt/x/claude');
    expect(resolveExecutable('C:\\x\\claude.exe', '', '.EXE', 'win32', (p) => p === 'C:\\x\\claude.exe')).toBe(
      'C:\\x\\claude.exe',
    );
  });
  it('returns undefined for an empty command', () => {
    expect(resolveExecutable('', '/usr/bin', '', 'linux', () => true)).toBeUndefined();
  });
});

describe('needsPromptFile', () => {
  it('uses a file for cmd/bat wrappers and long prompts', () => {
    expect(needsPromptFile('x.CMD', 'hi')).toBe(true);
    expect(needsPromptFile('x.bat', 'hi')).toBe(true);
    expect(needsPromptFile('x.exe', 'hi')).toBe(false);
    expect(needsPromptFile('x.exe', 'a'.repeat(4001))).toBe(true);
    expect(needsPromptFile('x.exe', 'a'.repeat(4000))).toBe(false);
  });
});

describe('promptFileName', () => {
  it('sanitizes slashes', () => {
    expect(promptFileName('My Repo', '001-photo-albums/T001', new Date(2026, 10, 12, 9, 30, 5))).toBe(
      'My_Repo-001-photo-albums_T001-20261112-093005.md',
    );
  });
});

describe('staleFiles', () => {
  it('lists files older than 7 days', () => {
    const day = 86_400_000;
    const now = 100 * day;
    const files = [
      { name: 'old.md', mtimeMs: now - 8 * day },
      { name: 'new.md', mtimeMs: now - 6 * day },
    ];
    expect(staleFiles(files, now)).toEqual(['old.md']);
  });
});

describe('round 1 fixes', () => {
  const EXT = '.COM;.EXE;.BAT;.CMD';
  it('prefers a PATHEXT launcher over an extensionless shim on win32', () => {
    const have = new Set(['C:\\npm\\claude', 'C:\\npm\\claude.cmd']);
    expect(resolveExecutable('claude', 'C:\\npm', EXT, 'win32', (p) => have.has(p))).toBe('C:\\npm\\claude.cmd');
  });
  it('finds an explicit claude.exe with PATHEXT set', () => {
    expect(resolveExecutable('claude.exe', 'C:\\bin', EXT, 'win32', (p) => p === 'C:\\bin\\claude.exe')).toBe(
      'C:\\bin\\claude.exe',
    );
  });
  it('treats a non-PATHEXT dot as part of the name', () => {
    expect(resolveExecutable('python3.11', 'C:\\bin', EXT, 'win32', (p) => p === 'C:\\bin\\python3.11.exe')).toBe(
      'C:\\bin\\python3.11.exe',
    );
  });
  it('resolves a relative path against cwd', () => {
    expect(
      resolveExecutable('.\\bin\\claude', '', EXT, 'win32', (p) => p === 'C:\\repo\\bin\\claude.cmd', 'C:\\repo'),
    ).toBe('C:\\repo\\bin\\claude.cmd');
    expect(resolveExecutable('./bin/claude', '', '', 'linux', (p) => p === '/r/bin/claude', '/r')).toBe(
      '/r/bin/claude',
    );
  });
  it('strips quotes, skips empty PATH entries and defaults PATHEXT on win32', () => {
    expect(resolveExecutable('claude', ';"C:\\q";', '', 'win32', (p) => p === 'C:\\q\\claude.cmd')).toBe(
      'C:\\q\\claude.cmd',
    );
  });
  it('isInsideWorkspace handles UNC, trailing separators and drive roots', () => {
    expect(isInsideWorkspace('\\\\srv\\share\\repo', ['\\\\srv\\share'], 'win32')).toBe(true);
    expect(isInsideWorkspace('\\\\srv\\share2\\repo', ['\\\\srv\\share'], 'win32')).toBe(false);
    expect(isInsideWorkspace('C:\\a\\repo', ['C:\\a\\'], 'win32')).toBe(true);
    expect(isInsideWorkspace('C:\\a\\repo\\', ['C:\\a'], 'win32')).toBe(true);
    expect(isInsideWorkspace('C:\\a', ['C:\\'], 'win32')).toBe(true);
    expect(isInsideWorkspace('/a', ['/'], 'linux')).toBe(true);
  });
  it('caps promptFileName at 120 characters', () => {
    const name = promptFileName('r'.repeat(80), '001-' + 'x'.repeat(300) + '/T001', new Date(2026, 10, 12, 9, 30, 5));
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith('-20261112-093005.md')).toBe(true);
  });
  it('staleFiles boundary: exactly 7 days kept, 7 days + 1 ms stale', () => {
    const week = 7 * 86_400_000;
    const now = 100 * 86_400_000;
    expect(staleFiles([{ name: 'a', mtimeMs: now - week }], now)).toEqual([]);
    expect(staleFiles([{ name: 'b', mtimeMs: now - week - 1 }], now)).toEqual(['b']);
  });
});
