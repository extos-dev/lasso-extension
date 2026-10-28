import { compilePathPattern, recipeId, validateRecipe } from '../shared/recipe.js';

// Background service worker: panel behaviour + the ONLY place that touches chrome.storage.
const SITES_KEY = 'sites';
const SCHEMAS_KEY = 'schemas';
const SCHEMA_INDEX_KEY = 'schemaIndex';
const MAX_SITES = 500;
const MAX_SCHEMAS = 100;

function enablePanelOnActionClick() { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {}); }
chrome.runtime.onInstalled.addListener(enablePanelOnActionClick);
chrome.runtime.onStartup.addListener(enablePanelOnActionClick);
async function readSites() { return (await chrome.storage.local.get(SITES_KEY))[SITES_KEY] || {}; }
let siteQueue = Promise.resolve();
const serialSite = (fn) => { const p = siteQueue.then(fn, fn); siteQueue = p.catch(() => {}); return p; };
async function readSchemas() { const data = await chrome.storage.local.get([SCHEMAS_KEY, SCHEMA_INDEX_KEY]); return { schemas: data[SCHEMAS_KEY] || {}, index: data[SCHEMA_INDEX_KEY] || [] }; }
const handlers = {
  async SITE_GET({ hostname }) { const s = await readSites(); return s[hostname] || null; },
  SITE_TOUCH(args) { return serialSite(async () => { const { hostname, name, kind } = args; const sites = await readSites(), now = Date.now(), prev = sites[hostname]; sites[hostname] = { name: name || prev?.name || hostname, firstSeen: prev?.firstSeen || now, lastSeen: now, visits: (prev?.visits || 0) + 1, lastSeen: now, lastKind: kind || prev?.lastKind || null }; const keys = Object.keys(sites); if (keys.length > MAX_SITES) for (const k of keys.sort((a, b) => sites[a].lastSeen - sites[b].lastSeen).slice(0, keys.length - MAX_SITES)) delete sites[k]; await chrome.storage.local.set({ [SITES_KEY]: sites }); return { previous: prev || null, current: sites[hostname] }; }); },
  SITES_CLEAR() { return serialSite(async () => { await chrome.storage.local.remove(SITES_KEY); return { ok: true }; }); },
  async SCHEMA_LIST() { return readSchemas(); },
  async SCHEMA_GET({ id }) { return (await readSchemas()).schemas[recipeId(id)] || null; },
  SCHEMA_SAVE(args) { return serialSite(async () => { const recipe = validateRecipe(args.schema); const { schemas, index } = await readSchemas(); if (!schemas[recipe.id] && Object.keys(schemas).length >= MAX_SCHEMAS) throw new Error('Recipe limit reached'); schemas[recipe.id] = recipe; const entry = { id: recipe.id, name: recipe.name, domain: recipe.match.domain, pathPattern: recipe.match.pathPattern, kind: recipe.kind, updatedAt: recipe.updatedAt }; const idx = index.findIndex((item) => item.id === recipe.id); if (idx >= 0) index[idx] = entry; else index.push(entry); await chrome.storage.local.set({ [SCHEMAS_KEY]: schemas, [SCHEMA_INDEX_KEY]: index }); return { ok: true, schema: recipe }; }); },
  SCHEMA_DELETE({ id }) { return serialSite(async () => { const safeId = recipeId(id); const { schemas, index } = await readSchemas(); delete schemas[safeId]; await chrome.storage.local.set({ [SCHEMAS_KEY]: schemas, [SCHEMA_INDEX_KEY]: index.filter((item) => item.id !== safeId) }); return { ok: true }; }); },
  async SCHEMA_MATCH({ url }) { if (typeof url !== 'string' || !url) return []; let u; try { u = new URL(url); } catch { return []; } const { schemas, index } = await readSchemas(); const matches = []; for (const entry of index) { const recipe = schemas[entry.id]; if (!recipe || (entry.domain && entry.domain !== u.hostname)) continue; try { if (!compilePathPattern(entry.pathPattern || '/').test(u.pathname)) continue; } catch { continue; } matches.push({ ...entry, score: (entry.pathPattern === u.pathname ? 100 : 0) + (entry.pathPattern || '').length }); } return matches.sort((a, b) => b.score - a.score); },
};
chrome.runtime.onMessage.addListener((msg, _sender, send) => { if (!msg || msg.lasso !== true || !handlers[msg.type]) return false; Promise.resolve().then(() => handlers[msg.type](msg)).then((data) => send({ ok: true, data }), (e) => send({ ok: false, error: String(e && e.message || e) })); return true; });
