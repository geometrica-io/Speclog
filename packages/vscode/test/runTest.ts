// Launches VS Code (downloaded and cached in .vscode-test/) with the extension and a workspace of
// two throwaway repositories, then runs smoke.test.ts inside it. Exit code 0 = passed.
import * as fs from 'fs';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';
import { TestRepo, makeTempDir, removeTree } from '../../core/test/helpers/testRepo';

function taskFile(prefix: string, ids: string[]): string {
  return `# ${prefix}\nprogram: ${prefix}\narea: A\ncreated: 2026-01-01\n\n${ids.map((id) => `## ${id} Title ${id}\nstatus: open\n`).join('\n')}`;
}

async function main(): Promise<void> {
  const ext = path.resolve(__dirname, '..', '..');
  const cleanups: Array<() => void> = [];
  let code = 1;
  try {
    // alpha: A1 closed by a Task: commit on main; beta: B1 open -> "Speclog: 1/2".
    const alpha = await TestRepo.create('alpha');
    cleanups.push(() => alpha.cleanup());
    await alpha.commit('Add tasks', { 'docs/tasks/a.md': taskFile('A', ['A1']) });
    await alpha.commit('Do A1\n\nTask: A1', { 'src/a.txt': 'a\n' });
    const beta = await TestRepo.create('beta');
    cleanups.push(() => beta.cleanup());
    await beta.commit('Add tasks', { 'docs/tasks/b.md': taskFile('B', ['B1']) });

    const work = makeTempDir('vscode');
    cleanups.push(() => removeTree(work));
    const wsFile = path.join(work, 'smoke.code-workspace');
    fs.writeFileSync(wsFile, JSON.stringify({
      folders: [{ path: alpha.dir }, { path: beta.dir }],
      settings: { 'speclog.fetch.enabled': false },
    }, null, 2));

    // Set when this runs from a VS Code terminal or extension host; it would start VS Code as plain Node.
    delete process.env.ELECTRON_RUN_AS_NODE;
    await runTests({
      extensionDevelopmentPath: ext,
      extensionTestsPath: path.join(__dirname, 'smoke.js'),
      launchArgs: [
        wsFile,
        '--disable-extensions',
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        `--user-data-dir=${path.join(work, 'user-data')}`,
      ],
    });
    code = 0;
  } catch (e) {
    console.error('Smoke test failed:', e instanceof Error ? e.message : e);
  } finally {
    for (const c of cleanups.reverse()) {
      try { c(); } catch { /* best effort */ }
    }
  }
  process.exit(code);
}

void main();
