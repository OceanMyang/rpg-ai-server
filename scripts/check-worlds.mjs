#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkWorlds } from '../src/check-worlds.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const reports = await checkWorlds(path.join(root, 'worlds'));

if (reports.length === 0) {
  console.log('No worlds found in worlds/.');
  process.exit(1);
}

let failed = 0;
for (const report of reports) {
  const { counts } = report;
  console.log(`\n${report.slug} — ${report.title}`);
  console.log(
    `  ${counts.files} files, ${counts.entities} entities, ${counts.players} player characters`
  );
  for (const warning of report.warnings) console.log(`  ! ${warning}`);
  for (const error of report.errors) console.log(`  ✗ ${error}`);
  if (report.errors.length === 0) console.log('  ✓ ready to play');
  else failed += 1;
}

console.log(
  `\n${reports.length} world${reports.length === 1 ? '' : 's'} checked, ${failed} with errors.`
);
process.exit(failed > 0 ? 1 : 0);
