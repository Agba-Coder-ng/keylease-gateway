import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const deploymentPath = join(scriptDir, '..', 'deployments.json');
const tag = process.argv[2];

if (!tag) {
  throw new Error('Usage: node scripts/create-release-notes.mjs <tag>');
}

const deployment = JSON.parse(await readFile(deploymentPath, 'utf8'));
const required = ['network', 'contractId', 'escrowToken'];
for (const field of required) {
  if (typeof deployment[field] !== 'string' || deployment[field].length === 0) {
    throw new Error(`deployments.json is missing a valid "${field}" value`);
  }
}

process.stdout.write(`# keylease-gateway ${tag}\n\n`);
process.stdout.write('## Deployed contract addresses\n\n');
process.stdout.write(`- Network: \`${deployment.network}\`\n`);
process.stdout.write(`- keylease-core: \`${deployment.contractId}\`\n`);
process.stdout.write(`- Escrow token (SAC): \`${deployment.escrowToken}\`\n`);
