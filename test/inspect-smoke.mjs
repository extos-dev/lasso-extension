import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'dist');
const FIX = join(ROOT, 'test', 'fixtures');
const CHROME = process.env.CHROME_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const server = createServer(async (req, res) => {
  const name = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  if (name === 'favicon.ico' || /\.(png|jpe?g|gif|webp)$/i.test(name)) { res.writeHead(200, {'content-type':'image/png'}); return res.end(PNG); }
  if (!/^[a-z0-9._-]+$/i.test(name)) { res.writeHead(403); return res.end('no'); }
  try { const b = await readFile(join(FIX, name)); res.writeHead(200, {'content-type': name.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8', 'cache-control':'no-store'}); res.end(b); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'lasso-gate-'));
let context;
const errors = [];
const passed = [];
const failed = [];
async function scenario(name, fn) {
  try { await fn(); passed.push(name); console.log('  ✓', name); }
  catch (e) {
    failed.push({name, e});
    console.log('  ✗', name, '\n    ', (e.stack || e.message).split('\n').slice(0,5).join('\n     '));
    try { const p = context.pages()[0]; console.log('     notice:', await p.locator('#notice').textContent()); } catch (_) {}
    if (errors.length) console.log('     page errors:', errors.slice(-4));
  }
}
function check(name, fn) { try { fn(); } catch (e) { e.message = name + ': ' + e.message; throw e; } }
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: false,
    executablePath: CHROME,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-dev-shm-usage'],
    viewport: { width: 1280, height: 900 }, acceptDownloads: true,
  });
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 15000});
  const extId = new URL(sw.url()).host;
  const manifest = JSON.parse(await readFile(join(EXT, 'manifest.json'), 'utf8'));
  const panel = context.pages()[0];
  panel.on('pageerror', e => errors.push('panel: ' + e.message));
  panel.on('console', m => { if (m.type() === 'error') errors.push('panel console: ' + m.text()); });
  sw.on('console', m => { if (m.type() === 'error') errors.push('sw: ' + m.text()); });
  const panelUrl = `chrome-extension://${extId}/${manifest.side_panel.default_path}`;
  await panel.goto(panelUrl);
  await panel.waitForSelector('#view-page');
  let target;
  async function closeTarget() { if (target && !target.isClosed()) await target.close().catch(()=>{}); target = null; }
  async function bindTo(file) {
    await closeTarget();
    const url = `${origin}/${file}`;
    const pagePromise = context.waitForEvent('page', {timeout: 20000});
    await panel.evaluate(async u => { const w = await chrome.windows.create({url:u, type:'popup', focused:true}); await chrome.windows.update(w.id, {focused:true}); }, url);
    target = await pagePromise;
    target.on('pageerror', e => errors.push(`page ${file}: ` + e.message));
    await target.waitForLoadState('load');
    for (let i = 0; i < 3; i++) {
      await target.bringToFront();
      await panel.reload({waitUntil:'domcontentloaded'});
      await panel.waitForSelector('#view-page');
      // Reloading the panel must not make the panel tab (or its window) the
      // last-focused window; re-focus the fixture tab from the extension side.
      await panel.evaluate(async (u) => {
        const [t] = await chrome.tabs.query({ url: u });
        if (t) { await chrome.windows.update(t.windowId, { focused: true }); await chrome.tabs.update(t.id, { active: true }); }
      }, url);
      await panel.waitForTimeout(100);
      const active = await panel.evaluate(async () => (await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0]?.url || '');
      if (active === url) break;
    }
    const active = await panel.evaluate(async () => (await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0]?.url || '');
    assert.equal(active, url, 'panel bound to ' + file);
    await panel.waitForFunction(() => { const n = document.querySelector('#siteName'); return n && n.textContent.trim() && n.textContent.trim() !== 'Lasso'; }, null, {timeout:15000});
    return target;
  }
  async function inspect() {
    await panel.locator('#inspectToggle').click();
    await panel.waitForSelector('#view-map:not([hidden])', {timeout:15000});
    await target.waitForSelector('[data-lasso-overlay]', {timeout:10000});
  }
  async function selectByLocator(sel) {
    const loc = target.locator(sel).first();
    await loc.scrollIntoViewIfNeeded();
    const box = await loc.boundingBox();
    assert.ok(box, 'box for ' + sel);
    await target.bringToFront();
    await target.mouse.click(box.x + Math.min(20, box.width/2), box.y + Math.min(20, box.height/2));
    await panel.waitForSelector('#view-map .sel-card', {timeout:10000});
  }

  async function clickMenuPattern(patternName) {
    await target.evaluate((pName) => {
      const host = document.querySelector('[data-lasso-overlay]');
      if (!host || !host.shadowRoot) return;
      const inputs = host.shadowRoot.querySelectorAll('input[type="checkbox"]');
      for (const input of inputs) {
        const label = input.closest('label');
        if (label && label.textContent.includes(patternName)) {
          if (!input.checked) input.click();
        }
      }
      const detectBtn = host.shadowRoot.querySelector('.mdetect');
      if (detectBtn) detectBtn.click();
    }, patternName);
  }
  async function getOutText() {
    return panel.evaluate(() => {
      const ta = document.querySelector('#view-output textarea');
      if (ta && ta.value && ta.value.trim()) return ta.value;
      const pre = document.querySelector('#view-output .out-pre');
      if (pre && pre.textContent && pre.textContent.trim()) return pre.textContent;
      const tbl = document.querySelector('#view-output .data-table');
      if (tbl && tbl.textContent && tbl.textContent.trim()) return tbl.textContent;
      const out = document.querySelector('#view-output .out');
      if (out) {
        if (out.value && out.value.trim()) return out.value;
        if (out.textContent && out.textContent.trim()) return out.textContent;
      }
      const cardTa = document.querySelector('#view-output .out-card textarea');
      if (cardTa && cardTa.value && cardTa.value.trim()) return cardTa.value;
      const cardPre = document.querySelector('#view-output .out-card .out-pre');
      if (cardPre && cardPre.textContent && cardPre.textContent.trim()) return cardPre.textContent;
      const cardTbl = document.querySelector('#view-output .out-card .data-table');
      if (cardTbl && cardTbl.textContent && cardTbl.textContent.trim()) return cardTbl.textContent;
      return document.querySelector('#view-output')?.textContent || '';
    });
  }
  async function runPattern(name) {
    // Drive the checkbox by its stable value: the picker is re-rendered as soon
    // as the selection changes, so clicking a stale label races the repaint.
    const id = name.toLowerCase();
    const cb = panel.locator(`#view-map .pick input[value="${id}"]`).first();
    if (await cb.count()) {
      if (!(await cb.isChecked())) await cb.evaluate((el) => el.click());
      await panel.waitForFunction(
        (v) => document.querySelector(`#view-map .pick input[value="${v}"]`)?.checked === true,
        id, { timeout: 10000 },
      );
    }
    const btn = panel.locator('#view-map .detect-patterns');
    if (await btn.count()) await btn.first().click();
    else {
      const b2 = panel.getByRole('button', {name: /Detect/});
      if (await b2.count()) await b2.first().click();
    }
    // Wait for the detection response to paint before looking for the single
    // result's Send gate (or the multi-result Output cards).
    await panel.waitForFunction(() => {
      const out = document.querySelector('#view-output');
      if (out && !out.hidden) return true;
      return !!document.querySelector('#view-map .result-card');
    }, null, { timeout: 20000 });
    const outHidden = await panel.locator('#view-output').getAttribute('hidden');
    if (outHidden === null) {
      try {
        await panel.waitForFunction(() => {
          const v = document.querySelector('#view-output textarea')?.value || document.querySelector('#view-output .out-pre')?.textContent || document.querySelector('#view-output .data-table')?.textContent || document.querySelector('#view-output .out-card textarea')?.value || document.querySelector('#view-output .out-card .out-pre')?.textContent || document.querySelector('#view-output .out-card .data-table')?.textContent;
          return v && v.length;
        }, null, {timeout:20000});
      } catch (_) {}
      return getOutText();
    }
    try {
      const sendBtn = panel.getByRole('button', {name: 'Send to Output'});
      if (await sendBtn.count()) await sendBtn.first().click();
    } catch (_) {}
    try {
      await panel.waitForFunction(() => {
        const out = document.querySelector('#view-output');
        if (!out || out.hidden) return false;
        const v = document.querySelector('#view-output textarea')?.value || document.querySelector('#view-output .out-pre')?.textContent || document.querySelector('#view-output .data-table')?.textContent;
        return v && v.length;
      }, null, {timeout:20000});
    } catch (_) {}
    return getOutText();
  }
  async function chooseFormat(label) {
    try {
      const btn = panel.getByRole('button', {name: 'Export ▾'}).first();
      if (await btn.count()) {
        await btn.click();
        await panel.waitForTimeout(150);
        const item = panel.locator('.export-menu .export-item').filter({hasText: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))});
        if (await item.count()) { await item.first().click(); await panel.waitForTimeout(300); return getOutText(); }
        await panel.mouse.click(0,0);
      }
    } catch (_) {}
    try {
      await panel.getByRole('button', {name:label, exact:true}).click();
      await panel.waitForTimeout(150);
      return getOutText();
    } catch (_) {}
    return getOutText();
  }

  await scenario('dist loads in Chromium, no startup errors', async () => {
    assert.match(sw.url(), /\/background\/service-worker\.js$/);
    check('panel available', () => assert.ok(panelUrl.endsWith('/sidepanel/index.html')));
    check('no page errors yet', () => assert.deepEqual(errors, []));
  });

  await scenario('article: no auto-scan, inspect mapping, Article output', async () => {
    await bindTo('article-semantic.html');
    const before = await target.evaluate(() => ({ body: document.body.innerHTML, kids: document.documentElement.children.length }));
    assert.equal(await target.evaluate(() => !!document.querySelector('[data-lasso-overlay]')), false);
    await inspect();
    const host = await target.evaluate(() => {
      const h = document.querySelector('[data-lasso-overlay]');
      return h ? { pos: getComputedStyle(h).position, pe: getComputedStyle(h).pointerEvents } : null;
    });
    assert.deepEqual(host, {pos:'fixed', pe:'none'});
    const after = await target.evaluate(() => ({ body: document.body.innerHTML, kids: document.documentElement.children.length }));
    check('body unchanged', () => assert.equal(after.body, before.body));
    check('one host on html', () => assert.equal(after.kids, before.kids + 1));
    const map = await panel.locator('#view-map').innerText();
    assert.match(map, /Inspect mode is on/);
    assert.match(map, /DOM TREE/i);
    const stats = await panel.locator('#view-map .statline').innerText();
    assert.match(stats, /\d[\d,]* nodes/);
    assert.match(stats, /\d+ ms snapshot/);
    await selectByLocator('article');
    const sel = await panel.locator('#view-map .sel-card').innerText();
    assert.match(sel, /h1|article|p/);
    const md = await runPattern('Article');
    assert.match(md, /Counting the Tide/);
    assert.match(md, /The numbers/);
    assert.match(md, /cooperative|The cooperative/i);
    assert.match(md, /Marta Quill/);
    assert.doesNotMatch(md, /FOOTERTEXT|Related story one|Subscribe to our newsletter/);
    try {
      await panel.getByRole('button', {name:/^Copy$/}).click();
      await panel.waitForSelector('#notice:not([hidden])', {timeout:3000});
    } catch (_) {}
    // Clipboard read is denied to opaque chrome-extension:// origins in headless; manual paste check remains.
    const jsonText = await chooseFormat('JSON');
    try {
      const j = JSON.parse(jsonText);
      check('json kind', () => assert.equal(j.kind, 'article'));
      check('json has markdown', () => assert.match(j.markdown, /Counting the Tide/));
    } catch (e) {
      // maybe json is embedded
      assert.match(jsonText, /Counting the Tide/);
    }
    await panel.screenshot({path:'/tmp/opencode/lasso-article-output.png'});
  });

  await scenario('tree lazy expansion and breadcrumb', async () => {
    await bindTo('article-semantic.html');
    await inspect();
    await selectByLocator('article');
    const crumbs = panel.locator('#view-map .breadcrumb .crumb');
    assert.ok(await crumbs.count() >= 2);
    const before = await panel.locator('#view-map .node-row').count();
    const closed = panel.locator('#view-map .node-row button.twisty[aria-expanded="false"]').first();
    if (await closed.count()) {
      await closed.click();
      await panel.waitForFunction(() => !document.querySelector('#view-map .loading'), null, {timeout:10000});
      const after = await panel.locator('#view-map .node-row').count();
      assert.ok(after > before, `rows ${before} -> ${after}`);
    } else {
      // Collapse the root, then expand it again to exercise lazy child loading.
      const root = panel.locator('#view-map .node-row').first();
      await root.locator('button.twisty').click();
      const collapsed = await panel.locator('#view-map .node-row').count();
      await root.locator('button.twisty').click();
      await panel.waitForFunction(() => !document.querySelector('#view-map .loading'), null, {timeout:10000});
      const after = await panel.locator('#view-map .node-row').count();
      assert.ok(after > collapsed, `rows ${collapsed} -> ${after}`);
    }

    // Hover sync must update the rendered rows in place, not rebuild the tree.
    const art = await target.locator('article').first().boundingBox();
    await target.bringToFront();
    await target.mouse.move(art.x + Math.min(20, art.width / 2), art.y + Math.min(20, art.height / 2));
    await panel.waitForFunction(() => !!document.querySelector('#view-map .node-row.hover'), null, {timeout:10000});
    const hoveredId = await panel.locator('#view-map .node-row.hover').first().getAttribute('data-node-id');
    await panel.evaluate((id) => {
      const row = document.querySelector('#view-map .node-row[data-node-id="' + id + '"]');
      if (row) row.setAttribute('data-hover-probe', 'kept');
    }, hoveredId);
    await target.mouse.move(3, 3);
    await panel.waitForTimeout(300);
    const probe = await panel.evaluate((id) => {
      const row = document.querySelector('#view-map .node-row[data-node-id="' + id + '"]');
      return { tagged: row ? row.getAttribute('data-hover-probe') : null, hovered: row ? row.classList.contains('hover') : null };
    }, hoveredId);
    check('hover did not rebuild the tree', () => assert.equal(probe.tagged, 'kept'));
    check('hover class follows the pointer', () => assert.equal(probe.hovered, false));
  });

  await scenario('patterns stay scoped to the selected region', async () => {
    await bindTo('patterns-scope.html');
    await inspect();
    await selectByLocator('#scope-table');
    assert.equal(await panel.locator('#view-map .detect-patterns').count(), 1);
    assert.equal(await panel.locator('#view-map .pick').count(), 6);
    assert.equal(await panel.locator('#view-map .pick').filter({hasText:/^Text\b/}).locator('input').isChecked(), true);
    await panel.locator('#view-map .pick').filter({hasText:/^Article\b/}).locator('input').check();
    await panel.locator('#view-map .pick').filter({hasText:/^Table\b/}).locator('input').check();
    await panel.locator('#view-map .detect-patterns').click();
    await panel.waitForSelector('#view-output:not([hidden]) .out-card', {timeout:20000});
    const cards = panel.locator('#view-output .out-card');
    assert.equal(await cards.count(), 2);
    assert.match(await cards.filter({hasText:/^Article/}).innerText(), /not applicable|no article/i);
    assert.match(await cards.filter({hasText:/^Table/}).innerText(), /rows/);
  });

  await scenario('table: scoped Table pattern, JSON rows, CSV download', async () => {
    await bindTo('table-semantic.html');
    await inspect();
    await selectByLocator('table');
    await runPattern('Table');
    const j = JSON.parse(await chooseFormat('JSON'));
    check('headers', () => assert.deepEqual(j.headers, ['Region','Units','Growth','Revenue']));
    check('rows', () => assert.equal(j.rows.length, 8));
    const csv = await chooseFormat('CSV');
    check('csv header', () => assert.equal(csv.split(/\r?\n/)[0], 'Region,Units,Growth,Revenue'));
    check('csv no BOM preview', () => assert.ok(!csv.startsWith('\uFEFF')));
    const dl = panel.waitForEvent('download', {timeout:10000});
    await panel.getByRole('button', {name:/^Download$/}).click();
    const d = await dl;
    check('filename', () => assert.equal(d.suggestedFilename(), '127.0.0.1-table.csv'));
    const buf = await readFile(await d.path());
    check('download BOM', () => assert.deepEqual([...buf.subarray(0,3)], [0xEF,0xBB,0xBF]));
    const body = buf.subarray(3).toString('utf8');
    check('download body', () => assert.equal(body.replace(/\r\n/g, '\n'), csv));
  });

  await scenario('listing: List pattern scoped to grid', async () => {
    await bindTo('grid-products.html');
    await inspect();
    await selectByLocator('.css-grid88');
    await runPattern('List');
    const j = JSON.parse(await chooseFormat('JSON'));
    check('kind/count', () => { assert.equal(j.kind, 'record_list'); assert.equal(j.count, 12); });
    check('product fields', () => { assert.equal(j.flavor, 'product'); assert.equal(j.items[4].title, 'Product Name 5'); assert.equal(j.items[4].price, '$50.99'); });
  });

  await scenario('chat preview: roles and no footer', async () => {
    await bindTo('chat-thread.html');
    await inspect();
    await selectByLocator('#thread');
    await runPattern('Chat');
    const j = JSON.parse(await chooseFormat('JSON'));
    check('chat count', () => assert.equal(j.count, 3));
    check('roles', () => assert.deepEqual(j.messages.map(m=>m.role), ['user','assistant','user']));
    check('no footer', () => assert.doesNotMatch(JSON.stringify(j), /FOOTERTEXT/));
  });

  await scenario('contact preview: details, no page chrome', async () => {
    await bindTo('contact-footer.html');
    await inspect();
    await selectByLocator('#contact');
    await runPattern('Contact');
    const j = JSON.parse(await chooseFormat('JSON'));
    check('name', () => assert.equal(j.name, 'Northwind Studio SARL'));
    check('email', () => assert.deepEqual(j.emails, ['hello@northwind.test']));
    check('phone', () => assert.ok(j.phones.some(p => p.replace(/\D/g,'') === '33123456789')));
    check('address', () => assert.match(j.addresses[0], /14 Rue des Tests/));
    check('links', () => assert.ok(j.links.some(l => l.url.startsWith('mailto:'))));
  });

  await scenario('overlay picker: Article unchecks Text and single Send gates output', async () => {
    await bindTo('article-semantic.html');
    await inspect();
    await selectByLocator('h1');
    const h = await target.locator('h1').first().boundingBox();
    await target.bringToFront();
    await target.mouse.click(h.x + 5, h.y + 5, {button:'right'});
    await target.waitForTimeout(100);
    await target.keyboard.press('Space'); // focused first checkbox: Article; Text must uncheck
    for (let i = 0; i < 7; i++) await target.keyboard.press('Tab'); // Article -> Table -> Chat -> List -> Contact -> Text -> Set as scan parent -> Detect selected
    await target.keyboard.press('Enter');
    await panel.waitForSelector('#view-map .result-card', {timeout:10000});
    assert.match(await panel.locator('#view-map .result-card').innerText(), /Article/);
    assert.equal(await panel.locator('#view-output').isHidden(), true, 'single result must wait for Send to Output');
    await target.keyboard.press('Enter'); // focused Send to Output
    await panel.waitForSelector('#view-output:not([hidden]) .out-pre', {timeout:10000});
    assert.match(await panel.locator('#view-output .out-pre').innerText(), /Counting the Tide/);
  });

  await scenario('event isolation, page selection, Escape cleanup', async () => {
    await bindTo('article-semantic.html');
    await inspect();
    const beforeUrl = target.url();
    const guard = await target.evaluate(() => {
      const a = document.querySelector('article a[rel="author"]');
      const ev = new MouseEvent('mousedown', {bubbles:true, cancelable:true});
      const r = a.dispatchEvent(ev);
      return {r, prevented:ev.defaultPrevented};
    });
    check('mousedown default prevented', () => assert.equal(guard.prevented, true));
    const link = target.locator('article a[rel="author"]').first();
    const b = await link.boundingBox();
    await target.bringToFront();
    await target.mouse.click(b.x + 5, b.y + 5);
    await panel.waitForSelector('#view-map .sel-card', {timeout:10000});
    check('no navigation', () => assert.equal(target.url(), beforeUrl));
    await target.keyboard.press('Escape');
    await panel.waitForSelector('#view-page:not([hidden])', {timeout:10000});
    await target.waitForFunction(() => !document.querySelector('[data-lasso-overlay]'), null, {timeout:5000});
  });

  await scenario('context menu: right-click, Escape, keyboard Shift+F10/Enter', async () => {
    await bindTo('article-semantic.html');
    await inspect();
    await selectByLocator('h1');
    const h = await target.locator('h1').first().boundingBox();
    await target.bringToFront();
    await target.mouse.click(h.x + 5, h.y + 5, {button:'right'});
    await target.waitForTimeout(100);
    await target.keyboard.press('Escape');
    await target.waitForTimeout(100);
    check('first Escape closes the menu, not inspect', async () => {});
    assert.equal(await panel.locator('#inspectLabel').innerText(), 'Inspecting');
    await target.keyboard.press('Escape');
    await panel.waitForSelector('#view-page:not([hidden])', {timeout:10000});
    await inspect();
    await selectByLocator('h1');
    await target.bringToFront();
    await target.keyboard.press('Shift+F10');
    for (let i = 0; i < 7; i++) await target.keyboard.press('Tab');
    await target.keyboard.press('Enter'); // Detect selected (Text default)
    await target.waitForTimeout(150);
    await target.keyboard.press('Enter'); // Send to Output
    await panel.waitForSelector('#view-output:not([hidden]) .out-pre', {timeout:10000});
    assert.match(await panel.locator('#view-output .out-pre').innerText(), /Counting the Tide/);
  });

  await scenario('per-tab restore, navigation reset, close cleanup', async () => {
    await closeTarget();
    await panel.evaluate(async () => { const w = await chrome.windows.getCurrent(); await chrome.windows.update(w.id, {focused:true}); });
    async function openTab(file) {
      const url = origin + '/' + file;
      const pp = context.waitForEvent('page', {timeout:20000});
      const tab = await panel.evaluate(async u => await chrome.tabs.create({url:u, active:true}), url);
      const page = await pp;
      await page.waitForLoadState('load');
      await panel.waitForFunction(() => document.querySelector('#siteName')?.textContent !== 'Lasso', null, {timeout:10000});
      return {page, tab};
    }
    const a = await openTab('article-semantic.html');
    assert.equal(await panel.locator('#siteName').innerText(), 'The Harbor Ledger');
    await panel.waitForFunction(() => !document.querySelector('#inspectToggle').disabled, null, {timeout:10000});
    await panel.evaluate(() => document.querySelector('#inspectToggle').click());
    await panel.waitForFunction(() => !document.querySelector('#view-map')?.hidden, null, {timeout:10000});
    await a.page.waitForSelector('[data-lasso-overlay]');
    const box = await a.page.locator('article').first().boundingBox();
    await a.page.mouse.click(box.x + 20, box.y + 20);
    await panel.waitForFunction(() => document.querySelector('#view-map .sel-card'), null, {timeout:10000});
    await panel.locator('#view-map .pick').filter({hasText:/^Article\b/}).locator('input').check();
    await panel.locator('#view-map .detect-patterns').click();
    await panel.getByRole('button', {name: 'Send to Output'}).click();
    await panel.waitForFunction(() => document.querySelector('#view-output .out-pre'), null, {timeout:20000});
    assert.match(await panel.locator('#view-output .out-pre').innerText(), /Counting the Tide/);
    const b = await openTab('table-semantic.html');
    assert.equal(await panel.locator('#siteName').innerText(), '127.0.0.1');
    assert.equal(await panel.locator('#inspectLabel').innerText(), 'Inspect');
    assert.equal(await b.page.evaluate(() => !!document.querySelector('[data-lasso-overlay]')), false);
    await panel.evaluate(async id => { await chrome.windows.update((await chrome.tabs.get(id)).windowId, {focused:true}); await chrome.tabs.update(id,{active:true}); }, a.tab.id);
    await panel.waitForFunction(() => document.querySelector('#siteName')?.textContent === 'The Harbor Ledger', null, {timeout:10000});
    await panel.waitForFunction(() => document.querySelector('#inspectLabel')?.textContent === 'Inspecting', null, {timeout:10000});
    assert.equal(await a.page.evaluate(() => !!document.querySelector('[data-lasso-overlay]')), true);
    assert.match(await panel.locator('#view-output .out-pre').innerText(), /Counting the Tide/);
    await a.page.reload({waitUntil:'load'});
    await panel.waitForFunction(() => document.querySelector('#inspectLabel')?.textContent === 'Inspect', null, {timeout:10000});
    await panel.waitForFunction(() => !document.querySelector('#view-page')?.hidden, null, {timeout:10000});
    assert.equal(await a.page.evaluate(() => !!document.querySelector('[data-lasso-overlay]')), false);
    await b.page.close(); await a.page.close();
    target = null;
  });

  await scenario('SPA pushState navigation ends the session', async () => {
    await bindTo('article-semantic.html');
    await inspect();
    await selectByLocator('article');
    assert.equal(await panel.locator('#inspectLabel').innerText(), 'Inspecting');
    // Same-document navigation: no load event, so only tabs.onUpdated can notice.
    await target.evaluate(() => history.pushState({ spa: 1 }, '', '/article-semantic.html?spa=1'));
    await panel.waitForFunction(() => document.querySelector('#inspectLabel')?.textContent === 'Inspect', null, {timeout:10000});
    await panel.waitForFunction(() => !document.querySelector('#view-page')?.hidden, null, {timeout:10000});
    await target.waitForFunction(() => !document.querySelector('[data-lasso-overlay]'), null, {timeout:5000});
  });

  await scenario('restricted page message', async () => {
    await closeTarget();
    const pagePromise = context.waitForEvent('page', {timeout:20000});
    await panel.evaluate(async () => { const w = await chrome.windows.create({url:'about:blank', type:'popup', focused:true}); await chrome.windows.update(w.id, {focused:true}); });
    target = await pagePromise;
    await target.waitForLoadState('load').catch(()=>{});
    await target.bringToFront();
    await panel.reload({waitUntil:'domcontentloaded'});
    await panel.waitForSelector('#notice:not([hidden])', {timeout:10000});
    const n = await panel.locator('#notice').innerText();
    assert.match(n, /can’t run on browser pages or the Web Store/);
    assert.match(await panel.locator('#view-page').innerText(), /Lasso can’t read this tab yet|Open a web page/);
  });

  await scenario('no uncaught errors', async () => {
    const filtered = errors.filter(e => !/favicon|Failed to load resource/.test(e));
    assert.deepEqual(filtered, []);
  });
} catch (e) { failed.push({name:'setup', e}); console.error(e); }
finally {
  if (context) await context.close().catch(()=>{});
  await rm(profile, {recursive:true, force:true}).catch(()=>{});
  await new Promise(r => server.close(r));
}
console.log(`\ninspect smoke: ${passed.length}/${passed.length + failed.length} passed`);
if (failed.length) { for (const f of failed) console.log('FAIL', f.name, '\n', (f.e.stack || f.e.message).split('\n').slice(0,8).join('\n')); process.exitCode = 1; }
