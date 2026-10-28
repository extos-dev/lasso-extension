import assert from 'node:assert/strict';
import { compilePathPattern, validateRecipe } from '../src/shared/recipe.js';

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
console.log('recipe: 1 passed');
