#!/usr/bin/env node
/**
 * PAUSED / LEGACY — Phase 0 real-browser smoke harness (Playwright + unpacked extension).
 *
 * This harness assumes the auto-detect-first UI (Quick extract / Edit mode /
 * detected-region map). The owner has moved the target UX to inspect-first:
 * see docs/VISION.md. Do not use this as a gate and do not add features to it
 * until it is rewritten for the inspect flow. It is kept because the browser
 * plumbing (temporary extension copy, fixture server, panel↔fixture window
 * binding, isolated-world engine inspection) is reusable.
 *
 * It found real defects before the halt: overlay host left behind on toggle-off,
 * stage-0 resets during a flow, and a restricted-page message-path issue. See
 * docs/VISION.md §17.
 *
 * Run manually: node test/e2e.mjs    (Linux needs DISPLAY, or: xvfb-run -a node test/e2e.mjs)
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const FIXTURES = join(ROOT, 'test', 'fixtures');
const ARTIFACTS = join(ROOT, 'test', 'artifacts');
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

/* ------------------------------------------------------------------ runner */
let passed = 0;
const failures = [];
async function scenario(name, fn) {
  const started = Date.now();
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name} (${Date.now() - started} ms)`);
  } catch (e) {
    failures.push({ name, error: e });
    console.log(`  ✗ ${name} (${Date.now() - started} ms)\n      ${e.message.split('\n')[0]}`);
  }
}
const check = async (name, fn) => {
  try { await fn(); }
  catch (e) { e.message = `${name}: ${e.message}`; throw e; }
};

/* ------------------------------------------------------------- fixture http */
function startFixtures() {
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
    const name = pathname.replace(/^\/+/, '');
    if (name === '' || name === 'index.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>Fixture home</title><body><h1>Fixture home</h1></body>');
      return;
    }
    if (name === 'favicon.ico' || /\.(?:png|jpe?g|gif|webp)$/i.test(name)) {
      response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      response.end(PNG_1PX);
      return;
    }
    if (!/^[a-z0-9._-]+$/i.test(name)) { response.writeHead(403); response.end('Forbidden'); return; }
    try {
      const body = await readFile(join(FIXTURES, name));
      const type = name.endsWith('.json') ? 'application/json' : name.endsWith('.html') ? 'text/html' : 'text/plain';
      response.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
      response.end(body);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ server, origin: `http://127.0.0.1:${server.address().port}` });
  }));
}

/* ----------------------------------------------------------- extension copy */
async function copyShipped(dest) {
  for (const entry of ['src', 'assets']) {
    await cp(join(ROOT, entry), join(dest, entry), { recursive: true });
  }
  await cp(join(ROOT, 'manifest.json'), join(dest, 'manifest.json'));
}

async function prepareUnpacked({ built = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), built ? 'lasso-e2e-dist-' : 'lasso-e2e-ext-'));
  if (built) {
    const { execFile } = await import('node:child_process');
    await new Promise((resolve, reject) => execFile(process.execPath, [join(ROOT, 'scripts', 'build.mjs'), dir], (err) => err ? reject(err) : resolve()));
  } else {
    await copyShipped(dir);
  }
  const manifestPath = join(dir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.deepEqual([...manifest.host_permissions].sort(), ['http://*/*', 'https://*/*'], 'shipped manifest must declare web host access');
  assert.ok(!manifest.content_scripts, 'shipped manifest must not auto-inject content scripts');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return { dir, manifest };
}

/* ------------------------------------------------------------------ browser */
async function launchFixtureBrowser(extensionDir) {
  const profile = await mkdtemp(join(tmpdir(), 'lasso-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate,OptimizationHints',
    ],
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20000 });
  const extensionId = new URL(sw.url()).host;
  return { context, profile, sw, extensionId };
}

async function closeQuietly(context, profile) {
  try { await context.close(); } catch (_) {}
  for (let i = 0; i < 5; i++) {
    try { await rm(profile, { recursive: true, force: true }); return; } catch (_) { await new Promise((r) => setTimeout(r, 200)); }
  }
}

