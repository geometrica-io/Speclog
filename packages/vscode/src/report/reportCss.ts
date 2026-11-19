// Stylesheet of the report: light neutral theme, A4 print rules (lists print open, one repository per page).
export const REPORT_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; padding: 32px 40px; background: #fff; color: #1f2933; font: 14px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
.report { max-width: 980px; margin: 0 auto; }
h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.01em; }
h2 { font-size: 18px; margin: 28px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #d9dee4; }
h3 { font-size: 15px; margin: 20px 0 6px; color: #323f4b; }
.meta { color: #616e7c; font-size: 13px; margin: 0 0 2px; }
.note { color: #616e7c; font-size: 12px; font-style: italic; margin: 8px 0; }
table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 13px; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #e4e7eb; vertical-align: top; }
th { background: #f5f7fa; color: #323f4b; font-weight: 600; border-bottom: 1px solid #cbd2d9; }
td.num, th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
tr.total td { font-weight: 600; background: #f5f7fa; }
.up { color: #1b7f4b; } .down { color: #b4331f; }
.id { font-family: Consolas, "SFMono-Regular", Menlo, monospace; white-space: nowrap; }
.tag { display: inline-block; padding: 0 6px; border-radius: 8px; background: #e4e7eb; color: #323f4b; font-size: 11px; margin-left: 6px; }
.sub { color: #616e7c; font-size: 12px; }
details { margin: 6px 0; }
summary { cursor: pointer; color: #1f5fa8; font-size: 13px; }
.curve { margin: 8px 0; }
.curve svg { display: block; width: 100%; max-width: 640px; height: auto; }
.repo { margin-top: 32px; }
.footer { margin-top: 36px; padding-top: 10px; border-top: 1px solid #d9dee4; color: #616e7c; font-size: 12px; }
@media print {
  @page { size: A4; margin: 15mm }
  body { padding: 0; font-size: 11pt; }
  details { display: block }
  details::details-content { content-visibility: visible; display: block; }
  details > summary { list-style: none; cursor: default; color: #323f4b; font-weight: 600; font-size: 12pt }
  details > summary::-webkit-details-marker { display: none }
  .repo { break-before: page }
  .repo:first-of-type { break-before: auto }
  tr, h2, h3 { break-inside: avoid; }
  thead { display: table-header-group; }
}
`;
