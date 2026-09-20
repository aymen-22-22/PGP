/** Loads .env.test before Nest reads process.env, so tests never touch the dev database. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const file = join(__dirname, '..', '.env.test');
for (const line of readFileSync(file, 'utf8').split('\n')) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
}
