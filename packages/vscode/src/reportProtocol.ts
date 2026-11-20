// Messages between the extension host and the report tab's webview. Imported by both sides, so it has no
// imports (the webview bundle never pulls in the core or `vscode`).

/** Same values as the core's PERIOD_PRESETS (this file has no imports); a test checks the two agree. */
export const REPORT_PRESETS = ['thisWeek', 'lastWeek', 'thisMonth', 'lastMonth', 'custom'] as const;
export const REPORT_FORMATS = ['html', 'md', 'pdf'] as const;
/** Longest key or date the host accepts; equals the board's MAX_KEY_LENGTH (checked by a test). */
export const REPORT_MAX_KEY_LENGTH = 4096;
/** Most repository keys accepted in one `repos` message. */
export const REPORT_MAX_KEYS = 10000;

export type ReportFormat = typeof REPORT_FORMATS[number];

export type ReportHostToWebview =
  | { type: 'init'; strings: Record<string, string>; presets: string[] }
  | { type: 'controls'; preset: string; from: string; to: string; repos: { key: string; name: string; checked: boolean }[] }
  | { type: 'busy'; done: number; total: number }
  | { type: 'report'; html: string }
  | { type: 'error'; text: string }
  | { type: 'stale' };

export type ReportWebviewToHost =
  | { type: 'ready' }
  | { type: 'period'; preset: string; from: string; to: string }
  | { type: 'repos'; keys: string[] }
  | { type: 'refresh' }
  | { type: 'export'; format: ReportFormat };

/** Every user-visible text of the report webview; the host fills it through vscode.l10n.t. */
export const REPORT_STRING_KEYS = [
  'period', 'preset.thisWeek', 'preset.lastWeek', 'preset.thisMonth', 'preset.lastMonth', 'preset.custom',
  'from', 'to', 'repositories', 'noRepositories', 'refresh', 'exportHtml', 'exportMd', 'exportPdf',
  'computing', 'progress', 'stale', 'staleRefresh',
] as const;

const isText = (v: unknown): v is string => typeof v === 'string' && v.length <= REPORT_MAX_KEY_LENGTH;

/** Validates a message from the webview: its shape, string lengths, known presets and formats. Null when invalid. */
export function parseReportMessage(m: unknown): ReportWebviewToHost | null {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const r = m as Record<string, unknown>;
  switch (r.type) {
    case 'ready':
    case 'refresh':
      return { type: r.type };
    case 'period':
      if (!(REPORT_PRESETS as readonly unknown[]).includes(r.preset) || !isText(r.from) || !isText(r.to)) return null;
      return { type: 'period', preset: r.preset as string, from: r.from, to: r.to };
    case 'repos':
      if (!Array.isArray(r.keys) || r.keys.length > REPORT_MAX_KEYS || !r.keys.every(isText)) return null;
      return { type: 'repos', keys: [...(r.keys as string[])] };
    case 'export':
      if (!(REPORT_FORMATS as readonly unknown[]).includes(r.format)) return null;
      return { type: 'export', format: r.format as ReportFormat };
    default:
      return null;
  }
}
