/* Recipe replay: resolve validated field selectors against the current page. */
(() => {
  const L = globalThis.Lasso;
  const MAX_ITEMS = 500;
  const MAX_TEXT = 5000;
  const clean = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  const readField = (el, key) => {
    if (!el) return '';
    if (key === 'url') return el.href || el.getAttribute('href') || '';
    if (key === 'image') return el.currentSrc || el.src || el.getAttribute('src') || '';
    return clean(el.textContent);
  };
  const run = (recipe) => {
    if (!recipe || !Array.isArray(recipe.fields) || !recipe.fields.length) throw new Error('Recipe has no fields');
    const root = recipe.rootSelector ? document.querySelector(recipe.rootSelector) : document.body;
    if (!root) return { ok: false, health: 'root-missing', items: [], errors: ['The recipe root was not found'] };
    let candidates = [];
    if (recipe.itemSelector) {
      try { candidates = [...root.querySelectorAll(recipe.itemSelector)].slice(0, MAX_ITEMS); } catch { candidates = []; }
    } else {
      candidates = [...root.children].slice(0, MAX_ITEMS);
    }
    const errors = [], items = [];
    for (const item of candidates) {
      const row = {};
      for (const field of recipe.fields) {
        try { row[field.key] = readField(item.querySelector(field.selector), field.key); }
        catch (e) { errors.push(`${field.key}: ${e.message}`); row[field.key] = ''; }
      }
      if (Object.values(row).some(Boolean)) items.push(row);
    }
    const fieldsFound = recipe.fields.filter((field) => items.some((item) => item[field.key])).length;
    const health = !candidates.length ? 'no-items' : fieldsFound === recipe.fields.length ? 'healthy' : fieldsFound ? 'partial' : 'fields-missing';
    return { ok: health === 'healthy' || health === 'partial', health, itemCount: items.length, fieldsFound, fieldCount: recipe.fields.length, items, errors: [...new Set(errors)].slice(0, 20) };
  };
  L.recipe = { run };
})();
