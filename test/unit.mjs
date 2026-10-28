import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { load } from './run-fixtures.mjs';
import { isPermissionError, isRestricted, restrictedMessage } from '../src/sidepanel/api.js';
const here = path.dirname(fileURLToPath(import.meta.url));
let n = 0; const t = async (name, fn) => { try { await fn(); n++; console.log('  ✓ ' + name); } catch (e) { console.log('  ✗ ' + name + '\n    ' + (e.message || e)); process.exitCode = 1; } };
const w = await load('<!doctype html><body><p>x</p></body>');
const L = w.Lasso;

await t('every URL rule matches its own sample', () => { for (const r of L.classify.URL_RULES) assert.ok(r.re.test(r.sample), `${r.cls} ${r.re} !~ ${r.sample}`); });
await t('CSV quotes commas, quotes and newlines (RFC 4180)', () => assert.equal(L.toCsv(['a', 'b'], [['x,y', 'he said "hi"'], ['l1\nl2', '']]), 'a,b\r\n"x,y","he said ""hi"""\r\n"l1\nl2",'));
await t('CSV neutralizes spreadsheet formulas but keeps numbers', () => {
  assert.equal(L.toCsv(['x'], [['=1+1']]), "x\r\n'=1+1");
  assert.equal(L.toCsv(['x'], [['@SUM(A1)']]), "x\r\n'@SUM(A1)");
  assert.equal(L.toCsv(['x'], [[' =1+1']]), "x\r\n' =1+1");
  assert.equal(L.toCsv(['x'], [['-1+1']]), "x\r\n'-1+1");
  assert.equal(L.toCsv(['x'], [['-12.5']]), 'x\r\n-12.5');
  assert.equal(L.toCsv(['x'], [['+15551234567']]), 'x\r\n+15551234567');
});
await t('hashed class names are not stable tokens', () => { for (const h of ['css-1x2y3z', 'sc-bdVaJa', '_3xk9Qa', 'a1b2c3d4', 'fa7b3c']) assert.ok(L.util.isHashy(h), h); for (const ok of ['product-card', 'post', 'price', 'feedback', 'decade', 'defaced', 'col12md']) assert.ok(!L.util.isHashy(ok), ok); });
await t('boilerplate tokens match whole tokens only (no "ad" inside "head/headline/author")', async () => {
  const w2 = await load('<body><div class="headline author sponsored-by-author">' + 'word '.repeat(80) + '</div><div class="ad-slot">AD</div></body>');
  const s = w2.Lasso.snapshot(w2.document); const [a, b] = [1, 2].map((i) => s.nodes[i]);
  assert.equal(a.bp, 0); assert.ok(b.bp >= .8);
});
await t('hidden text never reaches textOf', async () => {
  const w2 = await load('<body><p>visible</p><p style="display:none">SECRET</p><p hidden>SECRET2</p><p style="opacity:0">SECRET4</p><p style="content-visibility:hidden">SECRET5</p><div id="vh" style="visibility:hidden">SECRET3 <span style="visibility:visible">VISIBLECHILD</span></div></body>');
  const s = w2.Lasso.snapshot(w2.document); assert.equal(w2.Lasso.textOf(s, s.root.id), 'visible VISIBLECHILD');
});
await t('link density is computed on FULL text (long link-heavy paragraph)', async () => {
  const w2 = await load('<body><p>' + '<a href="/x">link text here</a> '.repeat(40) + 'tail</p></body>');
  const s = w2.Lasso.snapshot(w2.document); assert.ok(s.root.stats.linkDensity > .9, String(s.root.stats.linkDensity));
});
await t('open shadow roots are traversed', async () => {
  const w2 = await load('<body><div id="h"></div></body>'); const r = w2.document.getElementById('h').attachShadow({ mode: 'open' }); r.innerHTML = '<p>inside shadow</p>';
  const s = w2.Lasso.snapshot(w2.document); assert.ok(w2.Lasso.textOf(s, s.root.id).includes('inside shadow'));
});
await t('node cap sets truncated instead of throwing', async () => {
  const w2 = await load('<body>' + '<p>x</p>'.repeat(300) + '</body>'); const s = w2.Lasso.snapshot(w2.document, { maxNodes: 50 }); assert.ok(s.truncated); assert.equal(s.nodes.length, 50);
});
await t('snapshot does not mutate the page', async () => {
  const html = fs.readFileSync(path.join(here, 'fixtures/article-semantic.html'), 'utf8'); const w2 = await load(html);
  const before = w2.document.documentElement.outerHTML; await w2.Lasso.analyze(); assert.equal(w2.document.documentElement.outerHTML, before);
});
await t('analysis is deterministic', async () => {
  const html = fs.readFileSync(path.join(here, 'fixtures/grid-products.html'), 'utf8');
  const strip = (r) => JSON.stringify(r, (k, v) => (k === 'timings' || k === 'totalMs' ? undefined : v));
  assert.equal(strip(await (await load(html)).Lasso.analyze()), strip(await (await load(html)).Lasso.analyze()));
});
await t('classification distribution sums to ~1 and is flagged uncalibrated', async () => {
  const r = await (await load(fs.readFileSync(path.join(here, 'fixtures/login.html'), 'utf8'))).Lasso.analyze();
  const sum = r.classification.distribution.reduce((a, d) => a + d.p, 0); assert.ok(Math.abs(sum - 1) < .05, sum); assert.equal(r.classification.calibrated, false);
});
await t('pipeline time grows roughly linearly (1k -> 4k elements)', async () => {
  const mk = (k) => '<body><div>' + Array.from({ length: k }, (_, i) => `<div class="c${i % 7}"><h3>T${i}</h3><p>some text ${i}</p></div>`).join('') + '</div></body>';
  const run = async (k) => { const w2 = await load(mk(k)); const t0 = Date.now(); await w2.Lasso.analyze(); return Date.now() - t0; };
  await run(200); const a = Math.max(1, await run(1000)), b = await run(4000); assert.ok(b / a < 9, `1k=${a}ms 4k=${b}ms ratio ${(b / a).toFixed(1)}`);
});
const inspectId = (w, sel) => {
  const s = w.Lasso.inspect.snapshot(); const el = w.document.querySelector(sel);
  assert.ok(el, 'missing element ' + sel); const n = s.byEl.get(el); assert.ok(n, 'element not in snapshot ' + sel); return n.id;
};
/** Run one pattern through the shipped selected-only detection entry point. */
const detectOne = (w, id, pattern) => {
  const r = w.Lasso.inspect.detectPatterns(id, [pattern]);
  assert.equal(r.results.length, 1, 'one result for ' + pattern);
  return r.results[0];
};

