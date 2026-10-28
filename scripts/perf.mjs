#!/usr/bin/env node
// Real-browser timing for the engine's main-thread work: snapshot, tree serialisation
// and scoped pattern detection at 1k / 5k / 25k nodes.
//
// This exists because jsdom has no layout and no real style engine, so it cannot
// support the MASTER_SPEC §12 budgets (p95 <= 150 ms at 5k; no task > 50 ms at 25k).
// It injects the shipped engine files in the same order the extension does, so the
// numbers are the real code paths — not a reimplementation.
//
// Usage: npm run perf [-- --runs=7] [--strict]
//   --strict  exit non-zero when a stated budget is missed (default: report only)
//
// Not part of `npm test`: timings depend on the machine and are not a pass/fail gate.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { CONTENT_FILES } from '../src/shared/content-files.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : dflt;
};
const RUNS = Math.max(3, arg('runs', 7));
const STRICT = process.argv.includes('--strict');

// Budgets as stated in docs/MASTER_SPEC.md §12.
const BUDGET = { p95At5k: 150, maxTaskAt25k: 50 };

/** A page with site chrome plus `items` repeated cards (5 elements each). */
function page(items) {
  const card = (i) => `<div class="card"><h3>Item ${i}</h3><p>Some descriptive sentence for item ${i} with enough text to be prose.</p><a href="/item/${i}">Details</a><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP" alt=""></div>`;
  return `<!doctype html><html><head><title>Perf ${items}</title><meta name="description" content="perf page"></head><body>
<header><nav><a href="/a">A</a><a href="/b">B</a><a href="/c">C</a></nav></header>
<main><article><h1>Perf page</h1>${Array.from({ length: items }, (_, i) => card(i)).join('\n')}</article></main>
<footer><p>Footer text</p></footer></body></html>`;
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const round = (n) => Math.round(n * 10) / 10;

const ENGINE = await Promise.all(
  CONTENT_FILES.map(async (f) => ({ path: f, code: await readFile(join(ROOT, f), 'utf8') })),
);

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page_ = await browser.newPage();
const rows = [];

const SCENARIOS = [1000, 5000, 25000];   // target node counts, not card counts
for (const target of SCENARIOS) {
  const items = Math.max(1, Math.round(target / 5));   // a card is ~5 elements
  await page_.setContent(page(items));
  for (const { code } of ENGINE) await page_.addScriptTag({ content: code });
  const measured = await page_.evaluate(async (runs) => {
    const L = globalThis.Lasso;
    const measure = (fn) => { const t0 = performance.now(); const v = fn(); return [performance.now() - t0, v]; };
    const snapshot = [], tree = [], detect = [];
    let tasks = 0, maxTask = 0;
    const supported = typeof PerformanceObserver !== 'undefined' && (PerformanceObserver.supportedEntryTypes || []).includes('longtask');
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) { tasks++; if (e.duration > maxTask) maxTask = e.duration; }
    });
    try { obs.observe({ entryTypes: ['longtask'] }); } catch (_) { /* not supported */ }
    let nodeCount = 0, lastLabel = '';
    for (let i = 0; i <= runs; i++) {                       // first pass warms up
      const [snapMs, snap] = measure(() => L.snapshot(document));
      // Expand the widest container, which is what a real tree expansion serialises.
      const wide = snap.byEl.get(document.querySelector('article') || document.body) || snap.root;
      const [treeMs] = measure(() => L.inspect.childrenOf(wide.id));
      if (!L.inspect.isActive()) L.inspect.start();
      const rootId = L.inspect.snapshot().root.id;
      const [detectMs, res] = measure(() => L.inspect.detectPatterns(rootId, ['article', 'table', 'list', 'chat', 'contact', 'text']));
      nodeCount = snap.nodes.length;
      lastLabel = res.results.map((r) => `${r.pattern}:${r.ok ? 'ok' : 'no'}`).join(' ');
      if (i > 0) { snapshot.push(snapMs); tree.push(treeMs); detect.push(detectMs); }
    }
    // Longtask entries are delivered to the observer asynchronously; yield so the
    // queued ones are counted before we stop observing.
    await new Promise((r) => setTimeout(r, 100));
    obs.disconnect();
    return { nodeCount, snapshot, tree, detect, tasks, maxTask, supported, lastLabel };
  }, RUNS);

  rows.push({
    requested: target,
    nodes: measured.nodeCount,
    snapshot: [round(pct(measured.snapshot, 50)), round(pct(measured.snapshot, 95))],
    tree: [round(pct(measured.tree, 50)), round(pct(measured.tree, 95))],
    detect: [round(pct(measured.detect, 50)), round(pct(measured.detect, 95))],
    // Every measured call runs synchronously, so its duration is a lower bound on the
    // longest main-thread task. The longtask observer is reported alongside but is not
    // trusted for the verdict (it reports 0 in some headless builds).
    longest: round(Math.max(...measured.snapshot, ...measured.tree, ...measured.detect)),
    tasks: measured.tasks,
    maxTask: round(measured.maxTask),
    supported: measured.supported,
    results: measured.lastLabel,
  });
}

await browser.close();

console.log(`\nLasso engine timings — headless Chromium, ${os.platform()} ${os.arch()}, ${os.cpus().length} cpus, runs=${RUNS} (+1 warmup)\n`);
console.log('  nodes   snapshot p50/p95   tree p50/p95   detect(6 patterns) p50/p95   longest block');
for (const r of rows) {
  console.log(
    `  ${String(r.nodes).padStart(5)}   ${`${r.snapshot[0]} / ${r.snapshot[1]}`.padStart(12)} ms   ` +
    `${`${r.tree[0]} / ${r.tree[1]}`.padStart(9)} ms   ${`${r.detect[0]} / ${r.detect[1]}`.padStart(20)} ms   ` +
    `${r.longest} ms`,
  );
}
const lt = rows[0];
console.log(`  longtask observer: ${lt.supported ? `supported, ${rows.map((r) => r.tasks).join('/')} entries counted (unreliable in headless; the column above is the lower bound)` : 'unsupported in this build'}`);

const at5k = rows.find((r) => r.requested === 5000) || rows[rows.length - 1];
const at25k = rows.find((r) => r.requested === 25000) || rows[rows.length - 1];
const failures = [];
if (at5k && at5k.snapshot[1] > BUDGET.p95At5k) failures.push(`snapshot p95 at 5k is ${at5k.snapshot[1]} ms (budget ${BUDGET.p95At5k} ms)`);
if (at25k && at25k.longest > BUDGET.maxTaskAt25k) failures.push(`longest synchronous block at 25k is ${at25k.longest} ms (budget ${BUDGET.maxTaskAt25k} ms): the engine yields between pipeline phases but never inside a snapshot or a pattern detection`);
console.log('');
if (failures.length) {
  for (const f of failures) console.log(`  MISS  ${f}`);
  console.log('\n  Note: the snapshot is the hot spot (one getComputedStyle per element plus a pre-order walk).');
  if (STRICT) process.exitCode = 1;
} else {
  console.log(`  MASTER_SPEC §12 budgets met (snapshot p95 <= ${BUDGET.p95At5k} ms at 5k; no task > ${BUDGET.maxTaskAt25k} ms at 25k).`);
}
console.log(`  Detection on the whole body returned: ${rows[rows.length - 1].results}`);
