import * as path from 'path';
import { defineConfig } from 'vitest/config';

// Unit tests of vscode-free helpers; smoke.test.ts runs inside VS Code (npm run test:ext).
export default defineConfig({
  resolve: { alias: { '@speclog/core': path.resolve(__dirname, '../core/src/index.ts') } },
  test: { include: ['test/**/*.test.ts'], exclude: ['test/smoke.test.ts'] },
});