await t('inspect starts per document and stop clears the session', async () => {
  const a = await load('<body><p>hello</p><p>world</p></body>');
  assert.equal(a.Lasso.inspect.isActive(), false);
  a.document.body.insertAdjacentHTML('beforeend', '<div data-lasso-overlay></div>');
  const info = a.Lasso.inspect.start();
  a.Lasso.overlay.inspectStart();
  assert.equal(a.document.querySelectorAll('[data-lasso-overlay]').length, 1);
  assert.equal(info.active, true); assert.ok(info.root); assert.ok(info.stats.nodes >= 3);
  assert.ok(info.rootChildren.length >= 1);
  const b = await load('<body><p>other</p></body>');
  assert.equal(b.Lasso.inspect.isActive(), false);
  const stopped = a.Lasso.inspect.stop();
  assert.equal(stopped.active, false); assert.equal(a.Lasso.inspect.snapshot(), null);
  assert.equal(a.Lasso.inspect.lastResult(), null);
});

await t('inspect tree is lazy, selectable and counted', async () => {
  const w = await load('<body><div id="a"><p>one</p><p>two</p></div></body>');
  const info = w.Lasso.inspect.start();
  const kids = w.Lasso.inspect.childrenOf(info.root.id);
  assert.ok(kids.children.length >= 1); assert.equal(kids.total, info.rootChildren.length);
  const first = kids.children.find((c) => c.id !== info.root.id) || kids.children[0];
  assert.ok(first.label); assert.ok(first.childCount >= 0);
  const sel = w.Lasso.inspect.select(first.id);
  assert.equal(sel.selectedId, first.id); assert.ok(sel.breadcrumb.length >= 2);
  assert.equal(sel.stats.selections, 1); assert.equal(sel.patterns.length, 0); assert.equal(sel.patternsReady, false);
  const detected = w.Lasso.inspect.detectPatterns(first.id);
  assert.equal(detected.patternsReady, true); assert.equal(detected.patterns.length, 1);
  assert.equal(detected.patterns[0].id, 'text'); assert.match(detected.results[0].summary, /\d+ chars/);
  const two = w.Lasso.inspect.detectPatterns(first.id, ['text', 'article']);
  assert.equal(two.results.length, 2); assert.ok(two.results.some((r) => r.pattern === 'article'));
});

