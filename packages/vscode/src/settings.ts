// Reads the speclog.* settings into an EngineConfig.
import * as os from 'os';
import * as vscode from 'vscode';
import { EngineConfig, UnverifiedMode } from '@speclog/core';
import { expandRoots } from './files';

export const SECTION = 'speclog';

const MODES: readonly UnverifiedMode[] = ['unverified', 'done', 'open'];

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : [];
}

function positive(v: unknown, fallback: number, min: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(min, v) : fallback;
}

export function readEngineConfig(trustCommits: Record<string, string>): EngineConfig {
  const c = vscode.workspace.getConfiguration(SECTION);
  const mode = c.get<string>('unverifiedDone');
  return {
    discover: {
      workspaceFolders: (vscode.workspace.workspaceFolders ?? [])
        .filter((f) => f.uri.scheme === 'file')
        .map((f) => f.uri.fsPath),
      roots: expandRoots(c.get('roots'), os.homedir()),
      exclude: strings(c.get('exclude')),
      originFilter: strings(c.get('originFilter')),
    },
    fetchEnabled: c.get<boolean>('fetch.enabled') !== false,
    fetchIntervalSec: positive(c.get('fetch.intervalSeconds'), 300, 30),
    unverifiedMode: MODES.includes(mode as UnverifiedMode) ? (mode as UnverifiedMode) : 'unverified',
    staleBranchDays: positive(c.get('staleBranchDays'), 7, 1),
    trustCommits: { ...trustCommits },
  };
}
