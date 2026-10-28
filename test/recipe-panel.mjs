import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, '../src/sidepanel/index.html'), 'utf8');
const panel = fs.readFileSync(path.join(root, '../src/sidepanel/recipes-panel.js'), 'utf8');
const api = fs.readFileSync(path.join(root, '../src/sidepanel/api.js'), 'utf8');

assert.match(html, /data-view="recipes"/);
assert.match(html, /id="view-recipes"/);
assert.match(html, /src="recipes-panel\.js"/);
assert.match(panel, /SCHEMA_MATCH|matchRecipes/);
assert.match(panel, /SCHEMA_SAVE|saveRecipe/);
assert.match(panel, /RECIPE_RUN|runRecipe/);
assert.match(panel, /SCHEMA_DELETE|deleteRecipe/);
assert.doesNotMatch(panel, /\.innerHTML\s*=/);
assert.match(api, /export async function saveRecipe/);
assert.match(api, /export async function runRecipe/);
console.log('recipe-panel: 1 passed');
