import { activeTab, ensureEngine, getRecipe, listRecipes, matchRecipes, runRecipe, saveRecipe, deleteRecipe } from './api.js';
import { h } from './dom.js';
import { state, set, subscribe } from './state.js';

const root = document.getElementById('view-recipes');
const model = { tab: null, matches: [], result: null, error: '' };
const restricted = (url = '') => /^(chrome|edge|about|file|chrome-extension|view-source|devtools):/i.test(url);
const domainName = () => { try { return new URL(model.tab.url).hostname; } catch (_) { return ''; } };
const recipeId = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || `recipe-${Date.now()}`;
const option = (value) => h('option', { value }, value);
const fieldRow = () => h('div', { class: 'recipe-field row' },
  h('select', { name: 'fieldKey' }, ...['title', 'url', 'image', 'price', 'date', 'snippet', 'text'].map(option)),
  h('input', { name: 'fieldSelector', required: true, placeholder: '.selector' }),
  h('button', { type: 'button', class: 'link remove-field', onclick: (e) => { if (document.querySelectorAll('.recipe-field').length > 1) e.currentTarget.parentElement.remove(); } }, 'Remove'),
);

function form() {
  const fields = h('div', { id: 'recipe-fields' }, fieldRow());
  const add = h('button', { type: 'button', class: 'sec', onclick: () => { if (fields.children.length < 32) fields.append(fieldRow()); } }, 'Add field');
  const formEl = h('form', { id: 'recipe-form', onsubmit: async (e) => {
    e.preventDefault();
    try {
      const data = new FormData(formEl), keys = data.getAll('fieldKey'), selectors = data.getAll('fieldSelector'), name = String(data.get('name') || '').trim();
      await saveRecipe({ schemaVersion: 1, id: recipeId(`${domainName()}-${name}`), name, kind: 'record_list', match: { domain: domainName(), pathPattern: String(data.get('pathPattern') || '/') }, rootSelector: String(data.get('rootSelector') || '').trim(), itemSelector: String(data.get('itemSelector') || '').trim(), fields: keys.map((key, i) => ({ key, selector: String(selectors[i] || '').trim() })) });
      await refresh();
    } catch (error) { model.error = error.message || String(error); render(); }
  } },
    h('label', { class: 'field-label' }, 'Name', h('input', { name: 'name', required: true, maxLength: 160, placeholder: 'Products' })),
    h('label', { class: 'field-label' }, 'Path pattern', h('input', { name: 'pathPattern', required: true, value: '/', placeholder: '/products/*' })),
    h('label', { class: 'field-label' }, 'Root selector', h('input', { name: 'rootSelector', placeholder: '.catalog' })),
    h('label', { class: 'field-label' }, 'Item selector', h('input', { name: 'itemSelector', required: true, placeholder: '.product' })),
    h('div', { class: 'card-title tiny' }, 'Fields'), fields, h('div', { class: 'row' }, add, h('button', { class: 'pri', type: 'submit' }, 'Save recipe')),
  );
  return h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Create recipe'), formEl);
}

function render() {
  if (!root) return;
  root.replaceChildren();
  root.append(h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Recipes'), h('div', { class: 'muted tiny' }, `Saved locally for ${domainName() || 'this site'}`)));
  if (model.error) root.append(h('div', { class: 'card' }, h('p', { class: 'warn' }, model.error)));
  if (!model.tab || restricted(model.tab.url)) { root.append(h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Open a regular web page to use recipes.'))); return; }
  root.append(form());
  const list = h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Matching recipes'));
  if (!model.matches.length) list.append(h('p', { class: 'muted' }, 'No recipes match this page.'));
  for (const item of model.matches) list.append(h('div', { class: 'row between' }, h('span', {}, h('b', {}, item.name || item.id), h('span', { class: 'muted tiny' }, ` ${item.kind || 'record_list'}`)), h('span', {}, h('button', { class: 'small', onclick: () => replay(item.id) }, 'Run'), h('button', { class: 'small', onclick: () => remove(item.id) }, 'Delete'))));
  root.append(list);
  if (model.result) root.append(h('div', { class: 'card accent' }, h('div', { class: 'card-title' }, 'Replay result'), h('div', { class: model.result.health === 'healthy' ? 'ok' : 'warn' }, `${model.result.health} · ${model.result.itemCount || 0} items`), h('div', { class: 'muted tiny' }, `${model.result.fieldsFound || 0}/${model.result.fieldCount || 0} fields found`), h('pre', { class: 'preview' }, JSON.stringify((model.result.items || []).slice(0, 10), null, 2))));
}
async function refresh() { model.tab = await activeTab(); if (!model.tab || !model.tab.url || restricted(model.tab.url)) { render(); return; } model.matches = await matchRecipes(model.tab.url); model.error = ''; render(); }
async function replay(id) { try { model.tab = await activeTab(); await ensureEngine(model.tab.id); model.result = await runRecipe(model.tab.id, await getRecipe(id)); render(); } catch (error) { model.error = error.message || String(error); render(); } }
async function remove(id) { try { await deleteRecipe(id); model.result = null; await refresh(); } catch (error) { model.error = error.message || String(error); render(); } }
function syncVisibility() { if (root) root.hidden = state.view !== 'recipes'; }
if (root) { root.hidden = true; subscribe(syncVisibility); document.querySelectorAll('#tabs button').forEach((button) => button.addEventListener('click', () => { if (button.dataset.view === 'recipes') { set({ view: 'recipes' }); refresh().catch((error) => { model.error = error.message || String(error); render(); }); } })); }
