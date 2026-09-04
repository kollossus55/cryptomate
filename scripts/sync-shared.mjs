#!/usr/bin/env node
/**
 * Copy shared/trading into each Base44 function that needs it.
 *
 * Why this exists: Base44 bundles each function directory independently, so a
 * function cannot import from ../../shared. The frontend reaches the same code
 * through the '@shared' Vite alias.
 *
 * The alternative — maintaining two copies of the signal engine — is how a
 * backtest and a live bot silently diverge. One source of truth, copied
 * mechanically at deploy time.
 *
 * Run before every deploy:  npm run sync:functions
 */

import { cp, rm, mkdir, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'shared', 'trading');

const targets = [
  'base44/functions/autoTradingWorker/shared',
  'base44/functions/technicalAnalysis/shared',
  'base44/functions/altcoinScannerWorker/shared',
];

const BANNER = `// GENERATED FILE — DO NOT EDIT.
// Copied from /shared/trading by scripts/sync-shared.mjs.
// Edit the source in /shared/trading and re-run: npm run sync:functions
`;

async function main() {
  if (!existsSync(source)) {
    console.error(`Source not found: ${source}`);
    process.exit(1);
  }

  const files = (await readdir(source)).filter((f) => f.endsWith('.js'));
  if (files.length === 0) {
    console.error('No .js modules found to sync.');
    process.exit(1);
  }

  for (const target of targets) {
    const dest = path.join(root, target);
    const functionDir = path.dirname(dest);

    if (!existsSync(functionDir)) {
      console.warn(`  skip  ${target} (function directory does not exist)`);
      continue;
    }

    await rm(dest, { recursive: true, force: true });
    await mkdir(dest, { recursive: true });
    await cp(source, dest, { recursive: true });

    // Stamp each copy so nobody edits the generated version by mistake.
    for (const file of files) {
      const filePath = path.join(dest, file);
      const contents = await import('node:fs/promises').then((fs) => fs.readFile(filePath, 'utf8'));
      await writeFile(filePath, BANNER + contents);
    }

    console.log(`  sync  ${target}  (${files.length} modules)`);
  }

  console.log('\nShared modules synced. Deploy the functions now.');
}

main().catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});