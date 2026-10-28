import { activeTab, ensureEngine, getRecipe, listRecipes, matchRecipes, runRecipe, saveRecipe, deleteRecipe } from './api.js';

const root = document.getElementById('view-recipes');
const state = { tab: null, recipes: [], matches: [], result: null, error: '' };
const esc = (value) => String(value == null ? '' : value);
const text = (value) => esc(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const idFor = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || `recipe-${Date.now()}`;
const restricted = (url = '') => /^(chrome|edge|about|file|chrome-extension|view-source|devtools):/i.test(url);

function recipeForm() {
  return `<div class="card"><div class="card-title">Create recipe</div>
    <form id="recipe-form">
      <label class="field-label">Name<input name="name" required maxlength="160" placeholder="Products"></label>
      <label class="field-label">Path pattern<input name="pathPattern" required value="/" placeholder="/products/*"></label>
      <label class="field-label">Root selector <span class="muted tiny">optional</span><input name="rootSelector" placeholder=".catalog"></label>
      <label class="field-label">Item selector<input name="itemSelector" required placeholder=".product"></label>
      <div class="card-title tiny">Fields</div>
      <div id="recipe-fields"><div class="recipe-field row"><select name="fieldKey"><option>title</option><option>url</option><option>image</option><option>price</option><option>date</option><option>snippet</option><option>text</option></select><input name="fieldSelector" required placeholder=".title"><button type="button" class="link remove-field">Remove</button></div></div>
      <div class="row"><button type="button" class="sec" id="add-recipe-field">Add field</button><button class="pri" type="submit">Save recipe</button></div>
    </form>
  </div>`;
}

function render() {
  if (!root) return;
  const domain = state.tab ? new URL(state.tab.url).hostname : '';
  root.innerHTML = `<div class="card"><div class="card-title">Recipes</div><div class="muted tiny">Saved locally for ${text(domain || 'this site')}</div></div>${state.error ? `<div class="card"><p class="warn">${text(state.error)}</p></div>` : ''}${recipeForm()}<div class="card"><div class="card-title">Matching recipes</div>${state.matches.length ? state.matches.map((m) => `<div class="row between recipe-row"><span><b>${text(m.name || m.id)}</b><span class="muted tiny"> ${text(m.kind || 'record_list')}</span></span><span><button class="small run-recipe" data-id="${text(m.id)}">Run</button> <button class="small delete-recipe" data-id="${text(m.id)}">Delete</button></span></div>`).join('') : '<p class="muted">No recipes match this page.</p>'}</div>${state.result ? `<div class="card accent"><div class="card-title">Replay result</div><div class="${state.result.health === 'healthy' ? 'ok' : 'warn'}">${text(state.result.health)} · ${Number(state.result.itemCount || 0)} items</div><div class="muted tiny">${Number(state.result.fieldsFound || 0)}/${Number(state.result.fieldCount || 0)} fields found</div>${state.result.errors?.length ? `<ul class="warn tiny">${state.result.errors.map((e) => `<li>${text(e)}</li>`).join('')}</ul>` : ''}<pre class="preview">${text(JSON.stringify((state.result.items || []).slice(0, 10), null, 2))}</pre></div>` : ''}`;
  bind();
}

async function refresh() {
  state.tab = await activeTab();
  if (!state.tab || !state.tab.url || restricted(state.tab.url)) { state.error = 'Open a regular web page to use recipes.'; render(); return; }
  const listed = await listRecipes();
  state.recipes = Object.values(listed.schemas || {});
  state.matches = await matchRecipes(state.tab.url);
  state.error = '';
  render();
}

function fieldRow() {
  const row = document.createElement('div');
  row.className = 'recipe-field row';
  row.innerHTML = '<select name="fieldKey"><option>title</option><option>url</option><option>image</option><option>price</option><option>date</option><option>snippet</option><option>text</option></select><input name="fieldSelector" required placeholder=".selector"><button type="button" class="link remove-field">Remove</button>';
  return row;
}

function bind() {
  document.getElementById('add-recipe-field')?.addEventListener('click', () => { const fields = document.getElementById('recipe-fields'); if (fields.children.length < 32) { fields.append(fieldRow()); bind(); } });
  document.querySelectorAll('.remove-field').forEach((button) => button.addEventListener('click', () => { if (document.querySelectorAll('.recipe-field').length > 1) button.parentElement.remove(); }));
  document.getElementById('recipe-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const form = event.currentTarget, data = new FormData(form), keys = data.getAll('fieldKey'), selectors = data.getAll('fieldSelector'), name = String(data.get('name') || '').trim();
      await saveRecipe({ schemaVersion: 1, id: idFor(`${domainName()}-${name}`), name, kind: 'record_list', match: { domain: domainName(), pathPattern: String(data.get('pathPattern') || '/') }, rootSelector: String(data.get('rootSelector') || '').trim(), itemSelector: String(data.get('itemSelector') || '').trim(), fields: keys.map((key, i) => ({ key, selector: String(selectors[i] || '').trim() })) });
      await refresh();
    } catch (error) { state.error = error.message || String(error); render(); }
  });
  document.querySelectorAll('.run-recipe').forEach((button) => button.addEventListener('click', async () => {
    try { state.error = ''; state.tab = await activeTab(); await ensureEngine(state.tab.id); state.result = await runRecipe(state.tab.id, await getRecipe(button.dataset.id)); render(); }
    catch (error) { state.error = error.message || String(error); render(); }
  }));
  document.querySelectorAll('.delete-recipe').forEach((button) => button.addEventListener('click', async () => {
    try { await deleteRecipe(button.dataset.id); state.result = null; await refresh(); }
    catch (error) { state.error = error.message || String(error); render(); }
  }));
}
function domainName() { try { return new URL(state.tab.url).hostname; } catch (_) { return ''; } }

if (root) {
  root.hidden = true;
  document.querySelectorAll('#tabs button').forEach((button) => button.addEventListener('click', () => {
    root.hidden = button.dataset.view !== 'recipes';
    if (!root.hidden) refresh().catch((error) => { state.error = error.message || String(error); render(); });
  }));
  refresh().catch((error) => { state.error = error.message || String(error); render(); });
}