await t('inspect article pattern is scoped and omits boilerplate', async () => {
  const w = await load(fs.readFileSync(path.join(here, 'fixtures/article-semantic.html'), 'utf8'));
  w.Lasso.inspect.start(); const id = inspectId(w, 'article');
  const res = detectOne(w, id, 'article');
  assert.equal(res.result.kind, 'article'); assert.ok(res.result.wordCount > 100);
  const md = w.Lasso.output.renderInspect('markdown').text;
  assert.ok(md.includes('The numbers')); assert.ok(!md.includes('FOOTERTEXT'));
  assert.ok(!md.includes('Related story one'));
  const d = w.Lasso.inspect.detectPatterns(id, ['article', 'text']);
  assert.equal(d.results.length, 2);
  const multi = w.Lasso.output.renderInspectResults('markdown');
  assert.equal(multi.items.length, 2);
  assert.ok(multi.items.some((x) => x.ok && x.rendered.text.includes('The numbers')));
});

await t('inspect article pattern does not cross into a sibling region', async () => {
  const w = await load('<body><main>' +
    '<article><h1>Other article</h1><p>' + 'Article prose sentence. '.repeat(40) + '</p></article>' +
    '<table id="t"><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>' +
    '</main></body>');
  w.Lasso.inspect.start();
  const table = inspectId(w, '#t');
  const tablePatterns = w.Lasso.inspect.detectPatterns(table, ['article', 'table']).results;
  assert.equal(tablePatterns.find((p) => p.pattern === 'article').ok, false);
  assert.equal(tablePatterns.find((p) => p.pattern === 'table').ok, true);
  const main = inspectId(w, 'main');
  assert.equal(detectOne(w, main, 'article').ok, true);
});

await t('inspect table pattern returns rows and columns', async () => {
  const w = await load(fs.readFileSync(path.join(here, 'fixtures/table-semantic.html'), 'utf8'));
  w.Lasso.inspect.start(); const id = inspectId(w, 'table');
  const res = detectOne(w, id, 'table');
  assert.equal(res.result.kind, 'table');
  const json = JSON.parse(w.Lasso.output.renderInspect('json').text);
  assert.equal(json.rows.length, 8); assert.equal(json.headers.length, 4);
});

await t('inspect list pattern returns repeated records', async () => {
  const w = await load(fs.readFileSync(path.join(here, 'fixtures/grid-products.html'), 'utf8'));
  w.Lasso.inspect.start();  const id = inspectId(w, '.css-grid88');
  const res = detectOne(w, id, 'list');
  assert.equal(res.result.kind, 'record_list'); assert.equal(res.result.count, 12);
  const json = JSON.parse(w.Lasso.output.renderInspect('json').text);
  assert.equal(json.count, 12); assert.ok(json.items.some((i) => i.title === 'Product Name 5'));
});

await t('inspect text pattern copies only the selected subtree', async () => {
  const w = await load('<body><div id="x">Hello <b>world</b></div><p>outside</p></body>');
  w.Lasso.inspect.start();  const id = inspectId(w, '#x');
  detectOne(w, id, 'text');
  const md = w.Lasso.output.renderInspect('markdown').text;
  assert.equal(md, 'Hello world'); assert.ok(!md.includes('outside'));
});
await t('inspect chat pattern finds messages and roles', async () => {
  const w = await load('<body><main><div id="chat">' +
    '<div class="msg" data-message-author-role="user"><p>How do I export a table from this page? I want clean CSV.</p></div>' +
    '<div class="msg" data-message-author-role="assistant"><p>Select the table, right-click, choose Table, then pick CSV in Output.</p></div>' +
    '<div class="msg" data-message-author-role="user"><p>Thanks. Can I keep the header row when I download it?</p></div>' +
    '</div></main></body>');
  w.Lasso.inspect.start();  const id = inspectId(w, '#chat');
  const res = detectOne(w, id, 'chat');
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.result.kind, 'chat'); assert.equal(res.result.count, 3);
  assert.equal(res.result.messages.map((m) => m.role).join(','), 'user,assistant,user');
  const out = w.Lasso.output.renderInspect('markdown');
  assert.ok(out.text.includes('**assistant:**')); assert.ok(out.text.includes('clean CSV'));
});

