const MAX_ID = 120;
const MAX_NAME = 160;
const MAX_DOMAIN = 253;
const MAX_PATH = 500;
const MAX_FIELDS = 32;
const MAX_SELECTOR = 1000;
const MAX_RECIPE_BYTES = 100_000;

const FIELD_NAMES = new Set(['title', 'url', 'image', 'price', 'date', 'snippet', 'text']);

export function recipeId(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(value)) throw new Error('Recipe id is invalid');
  return value;
}

export function normalizePathPattern(value = '/') {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH || !value.startsWith('/')) throw new Error('Recipe path pattern is invalid');
  return value;
}

export function validateRecipe(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Recipe must be an object');
  const id = recipeId(input.id);
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, MAX_NAME) : id;
  const match = input.match && typeof input.match === 'object' ? input.match : {};
  if (typeof match.domain !== 'string' || !match.domain || match.domain.length > MAX_DOMAIN || /[^a-z0-9.:-]/i.test(match.domain)) throw new Error('Recipe domain is invalid');
  const kind = typeof input.kind === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(input.kind) ? input.kind : 'record_list';
  const fields = Array.isArray(input.fields) ? input.fields : [];
  if (fields.length > MAX_FIELDS) throw new Error('Recipe has too many fields');
  const normalizedFields = fields.map((field) => {
    if (!field || typeof field !== 'object') throw new Error('Recipe field is invalid');
    const key = String(field.key || '').trim();
    if (!FIELD_NAMES.has(key)) throw new Error(`Unsupported recipe field: ${key}`);
    const selector = String(field.selector || '').trim();
    if (!selector || selector.length > MAX_SELECTOR) throw new Error('Recipe field selector is invalid');
    return { key, selector };
  });
  const recipe = {
    schemaVersion: 1,
    id,
    name,
    kind,
    match: { domain: match.domain.toLowerCase(), pathPattern: normalizePathPattern(match.pathPattern || '/') },
    fields: normalizedFields,
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now(),
    updatedAt: Date.now(),
  };
  if (JSON.stringify(recipe).length > MAX_RECIPE_BYTES) throw new Error('Recipe is too large');
  return recipe;
}

export function compilePathPattern(pattern) {
  const normalized = normalizePathPattern(pattern);
  let source = '';
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (c === '*') source += '[^/]*';
    else if (c === ':' && /[A-Za-z0-9_-]/.test(normalized[i + 1] || '')) {
      while (/[A-Za-z0-9_-]/.test(normalized[i + 1] || '')) i++;
      source += '[^/]+';
    } else source += c.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }
  return new RegExp(`^${source}/?$`);
}

export const recipeLimits = Object.freeze({ MAX_FIELDS, MAX_SELECTOR, MAX_RECIPE_BYTES });
