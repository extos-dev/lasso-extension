#!/usr/bin/env node
// Assemble the unpacked extension into dist/. No bundler: copies src/ verbatim.
// Usage: node scripts/build.mjs [output-dir]
import { cp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url.split('?')[0])));
const OUT = process.argv[2] || join(ROOT, 'dist');

async function walk(dir, base = dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p, base));
    else if (e.isFile()) out.push({ src: p, rel: p.slice(base.length + 1) });
  }
  return out;
}

async function main() {
  try { await rm(OUT, { recursive: true, force: true }); } catch (_) {}
  await mkdir(OUT, { recursive: true });

  // Copy src/ contents to OUT root (so manifest paths like sidepanel/index.html resolve).
  for (const { src, rel } of await walk(join(ROOT, 'src'))) {
    const dest = join(OUT, rel);
    await mkdir(dirname(dest), { recursive: true });
    await cp(src, dest);
  }

  // Copy assets/ as-is.
  for (const { src, rel } of await walk(join(ROOT, 'assets'))) {
    const dest = join(OUT, 'assets', rel);
    await mkdir(dirname(dest), { recursive: true });
    await cp(src, dest);
  }

  // Manifest: drop the src/ prefix from every referenced path.
  const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
  const strip = (p) => (typeof p === 'string' && p.startsWith('src/') ? p.slice(4) : p);
  const map = (o) => {
    if (Array.isArray(o)) return o.map(map);
    if (o && typeof o === 'object') {
      const r = {};
      for (const [k, v] of Object.entries(o)) r[k] = map(v);
      return r;
    }
    return o;
  };
  const out = map(manifest);
  const outStr = JSON.stringify(out, null, 2).replace(/"src\/([^"]+)"/g, '"$1"');
  await writeFile(join(OUT, 'manifest.json'), outStr + '\n');

  // Rewrite shared/content-files.js so chrome.scripting.executeScript paths resolve in dist/.
  const cfPath = join(OUT, 'shared', 'content-files.js');
  const cf = await readFile(cfPath, 'utf8');
  await writeFile(cfPath, cf.replace(/'src\/content\//g, "'content/"));

  console.log(`Built ${OUT}`);
  const count = (await walk(OUT)).length;
  console.log(`  ${count} files`);
}
main().catch((e) => { console.error(e); process.exit(1); });