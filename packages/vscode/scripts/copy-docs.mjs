// Copies the root LICENSE, README.md and CHANGELOG.md next to the extension manifest so that vsce
// packs them. The copies are git-ignored; the root files are the single source.
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.join(here, '..');
const root = path.join(pkg, '..', '..');
for (const name of ['LICENSE', 'README.md', 'CHANGELOG.md']) {
  fs.copyFileSync(path.join(root, name), path.join(pkg, name));
}
