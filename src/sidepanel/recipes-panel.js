import { activeTab, ensureEngine, getRecipe, listRecipes, matchRecipes, runRecipe, saveRecipe, deleteRecipe } from './api.js';
import { state, set, subscribe } from './state.js';

const root = document.getElementById('view-recipes');
const model = { tab: null, recipes: [], matches: [], result: null, error: '' };
const esc = (value) => String(value == null ? '' : value);
const text = (value) => esc(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const idFor = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || `recipe-${Date.now()}`;
const restricted = (url = '') => /^(chrome|edge|about|file|chrome-extension|view-source|devtools):/i.test(url);

function recipeForm() {
  return `<div class="card"><div class="card-title">Create recipe</div><form id="recipe-form">
    <label class="field-label">Name<input name="name" required maxlength="160" placeholder="Products"></label>
    <label class="field-label">Path pattern<input name="pathPattern" required value="/" placeholder="/products/*"></label>
    <label class="field-label">Root selector <span class="muted tiny">optional</span><input name="rootSelector" placeholder=".catalog"></label>
    <label class="field-label">Item selector<input name="itemSelector" required placeholder=".product"></label>
    <div class="card-title tiny">Fields</div><div id="recipe-fields"><div class="recipe-field row"><select name="fieldKey"><option>title</option><option>url</option><option>image</option><option>price</option><option>date</option><option>snippet</option><option>text</option></select><input name="fieldSelector" required placeholder=".title"><button type="button" class="link remove-field">Remove</button></div></div>
    <div class="row"><button type="button" class="sec" id="add-recipe-field">Add field</button><button class="pri" type="submit">Save recipe</button></div>
  </form></div>`;
}
function render() {
  if (!root) return;
  let domain = ''; try { domain = model.tab ? new URL(model.tab.url).hostname : ''; } catch (_) {}
  root.innerHTML = `<div class="card"><div class="card-title">Recipes</div><div class="muted tiny">Saved locally for ${text(domain || 'this site')}</div></div>${model.error ? `<div class="card"><p class="warn">${text(model.error)}</p></div>` : ''}${recipeForm()}<div class="card"><div class="card-title">Matching recipes</div>${model.matches.length ? model.matches.map((m) => `<div class="row between recipe-row"><span><b>${text(m.name || m.id)}</b><span class="muted tiny"> ${text(m.kind || 'record_list')}</span></span><span><button class="small run-recipe" data-id="${text(m.id)}">Run</button> <button class="small delete-recipe" data-id="${text(m.id)}">Delete</button></span></div>`).join('') : '<p class="muted">No recipes match this page.</p>'}</div>${model.result ? `<div class="card accent"><div class="card-title">Replay result</div><div class="${model.result.health === 'healthy' ? 'ok' : 'warn'}">${text(model.result.health)} · ${Number(model.result.itemCount || 0)} items</div><div class="muted tiny">${Number(model.result.fieldsFound || 0)}/${Number(model.result.fieldCount || 0)} fields found</div>${model.result.errors?.length ? `<ul class="warn tiny">${model.result.errors.map((e) => `<li>${text(e)}</li>`).join('')}</ul>` : ''}<pre class="preview">${text(JSON.stringify((model.result.items || []).slice(0, 10), null, 2))}</pre></div>` : ''}`;
  bind();
}
async function refresh() {
  model.tab = await activeTab();
  if (!model.tab || !model.tab.url || restricted(model.tab.url)) { model.error = 'Open a regular web page to use recipes.'; render(); return; }
  const listed = await listRecipes();
  model.recipes = Object.values(listed.schemas || {});
  model.matches = await matchRecipes(model.tab.url);
  model.error = '';
  render();
}
function fieldRow() { const row = document.createElement('div'); row.className = 'recipe-field row'; row.innerHTML = '<select name="fieldKey"><option>title</option><option>url</option><option>image</option><option>price</option><option>date</option><option>snippet</option><option>text</option></select><input name="fieldSelector" required placeholder=".selector"><button type="button" class="link remove-field">Remove</button>'; return row; }
function bind() {
  document.getElementById('add-recipe-field')?.addEventListener('click', () => { const fields = document.getElementById('recipe-fields'); if (fields.children.length < 32) { fields.append(fieldRow()); bind(); } });
  document.querySelectorAll('.remove-field').forEach((button) => button.addEventListener('click', () => { if (document.querySelectorAll('.recipe-field').length > 1) button.parentElement.remove(); }));
  document.getElementById('recipe-form')?.addEventListener('submit', async (event) => { event.preventDefault(); try { const data = new FormData(event.currentTarget), keys = data.getAll('fieldKey'), selectors = data.getAll('fieldSelector'), name = String(data.get('name') || '').trim(); await saveRecipe({ schemaVersion: 1, id: idFor(`${domainName()}-${name}`), name, kind: 'record_list', match: { domain: domainName(), pathPattern: String(data.get('pathPattern') || '/') }, rootSelector: String(data.get('rootSelector') || '').trim(), itemSelector: String(data.get('itemSelector') || '').trim(), fields: keys.map((key, i) => ({ key, selector: String(selectors[i] || '').trim() })) }); await refresh(); } catch (error) { model.error = error.message || String(error); render(); } });
  document.querySelectorAll('.run-recipe').forEach((button) => button.addEventListener('click', async () => { try { model.error = ''; model.tab = await activeTab(); await ensureEngine(model.tab.id); model.result = await runRecipe(model.tab.id, await getRecipe(button.dataset.id)); render(); } catch (error) { model.error = error.message || String(error); render(); } }));
  document.querySelectorAll('.delete-recipe').forEach((button) => button.addEventListener('click', async () => { try { await deleteRecipe(button.dataset.id); model.result = null; await refresh(); } catch (error) { model.error = error.message || String(error); render(); } }));
}
function domainName() { try { return new URL(model.tab.url).hostname; } catch (_) { return ''; } }
function showRecipeTab() { set({ view: 'recipes' }); if (root) root.hidden = false; }
function syncVisibility() { if (!root) return; root.hidden = state.view !== 'recipes'; }
if (root) {
  root.hidden = true;
  subscribe(syncVisibility);
  document.querySelectorAll('#tabs button').forEach((button) => button.addEventListener('click', () => { if (button.dataset.view === 'recipes') { showRecipeTab(); refresh().catch((error) => { model.error = error.message || String(error); render(); }); } }));
}