await t('inspect contact pattern reads footer contact details', async () => {
  const w = await load('<body><footer id="f"><h2>Contact</h2><h3>Acme Studio</h3>' +
    '<a href="mailto:hello@acme.test">hello@acme.test</a>' +
    '<a href="tel:+33123456789">+33 1 23 45 67 89</a>' +
    '<address>1 Main St, Springfield</address>' +
    '<a href="https://acme.test">acme.test</a></footer></body>');
  w.Lasso.inspect.start(); const id = inspectId(w, '#f');
  const res = detectOne(w, id, 'contact');
  assert.equal(res.result.kind, 'contact');
  assert.equal(res.result.name, 'Acme Studio');
  assert.ok(res.result.emails.includes('hello@acme.test'));
  assert.ok(res.result.phones.includes('+33 1 23 45 67 89'), JSON.stringify(res.result.phones));
  assert.ok(res.result.addresses[0].includes('Main St'));
  assert.ok(res.result.links.some((l) => l.url === 'mailto:hello@acme.test'));
  const out = w.Lasso.output.renderInspect('json');
  assert.ok(out.text.includes('"kind": "contact"'));
});

await t('inspect pattern registry accepts extensions', async () => {
  const w = await load('<body><div id="x"><p>one</p></div></body>');
  w.Lasso.inspect.start(); const id = inspectId(w, '#x');
  w.Lasso.inspect.registerPattern({
    id: 'custom', label: 'Custom', order: 5,
    detect: () => ({ ok: true, nodeId: id, reason: 'always', meta: {} }),
    build: () => ({ kind: 'text', nodeId: id, text: 'custom' }),
  });
  assert.ok(w.Lasso.inspect.patternDefs().some((p) => p.id === 'custom'));
  const custom = detectOne(w, id, 'custom');
  assert.equal(custom.ok, true, custom.reason);
  assert.equal(custom.result.kind, 'text');
});


await t('inspect rejects unknown patterns and stale ids', async () => {
  const w = await load('<body><p>one</p></body>');
  w.Lasso.inspect.start(); const id = inspectId(w, 'p');
  assert.throws(() => w.Lasso.inspect.registerPattern({ id: 'NOPE', detect: () => ({ ok: true }) }), /lowercase id/);
  assert.equal(w.Lasso.inspect.detectPatterns(id, ['nope']).results.length, 0, 'unknown ids are ignored, never probed');
  assert.throws(() => w.Lasso.inspect.select(999999), /no longer/);
  w.Lasso.inspect.stop();
  assert.throws(() => w.Lasso.inspect.detectPatterns(id, ['text']), /no longer/);
  assert.throws(() => w.Lasso.inspect.select(id), /no longer/);
});

await t('site touches serialize so concurrent panels do not lose writes', async () => {
  const store = {}, listeners = {};
  const chromeMock = {
    sidePanel: { setPanelBehavior: async () => {} },
    runtime: {
      onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} },
      onMessage: { addListener: (fn) => { listeners.message = fn; } },
    },
    storage: { local: {
      get: async (k) => ({ [k]: store[k] }),
      set: async (o) => { Object.assign(store, o); },
      remove: async (k) => { delete store[k]; },
    } },
  };
  new Function('chrome', fs.readFileSync(path.join(here, '../src/background/service-worker.js'), 'utf8'))(chromeMock);
  const send = (msg) => new Promise((resolve) => listeners.message({ lasso: true, ...msg }, {}, resolve));
  await Promise.all(Array.from({ length: 12 }, (_, i) => send({ type: 'SITE_TOUCH', hostname: 'host' + i, name: 'H' + i, kind: 'inspect' })));
  assert.equal(Object.keys(store.sites).length, 12);
  assert.ok(Object.values(store.sites).every((s) => s.visits === 1));
});

