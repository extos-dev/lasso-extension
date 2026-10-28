import { h } from '../dom.js';
import { state } from '../state.js';

export function renderRecipes(root, actions) {
  root.replaceChildren();
  const recipes = state.pageRecipes || [];
  root.append(h('div', { class: 'card' },
    h('div', { class: 'card-title' }, 'Saved extractions'),
    recipes.length ? h('div', { class: 'list' }, recipes.map((r) => h('div', { class: 'card result-card' },
      h('div', { class: 'row between' }, h('b', {}, r.name || r.id), h('button', { class: 'small', onclick: () => actions.runRecipe(r) }, 'Run')),
      h('div', { class: 'muted tiny' }, `${r.kind || 'record list'} · ${r.match?.domain || 'current site'}`),
    ))) : h('p', { class: 'muted' }, 'No saved extractions yet.'),
  ));
  if (state.recipeResult) {
    const r = state.recipeResult;
    root.append(h('div', { class: 'card accent' },
      h('div', { class: 'card-title' }, 'Replay result'),
      h('div', { class: r.health === 'healthy' ? 'ok' : 'warn' }, `${r.health} · ${r.itemCount || 0} items`),
      h('p', { class: 'muted tiny' }, `${r.fieldsFound || 0}/${r.fieldCount || 0} fields found`),
      r.errors?.length ? h('ul', { class: 'warn tiny' }, r.errors.map((e) => h('li', {}, e))) : null,
      r.items?.length ? h('pre', { class: 'preview' }, JSON.stringify(r.items.slice(0, 5), null, 2)) : null,
    ));
  }
}
