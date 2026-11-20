// File names and default locations of an exported report. No `vscode` import (pure, unit-tested).
import type { Period } from '@speclog/core';

/** `speclog-report-<from>-<to>[-<suffix>].<ext>`. */
export function reportFileName(p: Period, ext: 'html' | 'md', suffix?: string): string {
  return `speclog-report-${p.from}-${p.to}${suffix ? `-${suffix}` : ''}.${ext}`;
}

/** Where the save dialog starts: the first workspace folder, else the home folder (paths or URIs). */
export function defaultSaveDir<T>(firstFolder: T | undefined, home: T): T {
  return firstFolder ?? home;
}