await t('permission errors are classified for clear messages', () => {
  assert.equal(isPermissionError(new Error('Cannot access contents of the page')), true);
  assert.equal(isPermissionError(new Error('Missing host permission for the tab')), true);
  assert.equal(isPermissionError(new Error('No response from page')), false);
});

await t('empty and browser-page URLs are restricted, regular web pages are not', () => {
  assert.equal(isRestricted(''), true);
  assert.equal(isRestricted('about:blank'), true);
  assert.equal(isRestricted('chrome://newtab'), true);
  assert.equal(isRestricted('file:///tmp/page.html'), true);
  assert.equal(isRestricted('https://example.test/'), false);
  assert.match(restrictedMessage('file:///tmp/page.html'), /file:\/\/ pages/);
  assert.match(restrictedMessage('chrome://newtab'), /browser pages or the Web Store/);
});

await t('one shared summary wording is used by panel, tree and overlay', async () => {
  const w = await load('<body><div id="x"><p>Hello there</p></div></body>');
  w.Lasso.inspect.start(); const id = inspectId(w, '#x');
  const r = detectOne(w, id, 'text');
  assert.equal(r.summary, w.Lasso.inspect.summary(r.result), 'detectPatterns summary and inspect.summary agree');
  assert.equal(w.Lasso.inspect.summary({ kind: 'chat', count: 1 }), '1 message');
  assert.equal(w.Lasso.inspect.summary({ kind: 'contact', emails: ['a@b.c'], phones: [] }), '1 email · 0 phones');
  assert.equal(w.Lasso.inspect.summary({ kind: 'article', wordCount: 1234 }), '1,234 words');
  assert.equal(w.Lasso.inspect.nodeLabel({ tag: 'DIV', cls: 'css-1x2y3z card', el: { id: '' } }), 'div.card', 'hashed classes never reach a label');
});

await t('body state classes do not poison content boilerplate', async () => {
  const w2 = await load('<body class="modal-open"><main><article id="a"><h1>Title</h1>' + '<p>' + 'This is a long paragraph about a real topic with enough prose to pass the article threshold. '.repeat(9) + '</p>'.repeat(6) + '</article></main></body>');
  const s = w2.Lasso.snapshot(w2.document); assert.equal(s.root.bp, 0); assert.equal(s.byEl.get(w2.document.querySelector('#a')).bp, 0);
  w2.Lasso.inspect.start(); const id = inspectId(w2, '#a');
  const res = detectOne(w2, id, 'article');
  assert.equal(res.result.kind, 'article'); assert.ok(w2.Lasso.output.renderInspect('markdown').text.includes('long paragraph'));
});

await t('markdown keeps snake_case, escapes only syntax, and fences code', async () => {
  const w2 = await load('<body><article id="a"><p>snake_case and *stars* and [brackets]</p><p>Use <code>a`b</code> and <code>`x`</code>.</p><pre><code class="language-js">const x = 1;</code></pre></article></body>');
  const s = w2.Lasso.snapshot(w2.document); const md = w2.Lasso.toMarkdown(s, s.byEl.get(w2.document.querySelector('#a')).id);
  assert.ok(md.includes('snake_case')); assert.ok(md.includes('\\*stars\\*')); assert.ok(md.includes('\\[brackets\\]'));
  assert.ok(md.includes('``a`b``')); assert.ok(md.includes('```js\nconst x = 1;\n```'));
});

await t('markdown preserves preformatted whitespace inside code fences', async () => {
  const w2 = await load('<body><article id="a"><p>Intro</p><pre><code class="language-js">function tide() {\n  return 1;\n}</code></pre></article></body>');
  const s = w2.Lasso.snapshot(w2.document); const md = w2.Lasso.toMarkdown(s, s.byEl.get(w2.document.querySelector('#a')).id);
  assert.ok(md.includes('```js\nfunction tide() {\n  return 1;\n}\n```'), md);
});

await t('markdown keeps nested list items nested instead of flattening them', async () => {
  const w2 = await load('<body><article id="a"><ul><li>Parent one<ul><li>Child one</li><li>Child two</li></ul></li><li>Parent two</li></ul></article></body>');
  const s = w2.Lasso.snapshot(w2.document); const md = w2.Lasso.toMarkdown(s, s.byEl.get(w2.document.querySelector('#a')).id);
  assert.ok(md.includes('- Parent one\n  - Child one\n  - Child two'), md);
  assert.ok(md.includes('- Parent two'), md);
});

