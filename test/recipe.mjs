import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { validateRecipe, compilePathPattern } from '../src/shared/recipe.js';

const recipe = validateRecipe({
  id: 'products', name: 'Products', kind: 'record_list',
  match: { domain: 'Example.test', pathPattern: '/products/*' },
  rootSelector: '.catalog', itemSelector: '.product',
  fields: [{ key: 'title', selector: '.title' }, { key: 'url', selector: 'a' }],
});
assert.equal(recipe.schemaVersion, 1);
assert.equal(recipe.match.domain, 'example.test');
assert.equal(recipe.itemSelector, '.product');
assert.equal(compilePathPattern('/products/*').test('/products/123'), true);
assert.equal(compilePathPattern('/products/*').test('/other/123'), false);
assert.equal(compilePathPattern('/post/:id').test('/post/abc'), true);
assert.equal(compilePathPattern('/post/:id').test('/post/'), false);
assert.equal(compilePathPattern('/a.b/*').test('/a.b/x'), true);
assert.equal(compilePathPattern('/a.b/*').test('/axb/x'), false);
assert.throws(() => validateRecipe({ id: 'bad id', match: { domain: 'example.test' } }));
assert.throws(() => validateRecipe({ id: 'x', match: { domain: 'example.test' }, fields: [{ key: 'unknown', selector: '.x' }] }));

const dom = new JSDOM(`<!doctype html><main class="catalog"><article class="product"><h2 class="title">Alpha</h2><a href="/alpha">Open</a></article><article class="product"><h2 class="title">Beta</h2><a href="/beta">Open</a></article></main>`, { url: 'https://example.test/products/1' });
globalThis.document = dom.window.document;
globalThis.Lasso = {};
const replaySource = fs.readFileSync(new URL('../src/content/45-recipe-replay.js', import.meta.url), 'utf8');
Function(replaySource)();
const result = globalThis.Lasso.recipe.run(recipe);
assert.equal(result.health, 'healthy');
assert.equal(result.itemCount, 2);
assert.equal(result.items[0].title, 'Alpha');
assert.equal(result.items[0].url, 'https://example.test/alpha');
console.log('recipe: 1 passed');
