// File name of an exported report. No `vscode` import (pure, unit-tested).
import type { Period } from '@speclog/core';

export function reportFileName(p: Period, ext: 'html' | 'md'): string {
  return `speclog-report-${p.from}-${p.to}.${ext}`;
}