await t('markdown separates adjacent links so they cannot glue together', async () => {
  const w2 = await load('<body><div id="cards"><a href="/one">Card one</a><a href="/two">Card two</a></div></body>');
  const s = w2.Lasso.snapshot(w2.document); const md = w2.Lasso.toMarkdown(s, s.byEl.get(w2.document.querySelector('#cards')).id);
  assert.ok(md.includes('[Card one](https://example.test/one) [Card two](https://example.test/two)'), md);
});

await t('inspect article hints stay inside the selected region', async () => {
  const w = await load('<body><article id="main"><h1>MAIN HEADLINE</h1><p class="byline">By Main Author</p><p>' + 'Main article prose. '.repeat(20) + '</p></article><div id="comments"><p>' + 'Comment prose sentence about the page. '.repeat(10) + '</p></div></body>');
  w.Lasso.inspect.start(); const id = inspectId(w, '#comments');
  const res = detectOne(w, id, 'article');
  assert.equal(res.ok, true, res.reason);
  const md = w.Lasso.output.renderInspect('markdown').text;
  assert.ok(md.includes('Comment prose'), md);
  assert.ok(!md.includes('MAIN HEADLINE'), md);
  assert.ok(!md.includes('Main Author'), md);
});

await t('inspect can extract a reading pane inside a dialog', async () => {
  const w = await load('<body><div id="d" role="dialog" aria-modal="true"><div class="modal-content"><h2>Modal story</h2><p>' + 'Dialog prose sentence. '.repeat(12) + '</p><div class="cookie-banner"><p>COOKIETEXT</p></div></div></div></body>');
  w.Lasso.inspect.start(); const id = inspectId(w, '#d');
  const res = detectOne(w, id, 'article');
  assert.equal(res.ok, true, res.reason);
  const md = w.Lasso.output.renderInspect('markdown').text;
  assert.ok(md.includes('Modal story'), md);
  assert.ok(md.includes('Dialog prose'), md);
  assert.ok(!md.includes('COOKIETEXT'), md);
});

await t('locator set builder generates ordered strategies and signature', async () => {
  const w = await load('<body><main><article id="main-art" class="post-card _hash123"><h1 data-testid="art-title">Title</h1></article></main></body>');
  w.Lasso.inspect.start();
  const snap = w.Lasso.inspect.snapshot();
  const artId = inspectId(w, '#main-art');
  const locSet = w.Lasso.locator.build(snap, artId);
  assert.ok(locSet.strategies.some((s) => s.type === 'semantic' && s.value === 'article'));
  assert.ok(locSet.strategies.some((s) => s.type === 'id' && s.value === '#main-art'));
  assert.ok(locSet.strategies.some((s) => s.type === 'css_class' && s.value === 'article.post-card'));
  assert.ok(locSet.signature.tag === 'ARTICLE');
  const res = w.Lasso.locator.resolve(snap, locSet);
  assert.equal(res.matched, true);
  assert.equal(res.nodeId, artId);
  assert.equal(res.health, 'healthy');
});

await t('locator resolver uses fallback strategies when attributes change', async () => {
  const w1 = await load('<body><div id="target" class="card-item">Item</div></body>');
  w1.Lasso.inspect.start();
  const snap1 = w1.Lasso.inspect.snapshot();
  const id1 = inspectId(w1, '#target');
  const locSet = w1.Lasso.locator.build(snap1, id1);

  // Mutate ID on new DOM document
  const w2 = await load('<body><div id="changed-id" class="card-item">Item</div></body>');
  w2.Lasso.inspect.start();
  const snap2 = w2.Lasso.inspect.snapshot();
  const resFallback = w2.Lasso.locator.resolve(snap2, locSet);
  assert.equal(resFallback.matched, true);
  assert.equal(resFallback.health, 'degraded');
  assert.match(resFallback.reason, /fallback/);
});

