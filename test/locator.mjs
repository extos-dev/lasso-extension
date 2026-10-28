import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/content/44-locator.js', import.meta.url), 'utf8');
const dom = new JSDOM('<main id="root"><article data-testid="card"><h2>Alpha</h2><a href="/a">Open</a></article><article><h2>Beta</h2></article></main>', { url: 'https://example.test/' });
globalThis.document = dom.window.document;
globalThis.Lasso = { util: { isHashy: () => false } };
Function(source)();
const el = document.querySelector('[data-testid="card"]');
const locator = globalThis.Lasso.locator.forElement(el);
assert.ok(locator.selector);
assert.equal(globalThis.Lasso.locator.resolve(locator), el);
assert.equal(globalThis.Lasso.locator.resolve({ selector: '[data-testid="missing"]', fallbacks: [locator.selector] }), el);
console.log('locator: 1 passed');