/* -------------------------------------------------------------------- suite */
const { server, origin } = await startFixtures();
const { dir: extDir, manifest } = await prepareUnpacked();
const built = await prepareUnpacked({ built: true });
const { context, profile, sw, extensionId } = await launchFixtureBrowser(extDir);
await mkdir(ARTIFACTS, { recursive: true });

const panelPath = manifest.side_panel.default_path;
const panelUrl = `chrome-extension://${extensionId}/${panelPath}`;
const panel = context.pages()[0];
const panelErrors = [];
const pageErrors = [];
const swErrors = [];
const requests = [];

sw.on('console', (m) => { if (m.type() === 'error') swErrors.push('service worker: ' + m.text()); });
context.on('page', (p) => {
  p.on('pageerror', (e) => pageErrors.push(`${p.url()}: ${e.message}`));
});
context.on('request', (r) => {
  const u = r.url();
  if (!/^(https?|chrome-extension|data|blob|chrome):/.test(u)) return;
  if (u.startsWith('chrome-extension://') || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('chrome:')) return;
  const host = new URL(u).hostname;
  if (host !== '127.0.0.1') requests.push(u);
});

panel.on('pageerror', (e) => panelErrors.push('panel: ' + e.message));
panel.on('console', (m) => { if (m.type() === 'error') panelErrors.push('panel console: ' + m.text()); });
await panel.goto(panelUrl);
await panel.waitForSelector('#view-page');
try {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `chrome-extension://${extensionId}` });
} catch (e) {
  console.log('  ! clipboard permission grant failed: ' + e.message.split('\n')[0]);
}

let target = null;
let targetTabId = null;

async function activeUrl() {
  return panel.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.url || '');
}
async function closeTarget() {
  if (target && !target.isClosed()) await target.close().catch(() => {});
  target = null;
  targetTabId = null;
}
async function bindTo(path, { expectName = true } = {}) {
  const url = origin + '/' + path;
  await closeTarget();
  const newPage = context.waitForEvent('page', { timeout: 20000 });
  const win = await panel.evaluate(async (u) => (await chrome.windows.create({ url: u, type: 'popup', width: 1100, height: 820, left: 60, top: 60, focused: true })).id, url);
  target = await newPage;
  await target.waitForLoadState('load');
  target.on('pageerror', (e) => pageErrors.push(`target ${path}: ${e.message}`));
  await target.bringToFront();
  // The panel binds to the active tab at load. Retry once if the panel window kept focus.
  for (let attempt = 0; attempt < 2; attempt++) {
    await panel.reload({ waitUntil: 'domcontentloaded' });
    await panel.waitForFunction(() => document.querySelector('#view-page') && !document.querySelector('#view-page button.pri')?.disabled, null, { timeout: 15000 }).catch(() => {});
    if ((await activeUrl()) === url) break;
    await target.bringToFront();
  }
  assert.equal(await activeUrl(), url, 'panel must bind to the fixture tab');
  targetTabId = await panel.evaluate(async (windowId) => (await chrome.tabs.query({ windowId }))[0]?.id, win);
  await panel.evaluate((fixtureTabId) => {
    window.__ev = [];
    chrome.tabs.onActivated.addListener((i) => window.__ev.push({ ev: 'activated', tabId: i.tabId, windowId: i.windowId }));
    chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'complete') window.__ev.push({ ev: 'updated', tabId: id, status: info.status }); });
    chrome.runtime.onMessage.addListener((m) => { if (m && m.lasso) window.__ev.push({ ev: 'msg', type: m.type }); });
  }, targetTabId);
  if (expectName) await panel.waitForFunction(() => { const n = document.querySelector('#siteName'); return n && n.textContent.trim() && n.textContent.trim() !== 'Lasso'; }, null, { timeout: 15000 });
  return target;
}
async function bindRestricted(url) {
  await closeTarget();
  const newPage = context.waitForEvent('page', { timeout: 20000 });
  await panel.evaluate(async (u) => { await chrome.windows.create({ url: u, type: 'popup', width: 800, height: 600, focused: true }); }, url);
  target = await newPage;
  await target.waitForLoadState('load').catch(() => {});
  await target.bringToFront().catch(() => {});
  await panel.reload({ waitUntil: 'domcontentloaded' });
  await panel.waitForSelector('#notice:not([hidden])', { timeout: 10000 });
}