await t('schema validator validates schema shape and rejects invalid schema', () => {
  assert.equal(L.schema.validate(null).valid, false);
  assert.equal(L.schema.validate({ schemaVersion: 2 }).valid, false);
  const ok = L.schema.validate({
    schemaVersion: 1, id: 's1', name: 'Test',
    match: { domain: 'test.com' }, kind: 'article',
    container: { strategies: [{ type: 'semantic', value: 'article' }] }
  });
  assert.equal(ok.valid, true);
});

await t('schema URL matcher ranks exact path over domain match', () => {
  const sDomain = { match: { domain: 'example.com' } };
  const sPath = { match: { domain: 'example.com', pathPattern: '/blog/*' } };
  assert.equal(L.schema.matchUrl(sDomain, 'https://example.com/blog/p1').score, 1);
  assert.equal(L.schema.matchUrl(sPath, 'https://example.com/blog/p1').score, 2);
  assert.equal(L.schema.matchUrl(sPath, 'https://example.com/about').matches, false);
});

await t('schema runner replays schema and evaluates health', async () => {
  const w = await load(fs.readFileSync(path.join(here, 'fixtures/article-semantic.html'), 'utf8'));
  w.Lasso.inspect.start();
  const snap = w.Lasso.inspect.snapshot();
  const artId = inspectId(w, 'article');
  const locSet = w.Lasso.locator.build(snap, artId);
  const schema = {
    schemaVersion: 1, id: 'art_s1', name: 'Article Schema',
    match: { domain: '127.0.0.1' }, kind: 'article', container: locSet
  };
  const runRes = w.Lasso.schema.run(snap, schema);
  assert.equal(runRes.ok, true);
  assert.equal(runRes.health, 'healthy');
  assert.equal(runRes.data.kind, 'article');
});

await t('inspect contact ignores hidden and aria-hidden details', async () => {
  const w = await load('<body><footer id="f"><h2>Contact</h2><h3>Acme Studio</h3>' +
    '<a href="mailto:hello@acme.test">hello@acme.test</a>' +
    '<address>1 Main St, Springfield</address>' +
    '<div style="display:none"><a href="mailto:hidden@acme.test">hidden@acme.test</a><address>HIDDENADDR</address><span>+1 555 000 0000</span></div>' +
    '<div aria-hidden="true"><a href="mailto:aria@acme.test">aria@acme.test</a><span>ARIAHIDDEN</span></div>' +
    '</footer></body>');
  w.Lasso.inspect.start(); const id = inspectId(w, '#f');
  const res = detectOne(w, id, 'contact');
  assert.equal(res.result.name, 'Acme Studio');
  assert.equal(res.result.emails.join(','), 'hello@acme.test');
  assert.ok(!res.result.phones.some((p) => p.includes('555')));
  const json = JSON.stringify(res.result);
  assert.ok(!json.includes('HIDDEN'), json);
  assert.ok(!json.includes('ARIAHIDDEN'), json);
  assert.ok(!res.result.links.some((l) => l.url.includes('hidden') || l.url.includes('aria')), json);
});

await t('lazy images prefer real sources and resolve relative URLs', async () => {
  const w2 = await load('<body><article id="a"><p><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP" data-src="/img/real.jpg" alt="Real"></p></article></body>', 'https://example.test/post');
  const s = w2.Lasso.snapshot(w2.document); const md = w2.Lasso.toMarkdown(s, s.byEl.get(w2.document.querySelector('#a')).id);
  assert.ok(md.includes('![Real](https://example.test/img/real.jpg)'), md); assert.ok(!md.includes('data:image'));
});

await t('inspect blocks pointer and mouse actions on the page', async () => {
  const w2 = await load('<body><a id="l" href="/next">go</a></body>');
  w2.Lasso.inspect.start(); w2.Lasso.overlay.inspectStart();
  let fired = 0; w2.document.getElementById('l').addEventListener('mousedown', () => fired++);
  const ev = new w2.MouseEvent('mousedown', { bubbles: true, cancelable: true, view: w2 });
  const ok = w2.document.getElementById('l').dispatchEvent(ev);
  assert.equal(ok, false); assert.equal(ev.defaultPrevented, true); assert.equal(fired, 0);
});

