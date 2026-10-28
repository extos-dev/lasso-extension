// Side-panel smoke test: DOM + mocked chrome.* APIs. No network, no real browser.
// The panel is an ES module, so this test installs jsdom globals before importing it.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
const here = path.dirname(fileURLToPath(import.meta.url));

const html = fs.readFileSync(path.join(here, '../src/sidepanel/index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'chrome-extension://test/sidepanel/index.html', runScripts: 'outside-only', pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'Node', 'URL', 'Blob', 'Event']) globalThis[k] = dom.window[k] ?? globalThis[k];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });

const root = { id: 0, tag: 'HTML', role: '', label: 'html', preview: '', depth: 0, childCount: 1, textLength: 10, wordCount: 2, linkCount: 0, bp: 0 };
const body = { id: 1, tag: 'BODY', role: '', label: 'body', preview: '', depth: 1, childCount: 1, textLength: 5, wordCount: 1, linkCount: 0, bp: 0 };
const p = { id: 2, tag: 'P', role: '', label: 'p', preview: 'hello', depth: 2, childCount: 0, textLength: 5, wordCount: 1, linkCount: 0, bp: 0 };
const catalog = ['article', 'table', 'list', 'chat', 'contact', 'text'].map((id, order) => ({ id, label: id[0].toUpperCase() + id.slice(1), order }));
const patterns = catalog.map((p) => ({ id: p.id, label: p.label, applicable: p.id === 'text', reason: p.id === 'text' ? '5 chars' : 'nope', meta: null }));
const textResult = { pattern: 'text', label: 'Text', ok: true, reason: '5 chars', summary: '5 chars', result: { pattern: 'text', kind: 'text', nodeId: 2, label: 'p', chars: 5 } };
const articleResult = { pattern: 'article', label: 'Article', ok: true, reason: '120 words', summary: '120 words', result: { pattern: 'article', kind: 'article', nodeId: 2, label: 'p', wordCount: 120, title: '' } };
let currentResults = [];
const stats = { startedAt: Date.now(), nodes: 3, snapshotMs: 12.3456, truncated: false, hiddenSkipped: 0, selections: 1, patternsApplied: 1, lastPattern: 'text' };
let active = false, selectedId = null, patternsReady = false;

const pageListeners = [];
const chrome = {
  runtime: {
    getManifest: () => ({ version: '0.2.0' }),
    onMessage: { addListener: (fn) => pageListeners.push(fn) },
    sendMessage: async (m) => {
      if (m.type === 'SITE_GET') return { ok: true, data: { name: 'Example', firstSeen: Date.now() - 1000, lastSeen: Date.now(), visits: 2, lastKind: 'inspect' } };
      if (m.type === 'SITE_TOUCH') return { ok: true, data: { previous: { visits: 2 }, current: { name: 'Example', visits: 3, lastSeen: Date.now(), lastKind: 'inspect' } } };
      if (m.type === 'SITES_CLEAR') return { ok: true, data: { ok: true } };
      throw new Error('unexpected background message ' + m.type);
    },
  },
  tabs: {
    query: async () => [{ id: 1, url: 'https://example.test/', title: 'Example' }],
    sendMessage: async (id, m) => {
      if (m.type === 'PING') return { ok: true, data: { version: '0.2.0' } };
      if (m.type === 'LIGHT') return { ok: true, data: { hostname: 'example.test', siteName: 'Example', favicon: '', url: 'https://example.test/' } };
      if (m.type === 'INSPECT_STATE') return { ok: true, data: active
        ? { active: true, url: 'https://example.test/', title: 'Example', root, rootChildren: [body], selectedId, selected: selectedId ? p : null, breadcrumb: selectedId ? [root, body, p] : [], patterns: selectedId && patternsReady ? patterns : [], patternsReady: selectedId ? patternsReady : false, lastResult: null, results: currentResults, catalog, stats }
        : { active: false, stats: null, selected: null, selectedId: null, breadcrumb: [], patterns: [], patternsReady: false, root: null, rootChildren: [], lastResult: null, results: [], catalog } };
      if (m.type === 'INSPECT_START') { active = true; patternsReady = false; return { ok: true, data: { active: true, url: 'https://example.test/', title: 'Example', root, rootChildren: [body], selectedId: null, selected: null, breadcrumb: [], patterns: [], patternsReady: false, lastResult: null, results: [], catalog, stats } }; }
      if (m.type === 'INSPECT_STOP') { active = false; selectedId = null; patternsReady = false; return { ok: true, data: { active: false, stats: null, selected: null, selectedId: null, breadcrumb: [], patterns: [], patternsReady: false, root: null, rootChildren: [], lastResult: null, results: [], catalog } }; }
      if (m.type === 'INSPECT_TREE') return { ok: true, data: { nodeId: m.nodeId, children: m.nodeId === 1 ? [p] : [], total: m.nodeId === 1 ? 1 : 0, truncated: false } };
      if (m.type === 'INSPECT_SELECT') { selectedId = m.nodeId; patternsReady = false; currentResults = []; return { ok: true, data: { selectedId: m.nodeId, selected: p, breadcrumb: [root, body, p], patterns: [], patternsReady: false, results: [], catalog, stats } }; }
      if (m.type === 'INSPECT_PATTERNS') { patternsReady = true; const want = Array.isArray(m.patterns) ? m.patterns : ['text']; currentResults = want.includes('article') ? [articleResult, textResult] : [textResult]; return { ok: true, data: { selectedId, selected: p, breadcrumb: [root, body, p], patterns: patterns.filter((x) => want.includes(x.id)), patternsReady: true, results: currentResults, catalog, stats } }; }
      if (m.type === 'INSPECT_RENDER') return { ok: true, data: { text: 'hello', mime: 'text/markdown', filename: 'example.test-text.md', chars: 5, tokenEstimate: 2, tokenEstimateNote: 'estimate (chars/4)' } };
      if (m.type === 'INSPECT_RENDER_ALL') return { ok: true, data: { items: currentResults.map((r) => ({ ...r, rendered: { text: r.pattern === 'article' ? 'article body' : 'hello', mime: 'text/markdown', filename: `example.test-${r.pattern}.md`, chars: r.pattern === 'article' ? 12 : 5, tokenEstimate: 3, tokenEstimateNote: 'estimate (chars/4)' } })) } };
      throw new Error('unexpected page message ' + m.type);
    },
    onActivated: { addListener: () => {} },
    onUpdated: { addListener: () => {} },
    onRemoved: { addListener: () => {} },
  },
  scripting: { executeScript: async () => {} },
};
globalThis.chrome = chrome;

const sleep = (ms = 25) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => dom.window.document.getElementById(id);
await import('../src/sidepanel/panel.js');
await sleep();

assert.equal($('siteName').textContent, 'Example');
assert.ok($('view-page').textContent.includes('2 visits'));
assert.ok($('view-page').textContent.includes('No saved extractions for this site yet.'));
assert.ok(!$('view-page').textContent.includes('Point at what you want'), 'the removed CTA card must stay removed');

// The local visit history can be cleared from the Page footnote.
[...dom.window.document.querySelectorAll('#view-page button')].find((b) => b.textContent === 'Clear all site history').click();
await sleep();
assert.ok($('view-page').textContent.includes('First visit to this site.'));

$('inspectToggle').click();
await sleep();
assert.equal($('inspectLabel').textContent, 'Inspecting');
assert.equal($('view-map').hidden, false);
assert.ok($('view-map').textContent.includes('Inspect mode is on'));
assert.ok($('view-map').textContent.includes('12 ms'), 'snapshot ms is rounded for display');
assert.ok(!$('view-map').textContent.includes('12.3456'), 'snapshot ms is not a raw float');

// Roving focus: exactly one row sits in the tab order (the root, until a selection).
const rows0 = [...$('view-map').querySelectorAll('.node-row')];
assert.ok(rows0.length >= 2, 'tree rendered');
assert.equal(rows0.filter((r) => r.getAttribute('tabindex') === '0').length, 1, 'exactly one row is tabbable');
assert.ok(rows0.every((r) => ['0', '-1'].includes(r.getAttribute('tabindex'))), 'rows are roving, not all tabbable');

// Hover sync must not rebuild the tree: the rendered row object has to survive.
const hoverRow = rows0.find((r) => r.dataset.nodeId === '1') || rows0[1];
for (const fn of pageListeners) fn({ lasso: true, type: 'NODE_HOVERED', id: Number(hoverRow.dataset.nodeId) }, { tab: { id: 1 } });
await sleep();
assert.equal(hoverRow.isConnected, true, 'hover must not detach the rendered tree');
assert.equal(hoverRow.classList.contains('hover'), true, 'hovered row gets the hover class');
for (const fn of pageListeners) fn({ lasso: true, type: 'NODE_HOVERED', id: null }, { tab: { id: 1 } });
await sleep();
assert.equal(hoverRow.isConnected, true, 'clearing hover keeps the same rows');
assert.equal(hoverRow.classList.contains('hover'), false, 'hover class clears');

for (const fn of pageListeners) fn({ lasso: true, type: 'NODE_SELECTED', selectedId: 2, selected: p, breadcrumb: [root, body, p], patterns: [], patternsReady: false, results: [], catalog, stats }, { tab: { id: 1 } });
await sleep();
assert.ok($('view-map').textContent.includes('hello'));
assert.ok($('view-map').textContent.includes('Choose patterns'));
assert.ok($('view-map').textContent.includes('Detect selected'));
const boxes = [...$('view-map').querySelectorAll('.pattern-picks input')];
assert.equal(boxes.length, 6);
assert.equal(boxes.find((b) => b.value === 'text').checked, true, 'Text is checked by default');
assert.equal(boxes.find((b) => b.value === 'article').checked, false);
boxes.find((b) => b.value === 'article').click();
await sleep();
const boxes2 = [...$('view-map').querySelectorAll('.pattern-picks input')];
assert.equal(boxes2.find((b) => b.value === 'article').checked, true);
assert.equal(boxes2.find((b) => b.value === 'text').checked, false, 'Article auto-unchecks Text');
currentResults = [articleResult, textResult];
for (const fn of pageListeners) fn({ lasso: true, type: 'PATTERNS_DETECTED', selectedId: 2, selected: p, breadcrumb: [root, body, p], patterns: [patterns[0]], patternsReady: true, results: [articleResult, textResult], catalog, stats }, { tab: { id: 1 } });
await sleep();
assert.equal($('view-output').hidden, false, 'multi results open Output directly');
assert.equal($('view-output').querySelectorAll('.out-card').length, 2);
assert.equal($('view-output').querySelectorAll('.out-card-body[hidden]').length, 2, 'cards start collapsed');
$('view-output').querySelectorAll('.out-card-head')[0].click();
await sleep();
assert.equal($('view-output').querySelectorAll('.out-card-body[hidden]').length, 1);
assert.ok($('view-output').textContent.includes('article body'));
$('view-output').querySelectorAll('.out-card-head')[1].click();
await sleep();
assert.equal($('view-output').querySelectorAll('.out-card-body[hidden]').length, 0);
assert.ok($('view-output').textContent.includes('hello'));

// Re-select and check the single-result path: result summary, then explicit Send.
await $('view-map').hidden && $('view-map').querySelector('.sel-card');
for (const fn of pageListeners) fn({ lasso: true, type: 'NODE_SELECTED', selectedId: 2, selected: p, breadcrumb: [root, body, p], patterns: [], patternsReady: false, results: [], catalog, stats }, { tab: { id: 1 } });
await sleep();
const textBox = [...$('view-map').querySelectorAll('.pattern-picks input')].find((b) => b.value === 'text');
assert.equal(textBox.checked, true);
$('view-map').querySelector('.detect-patterns').click();
await sleep();
assert.ok($('view-map').textContent.includes('Result'));
assert.ok($('view-map').textContent.includes('Send to Output'));
assert.equal($('view-output').hidden, true, 'single result is not sent automatically');
[...$('view-map').querySelectorAll('button')].find((b) => b.textContent === 'Send to Output').click();
await sleep();
assert.equal($('view-output').hidden, false);
assert.ok($('view-output').textContent.includes('hello'));

$('inspectToggle').click();
await sleep();
assert.equal($('inspectLabel').textContent, 'Inspect');
assert.equal($('view-page').hidden, false);
console.log('panel: 1 passed');
