// Bundles the extension (and, with --tests, the smoke test) into CommonJS for Node, and the webview
// into an IIFE script + stylesheet for the panel. The core is bundled from its sources, so it need
// not be built first.
import * as esbuild from 'esbuild';
import * as path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes('--production');
const tests = process.argv.includes('--tests');

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  alias: { '@speclog/core': path.join(here, '..', 'core', 'src', 'index.ts') },
  sourcemap: !production,
  minify: production,
  logLevel: 'warning',
};

await esbuild.build({ ...common, entryPoints: [path.join(here, 'src', 'extension.ts')], outfile: path.join(here, 'dist', 'extension.js') });

// Webview: browser IIFE; it imports only protocol.ts from src (no core, no vscode).
await esbuild.build({
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome114',
  sourcemap: !production,
  minify: production,
  logLevel: 'warning',
  entryPoints: { webview: path.join(here, 'webview', 'main.ts') },
  outdir: path.join(here, 'dist'),
});
await esbuild.build({
  bundle: true,
  minify: production,
  logLevel: 'warning',
  entryPoints: { webview: path.join(here, 'webview', 'styles.css') },
  outdir: path.join(here, 'dist'),
});

if (tests) {
  await esbuild.build({
    ...common,
    entryPoints: { runTest: path.join(here, 'test', 'runTest.ts'), smoke: path.join(here, 'test', 'smoke.test.ts') },
    outdir: path.join(here, 'out', 'test'),
    external: ['vscode', '@vscode/test-electron'],
  });
}