await t('inspect blocks mouse release, middle-click and pointer cancel too', async () => {
  const w2 = await load('<body><a id="l" href="/next">go</a></body>');
  w2.Lasso.inspect.start(); w2.Lasso.overlay.inspectStart();
  const link = w2.document.getElementById('l');
  let fired = 0;
  for (const type of ['mouseup', 'auxclick', 'pointercancel']) {
    link.addEventListener(type, () => fired++);
    const ev = new w2.MouseEvent(type, { bubbles: true, cancelable: true, view: w2 });
    assert.equal(link.dispatchEvent(ev), false, type + ' not blocked');
    assert.equal(ev.defaultPrevented, true, type + ' default not prevented');
  }
  assert.equal(fired, 0, 'page handlers must not run while inspecting');
  w2.Lasso.overlay.inspectStop();
  const after = new w2.MouseEvent('mouseup', { bubbles: true, cancelable: true, view: w2 });
  assert.equal(link.dispatchEvent(after), true, 'events are untouched once inspect stops');
  assert.equal(after.defaultPrevented, false);
});

await t('inspect keyboard menu opens for the selected element and does not exit', async () => {
  const w2 = await load('<body><p id="x">hello</p></body>');
  w2.Lasso.inspect.start(); w2.Lasso.overlay.inspectStart();
  const id = inspectId(w2, '#x');
  w2.Lasso.inspect.select(id); w2.Lasso.overlay.inspectSelect(id, false);
  const ev = new w2.KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true, view: w2 });
  w2.document.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(w2.Lasso.inspect.isActive(), true);
  const shiftF10 = new w2.KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true, view: w2 });
  w2.document.dispatchEvent(shiftF10);
  assert.equal(shiftF10.defaultPrevented, true);
  assert.equal(w2.Lasso.inspect.isActive(), true);
});

await t('source has no network primitives (fetch/XHR/WebSocket/eval)', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(here, '../src')).filter((f) => /\.(js|html)$/.test(f))) { const s = fs.readFileSync(f, 'utf8'); assert.ok(!/\b(fetch\s*\(|XMLHttpRequest|WebSocket|eval\s*\(|new Function)/.test(s), f); }
});
await t('engine files other than overlay/bridge never touch chrome.*', () => {
  const dir = path.join(here, '../src/content');
  for (const f of fs.readdirSync(dir)) if (!/^(70|90)-/.test(f)) assert.ok(!/\bchrome\./.test(fs.readFileSync(path.join(dir, f), 'utf8')), f);
});
await t('shared/content-files.js lists exactly the files in src/content (in order)', async () => {
  const { CONTENT_FILES } = await import('../src/shared/content-files.js');
  const actual = fs.readdirSync(path.join(here, '../src/content')).filter((f) => f.endsWith('.js')).sort().map((f) => 'src/content/' + f);
  assert.deepEqual(CONTENT_FILES, actual);
});
await t('manifest is MV3 with required all-site access and no content scripts', () => {
  const m = JSON.parse(fs.readFileSync(path.join(here, '../manifest.json'), 'utf8'));
  assert.equal(m.manifest_version, 3); assert.deepEqual([...m.permissions].sort(), ['activeTab', 'scripting', 'sidePanel', 'storage']);
  assert.deepEqual([...m.host_permissions].sort(), ['http://*/*', 'https://*/*']);
  assert.ok(!m.optional_host_permissions && !m.content_scripts && !m.web_accessible_resources); assert.match(m.content_security_policy.extension_pages, /connect-src 'none'/);
});
await t('manifest, package and engine versions agree', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(here, '../package.json'), 'utf8'));
  const man = JSON.parse(fs.readFileSync(path.join(here, '../manifest.json'), 'utf8'));
  assert.equal(pkg.version, man.version, 'package.json vs manifest.json');
  assert.equal(L.version, man.version, 'engine VERSION vs manifest.json (ensureEngine compares these)');
});

await t('shipped UI never assigns innerHTML', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(here, '../src')).filter((f) => /\.(js|html)$/.test(f))) {
    assert.ok(!/\.innerHTML\s*=/.test(fs.readFileSync(f, 'utf8')), f);
  }
});

await t('every file referenced by the manifest exists', () => {
  const root = path.join(here, '..'), m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const refs = [m.side_panel.default_path, m.background.service_worker, ...Object.values(m.icons), ...Object.values(m.action.default_icon)];
  for (const r of refs) assert.ok(fs.existsSync(path.join(root, r)), r);
});
console.log(`unit: ${n} passed`);
