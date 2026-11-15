// Release dry run: asks Open VSX for a trusted publishing token for this extension the same way
// `ovsx publish --trusted-publishing` does, without publishing anything. Exits non-zero when the
// trusted publisher is not set up (wrong repository, workflow file or namespace) or when the job
// lacks the `id-token: write` permission. Runs only on GitHub Actions.
//
// Usage: node scripts/check-ovsx-trusted-publisher.cjs packages/vscode/package.json
'use strict';

const fs = require('node:fs');
const { Registry } = require('ovsx/lib/registry');
const { getTrustedPublishingToken } = require('ovsx/lib/trusted-publishing');

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) throw new Error('Usage: check-ovsx-trusted-publisher.cjs <package.json>');
  const { publisher, name } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const registry = new Registry();
  // The token is short-lived and is never printed or stored.
  await getTrustedPublishingToken(registry, publisher, name, { trustedPublishing: true });
  console.log(`Open VSX trusted publisher is set up for ${publisher}.${name}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