async function pageTab() { await panel.getByRole('tab', { name: 'Page' }).click(); }
async function outputTab() { await panel.getByRole('tab', { name: 'Output' }).click(); }
async function mapTab() { await panel.getByRole('tab', { name: 'Map' }).click(); }
async function quickExtract() {                   // expects a region
  await pageTab();
  await panel.getByRole('button', { name: /Quick extract/ }).click();
  await panel.waitForSelector('#view-output textarea', { timeout: 25000 });
  return panel.locator('#view-output textarea').inputValue();
}
async function quickExtractExpectNotice() {
  await pageTab();
  await panel.getByRole('button', { name: /Quick extract/ }).click();
  await panel.waitForSelector('#notice:not([hidden])', { timeout: 25000 });
  return panel.locator('#notice').innerText();
}
async function setFormat(label, ext) {
  await panel.getByRole('button', { name: label, exact: true }).click();
  await panel.waitForFunction((e) => document.querySelector('#view-output .row button.sec')?.textContent.trim().endsWith('.' + e), ext, { timeout: 15000 });
  return panel.locator('#view-output textarea').inputValue();
}
async function engineState() {
  return panel.evaluate(async (tabId) => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const host = document.querySelector('[data-lasso-overlay]');
        const A = globalThis.Lasso;
        return {
          host: !!host,
          hostStyle: host ? { pointerEvents: getComputedStyle(host).pointerEvents, position: getComputedStyle(host).position } : null,
          regions: A && A.last ? A.last.tree.flat.map((r) => {
            const b = A.last.snap.nodes[r.nodeId].el.getBoundingClientRect();
            return { id: r.id, kind: r.kind, score: r.score, rect: { left: b.left, top: b.top, width: b.width, height: b.height } };
          }) : [],
        };
      },
    });
    return result;
  }, targetTabId);
}
async function scrollRegionToCenter(kind) {
  await panel.evaluate(async ({ tabId, kind }) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (k) => {
        const A = globalThis.Lasso;
        const r = A.last.tree.flat.find((x) => x.kind === k);
        if (r) A.last.snap.nodes[r.nodeId].el.scrollIntoView({ block: 'center', inline: 'nearest' });
      },
      args: [kind],
    });
  }, { tabId: targetTabId, kind });
  await target.waitForTimeout(500);              // scroll event -> rAF -> overlay repaint
}

