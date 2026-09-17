// Compiles notes/*.md into data/notes.json. Runs as the Netlify build command,
// so a pushed note is live on the next deploy. Files starting with "_" are ignored.
// Front matter (required): title, date (YYYY-MM-DD). Optional: summary, markets, draft.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function parseNote(filename, text) {
  const slug = filename.replace(/\.md$/, '');
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`${filename}: use lowercase letters, numbers and dashes only (e.g. 2026-09-18-barge-rates.md)`);
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`${filename}: missing front matter block (--- title / date ---)`);
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    meta[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  if (!meta.title) throw new Error(`${filename}: front matter needs a title`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date || '')) throw new Error(`${filename}: front matter needs date: YYYY-MM-DD`);
  return {
    slug,
    title: meta.title,
    date: meta.date,
    summary: meta.summary || '',
    markets: (meta.markets || '').split(',').map((s) => s.trim()).filter(Boolean),
    draft: /^(true|yes)$/i.test(meta.draft || ''),
    body: m[2].trim(),
  };
}

async function main() {
  const dir = new URL('../notes/', import.meta.url);
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.md') && !f.startsWith('_'));
  const notes = [];
  for (const f of files) {
    const note = parseNote(f, await readFile(new URL(f, dir), 'utf8'));
    if (note.draft) { console.log(`  skip draft ${f}`); continue; }
    if (note.body.includes('UNVERIFIED-CONTENT')) throw new Error(`${f}: still contains the UNVERIFIED-CONTENT warning from the digest checks. Fix the flagged issues and delete that block before publishing.`);
    notes.push(note);
  }
  notes.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(new URL('../data/notes.json', import.meta.url), JSON.stringify({ updated: new Date().toISOString(), notes }));
  console.log(`notes.json written with ${notes.length} note(s)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`NOTES BUILD FAILED\n${e.message}`); process.exit(1); });
}
