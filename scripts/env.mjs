// Loads KEY=value lines from a local .env file (gitignored) into process.env.
// Existing environment variables win. No dependencies.
import { readFileSync } from 'node:fs';

try {
  const text = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env file: fine */ }