try {
  console.log('\nLasso — Phase 0 real-browser smoke (Playwright)');

  await scenario('extension loads without panel or service-worker errors', async () => {
    assert.equal(panel.url(), panelUrl);
    assert.ok(sw.url().endsWith('/background/service-worker.js'));
    await panel.waitForSelector('#tabs button[data-view="page"]');
    assert.equal(panelErrors.length, 0, panelErrors.join('; '));
    assert.equal(swErrors.length, 0, swErrors.join('; '));
  });

  await scenario('stage 0 light pass + first-visit profile (article)', async () => {
    await panel.evaluate(async () => chrome.runtime.sendMessage({ lasso: true, type: 'SITES_CLEAR' }));
    await bindTo('article-semantic.html');
    await check('site name from og:site_name', async () => assert.equal(await panel.locator('#siteName').innerText(), 'The Harbor Ledger'));
    await check('hostname', async () => assert.equal(await panel.locator('#siteMeta').innerText(), '127.0.0.1'));
    const text = await panel.locator('#view-page').innerText();
    await check('title', async () => assert.match(text, /Counting the Tide \| The Harbor Ledger/));
    await check('quick counts', async () => assert.match(text, /1 article · 0 table · 1 h1 · 0 form/));
    await check('first visit message', async () => assert.match(text, /First visit to this site/));
    await check('no overlays before any analyse', async () => assert.equal(await target.evaluate(() => document.querySelectorAll('[data-lasso-overlay]').length), 0));
    await panel.screenshot({ path: join(ARTIFACTS, '01-panel-stage0.png') });
  });

  await scenario('quick extract: article -> clean Markdown, copy + download', async () => {
    const md = await quickExtract();
    await check('H1 + body + section', async () => {
      assert.match(md, /^# Counting the Tide/m);
      assert.match(md, /The numbers/);
      assert.match(md, /## The cooperative/);
      assert.match(md, /Patience was the scarce resource/);
    });
    await check('boilerplate excluded', async () => {
      for (const bad of ['FOOTERTEXT', 'Related story one', 'Subscribe to our newsletter', 'Privacy']) assert.ok(!md.includes(bad), bad);
    });
    await check('author/date metadata', async () => { assert.match(md, /Marta Quill/); assert.match(md, /March 14, 2026/); });
    const meta = await panel.locator('#view-output .muted').last().innerText();
    await check('char + token estimate labelled', async () => { assert.match(meta, /[\d,]+ chars · ~[\d,]+ tokens/); assert.match(meta, /estimate/); });
    await check('token estimate = ceil(chars/4)', async () => {
      const m = meta.match(/([\d,]+) chars · ~([\d,]+) tokens/);
      assert.equal(Number(m[2].replace(/,/g, '')), Math.ceil(Number(m[1].replace(/,/g, '')) / 4));
    });
    await check('page-type distribution labelled as estimate', async () => {
      await pageTab();
      const t = await panel.locator('#view-page').innerText();
      assert.match(t, /Page type/);
      assert.match(t, /article/);
      assert.match(t, /Estimates, not calibrated probabilities/);
      assert.match(t, /Scan\n.* visible nodes/);
    });
    await outputTab();
    await panel.getByRole('button', { name: /^Copy$/ }).click();
    await panel.waitForSelector('#notice:not([hidden])', { timeout: 5000 });
    await check('copy writes the rendered text', async () => {
      assert.match(await panel.locator('#notice').innerText(), /Copied/);
      const clip = await panel.evaluate(() => navigator.clipboard.readText());
      assert.equal(clip, await panel.locator('#view-output textarea').inputValue());
    });
    const downloadPromise = panel.waitForEvent('download', { timeout: 10000 });
    await panel.getByRole('button', { name: /^Download / }).click();
    const download = await downloadPromise;
    const file = await download.path();
    await check('download filename + content', async () => {
      assert.equal(download.suggestedFilename(), '127.0.0.1-article.md');
      assert.equal(await readFile(file, 'utf8'), await panel.locator('#view-output textarea').inputValue());
    });
    await panel.screenshot({ path: join(ARTIFACTS, '02-panel-output-markdown.png') });
    await pageTab();
    await check('visit count persisted by background', async () => {
      const site = await panel.evaluate(async () => (await chrome.runtime.sendMessage({ lasso: true, type: 'SITE_GET', hostname: '127.0.0.1' })).data);
      assert.equal(site.visits, 1);
      assert.equal(site.lastKind, 'article');
      assert.equal(site.name, 'The Harbor Ledger');
    });
  });

  await scenario('determinism + re-scan', async () => {
    await panel.evaluate(async () => chrome.runtime.sendMessage({ lasso: true, type: 'SITES_CLEAR' }));
    await bindTo('article-semantic.html');
    const md1 = await quickExtract();
    const md2 = await quickExtract();
    await check('same page -> same Markdown', async () => assert.equal(md2, md1));
    await pageTab();
    await check('visit #2 shown after second analyse', async () => assert.match(await panel.locator('#view-page').innerText(), /Visit #2/));
  });

  await scenario('table -> JSON, CSV + Excel BOM download', async () => {
    await bindTo('table-semantic.html');
    await quickExtract();
    const json = JSON.parse(await setFormat('JSON', 'json'));
    await check('JSON shape', async () => {
      assert.equal(json.kind, 'table');
      assert.equal(json.headers.length, 4);
      assert.equal(json.rows.length, 8);
      assert.deepEqual(json.headers, ['Region', 'Units', 'Growth', 'Revenue']);
      assert.deepEqual(json.rows[0], ['Region 1', '107', '3.5%', '$120']);
    });
    const csv = await setFormat('CSV', 'csv');
    await check('CSV preview has no BOM', async () => assert.ok(!csv.startsWith('\uFEFF')));
    await check('CSV rows + header', async () => {
      const lines = csv.split('\r\n');
      assert.equal(lines[0], 'Region,Units,Growth,Revenue');
      assert.equal(lines.length, 9);
      assert.equal(lines[1], 'Region 1,107,3.5%,$120');
    });
    await check('BOM checkbox defaults on', async () => assert.ok(await panel.locator('#view-output input[type="checkbox"]').isChecked()));
    const downloadPromise = panel.waitForEvent('download', { timeout: 10000 });
    await panel.getByRole('button', { name: /^Download / }).click();
    const download = await downloadPromise;
    const file = await download.path();
    await check('CSV download filename + UTF-8 BOM', async () => {
      assert.equal(download.suggestedFilename(), '127.0.0.1-table.csv');
      const buf = await readFile(file);
      assert.deepEqual([...buf.subarray(0, 3)], [0xEF, 0xBB, 0xBF]);
      assert.equal(buf.subarray(3).toString('utf8'), csv);
    });
    await panel.locator('#view-output input[type="checkbox"]').uncheck();
    const download2Promise = panel.waitForEvent('download', { timeout: 10000 });
    await panel.getByRole('button', { name: /^Download / }).click();
    const download2 = await download2Promise;
    await check('BOM can be disabled', async () => {
      const buf = await readFile(await download2.path());
      assert.notDeepEqual([...buf.subarray(0, 3)], [0xEF, 0xBB, 0xBF]);
    });
    await panel.screenshot({ path: join(ARTIFACTS, '03-panel-table-csv.png') });
  });

  await scenario('listing -> record list with product fields', async () => {
    await bindTo('grid-products.html');
    await quickExtract();
    const json = JSON.parse(await setFormat('JSON', 'json'));
    await check('count/flavour/fields', async () => {
      assert.equal(json.kind, 'record_list');
      assert.equal(json.count, 12);
      assert.equal(json.flavor, 'product');
      assert.equal(json.items.length, 12);
      assert.equal(json.items[4].title, 'Product Name 5');
      assert.equal(json.items[4].price, '$50.99');
      assert.match(json.items[4].url, /\/products\/p5$/);
    });
    await mapTab();
    await check('map shows the region', async () => {
      const t = await panel.locator('#view-map').innerText();
      assert.match(t, /record list/);
      assert.match(t, /12 product items/);
    });
    await panel.screenshot({ path: join(ARTIFACTS, '04-panel-listing-map.png') });
  });

  await scenario('edit mode: overlays, map, chip click, clean toggle-off', async () => {
    await bindTo('table-in-article.html');
    await quickExtract();
    await check('quick extract does not paint the overlay', async () => assert.equal(await target.evaluate(() => !!document.querySelector('[data-lasso-overlay]')), false));
    const before = await target.evaluate(() => ({ body: document.body.innerHTML, htmlChildren: document.documentElement.children.length }));
    await panel.locator('#editToggle').check();
    await panel.waitForSelector('#view-map .region', { timeout: 25000 });
    await target.waitForSelector('[data-lasso-overlay]', { timeout: 10000 });
    const st = await engineState();
    await check('two regions: article + nested table', async () => {
      assert.deepEqual(st.regions.map((r) => r.kind).sort(), ['article', 'table']);
      const t = await panel.locator('#view-map').innerText();
      assert.match(t, /article/);
      assert.match(t, /table/);
      assert.match(t, /Why this score/);
      assert.match(t, /3 rows × 3 cols/);
    });
    await check('overlay host is pointer-transparent and fixed', async () => {
      assert.equal(st.hostStyle.pointerEvents, 'none');
      assert.equal(st.hostStyle.position, 'fixed');
    });
    await check('page body untouched (overlay lives on <html>)', async () => {
      const after = await target.evaluate(() => ({ body: document.body.innerHTML, htmlChildren: document.documentElement.children.length }));
      assert.equal(after.body, before.body);
      assert.equal(after.htmlChildren, before.htmlChildren + 1);
    });
    const tableRegion = st.regions.find((r) => r.kind === 'table');
    await target.bringToFront();
    await scrollRegionToCenter('table');
    const scrolled = await engineState();
    const rect = scrolled.regions.find((r) => r.kind === 'table').rect;
    const x = Math.min(1270, Math.max(2, rect.left + 40));
    const y = Math.max(2, rect.top - 13);
    await target.mouse.click(x, y);
    await check('closed-shadow chip click selects the region in the panel', async () => {
      await panel.waitForFunction(() => /table/.test(document.querySelector('#view-map .region.sel .chip')?.textContent || ''), null, { timeout: 5000 });
      assert.match(await panel.locator('#view-map .region.sel').innerText(), /3 rows × 3 cols/);
      assert.notEqual(tableRegion.id, undefined);
    });
    await panel.screenshot({ path: join(ARTIFACTS, '05-panel-edit-map.png') });
    await target.screenshot({ path: join(ARTIFACTS, '06-page-overlays.png') });
    await target.bringToFront();
    await panel.locator('#editToggle').uncheck();
    await check('toggle off removes the overlay host', async () => {
      await target.waitForFunction(() => !document.querySelector('[data-lasso-overlay]'), null, { timeout: 5000 });
      const after = await target.evaluate(() => ({ body: document.body.innerHTML, htmlChildren: document.documentElement.children.length }));
      assert.equal(after.body, before.body);
      assert.equal(after.htmlChildren, before.htmlChildren);
    });
  });

  await scenario('graceful failure: no regions (landing)', async () => {
    await bindTo('landing.html');
    const notice = await quickExtractExpectNotice();
    await check('clear no-region message', async () => assert.match(notice, /No article, table or listing found/));
    await check('stays on Page view with usable controls', async () => {
      assert.ok(await panel.locator('#view-page button.pri').isEnabled());
      assert.equal(await panel.locator('#view-output textarea').count(), 0);
    });
    await mapTab();
    await check('map empty state', async () => assert.match(await panel.locator('#view-map').innerText(), /No article, table or listing detected/));
  });

  await scenario('graceful failure: restricted page banner', async () => {
    await bindRestricted('about:blank');
    await check('restricted banner', async () => assert.match(await panel.locator('#notice').innerText(), /can’t run on browser pages or the Web Store/));
    await check('panel is not blank', async () => assert.match(await panel.locator('#view-page').innerText(), /Lasso reads the page/));
    await panel.screenshot({ path: join(ARTIFACTS, '07-panel-restricted.png') });
  });

  await scenario('graceful failure: target tab disappears mid-flow', async () => {
    await bindTo('article-semantic.html');
    const tabId = targetTabId;
    await closeTarget();
    await panel.evaluate(async (id) => { try { await chrome.tabs.remove(id); } catch (_) {} }, tabId);
    await pageTab();
    await panel.getByRole('button', { name: /Quick extract/ }).click();
    await panel.waitForSelector('#notice:not([hidden])', { timeout: 10000 });
    await check('friendly message, not a blank panel', async () => {
      const msg = await panel.locator('#notice').innerText();
      assert.match(msg, /permission|page changed|Re-scan/i);
      assert.ok((await panel.locator('body').innerText()).length > 20);
    });
  });

  await scenario('no network traffic from pages or extension', async () => {
    await check('all HTTP traffic stayed on the fixture origin', async () => assert.deepEqual(requests, []));
  });

  await scenario('console + page-error budget', async () => {
    await check('no uncaught panel errors', async () => assert.deepEqual(panelErrors, []));
    await check('no uncaught page/content errors', async () => assert.deepEqual(pageErrors, []));
    await check('no uncaught service-worker errors', async () => assert.deepEqual(swErrors, []));
  });

  /* Packaged dist smoke: rebuilt tree with stripped paths must still load. */
  const packaged = await launchFixtureBrowser(built.dir);
  try {
    await scenario('packaged dist loads + extracts (stripped paths)', async () => {
      const p = packaged.context.pages()[0];
      const manifestDist = JSON.parse(await readFile(join(built.dir, 'manifest.json'), 'utf8'));
      assert.equal(manifestDist.side_panel.default_path, 'sidepanel/index.html');
      const pUrl = `chrome-extension://${packaged.extensionId}/${manifestDist.side_panel.default_path}`;
      await p.goto(pUrl);
      await p.waitForSelector('#view-page');
      const newPage = packaged.context.waitForEvent('page', { timeout: 20000 });
      await p.evaluate(async (u) => { await chrome.windows.create({ url: u, type: 'popup', focused: true }); }, origin + '/table-semantic.html');
      const t = await newPage;
      await t.waitForLoadState('load');
      for (let i = 0; i < 2; i++) {
        await t.bringToFront();
        await p.reload({ waitUntil: 'domcontentloaded' });
        const url = await p.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.url || '');
        if (url === origin + '/table-semantic.html') break;
      }
      await p.getByRole('button', { name: /Quick extract/ }).click();
      await p.waitForSelector('#view-output textarea', { timeout: 25000 });
      assert.match(await p.locator('#view-output textarea').inputValue(), /\| Region \| Units \| Growth \| Revenue \|/);
      await p.screenshot({ path: join(ARTIFACTS, '08-panel-packaged-dist.png') });
    });
  } finally {
    await closeQuietly(packaged.context, packaged.profile);
  }

  // Consistency of the packaged tree with the source tree.
  await scenario('build output is complete and self-consistent', async () => {
    const srcFiles = await readdir(join(ROOT, 'src'), { recursive: true });
    await check('dist has every src file + assets', async () => {
      const distFiles = await readdir(join(built.dir), { recursive: true });
      for (const f of srcFiles.filter((f) => f.endsWith('.js') || f.endsWith('.html') || f.endsWith('.css'))) {
        assert.ok(distFiles.includes(f), 'missing ' + f);
      }
      for (const icon of ['icon16.png', 'icon32.png', 'icon48.png', 'icon128.png']) assert.ok(existsSync(join(built.dir, 'assets', 'icons', icon)), icon);
    });
    await check('content-files.js paths rewritten without src/', async () => {
      const cf = await readFile(join(built.dir, 'shared', 'content-files.js'), 'utf8');
      assert.ok(!cf.includes("'src/content/"));
      assert.match(cf, /'content\/00-namespace\.js'/);
    });
    const m = JSON.parse(await readFile(join(built.dir, 'manifest.json'), 'utf8'));
    await check('built manifest references exist', async () => {
      const refs = [m.side_panel.default_path, m.background.service_worker, ...Object.values(m.icons), ...Object.values(m.action.default_icon)];
      for (const r of refs) assert.ok(existsSync(join(built.dir, r)), r);
    });
  });
} finally {
  await closeQuietly(context, profile);
  await rm(extDir, { recursive: true, force: true }).catch(() => {});
  await rm(built.dir, { recursive: true, force: true }).catch(() => {});
  await new Promise((r) => server.close(r));
}

console.log(`\ne2e: ${passed}/${passed + failures.length} scenarios passed`);
if (failures.length) {
  for (const { name, error } of failures) console.log(`  ✗ ${name}\n    ${(error.stack || error.message).split('\n').slice(0, 6).join('\n    ')}`);
  process.exitCode = 1;
}
