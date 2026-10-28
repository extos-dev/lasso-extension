// Background service worker: panel behaviour + the ONLY place that touches chrome.storage (charter rule).
const SITES_KEY = 'sites';          // { [hostname]: { name, firstSeen, lastSeen, visits, lastKind } }
const SCHEMAS_KEY = 'schemas';      // { [id]: schema }
const SCHEMA_INDEX_KEY = 'schemaIndex'; // array of {id, name, domain, pathPattern}
const MAX_SITES = 500;

function enablePanelOnActionClick() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}
chrome.runtime.onInstalled.addListener(enablePanelOnActionClick);
chrome.runtime.onStartup.addListener(enablePanelOnActionClick);

async function readSites() { return (await chrome.storage.local.get(SITES_KEY))[SITES_KEY] || {}; }

// Serialize read-modify-write site updates. Two panels touching different hosts
// at the same time must not lose one another's writes.
let siteQueue = Promise.resolve();
const serialSite = (fn) => { const p = siteQueue.then(fn, fn); siteQueue = p.catch(() => {}); return p; };

const handlers = {
  async SITE_GET({ hostname }) { const s = await readSites(); return s[hostname] || null; },
  SITE_TOUCH(args) {
    return serialSite(async () => {
      const { hostname, name, kind } = args;
      const sites = await readSites(), now = Date.now(), prev = sites[hostname];
      sites[hostname] = { name: name || prev?.name || hostname, firstSeen: prev?.firstSeen || now, lastSeen: now, visits: (prev?.visits || 0) + 1, lastKind: kind || prev?.lastKind || null };
      const keys = Object.keys(sites);
      if (keys.length > MAX_SITES) for (const k of keys.sort((a, b) => sites[a].lastSeen - sites[b].lastSeen).slice(0, keys.length - MAX_SITES)) delete sites[k];
      await chrome.storage.local.set({ [SITES_KEY]: sites });
      return { previous: prev || null, current: sites[hostname] };
    });
  },
  SITES_CLEAR() { return serialSite(async () => { await chrome.storage.local.remove(SITES_KEY); return { ok: true }; }); },
  
  // Schema storage (Milestone B foundation)
  async SCHEMA_LIST() {
    const data = await chrome.storage.local.get([SCHEMAS_KEY, SCHEMA_INDEX_KEY]);
    return { schemas: data[SCHEMAS_KEY] || {}, index: data[SCHEMA_INDEX_KEY] || [] };
  },
  async SCHEMA_GET({ id }) {
    const data = await chrome.storage.local.get(SCHEMAS_KEY);
    const schemas = data[SCHEMAS_KEY] || {};
    return schemas[id] || null;
  },
  SCHEMA_SAVE(args) {
    return serialSite(async () => {
      const { schema } = args;
      if (!schema || !schema.id) throw new Error('Schema needs an id');
      const data = await chrome.storage.local.get([SCHEMAS_KEY, SCHEMA_INDEX_KEY]);
      const schemas = data[SCHEMAS_KEY] || {};
      const index = data[SCHEMA_INDEX_KEY] || [];
      schemas[schema.id] = { ...schema, updatedAt: Date.now() };
      // Update index
      const idx = index.findIndex((i) => i.id === schema.id);
      const entry = { id: schema.id, name: schema.name, domain: schema.match?.domain, pathPattern: schema.match?.pathPattern, kind: schema.kind, updatedAt: Date.now() };
      if (idx >= 0) index[idx] = entry; else index.push(entry);
      await chrome.storage.local.set({ [SCHEMAS_KEY]: schemas, [SCHEMA_INDEX_KEY]: index });
      return { ok: true, schema: schemas[schema.id] };
    });
  },
  SCHEMA_DELETE({ id }) {
    return serialSite(async () => {
      const data = await chrome.storage.local.get([SCHEMAS_KEY, SCHEMA_INDEX_KEY]);
      const schemas = data[SCHEMAS_KEY] || {};
      const index = data[SCHEMA_INDEX_KEY] || [];
      delete schemas[id];
      const newIndex = index.filter((i) => i.id !== id);
      await chrome.storage.local.set({ [SCHEMAS_KEY]: schemas, [SCHEMA_INDEX_KEY]: newIndex });
      return { ok: true };
    });
  },
  async SCHEMA_MATCH({ url }) {
    if (!url) return [];
    let u;
    try { u = new URL(url); } catch { return []; }
    const data = await chrome.storage.local.get([SCHEMAS_KEY, SCHEMA_INDEX_KEY]);
    const schemas = data[SCHEMAS_KEY] || {};
    const index = data[SCHEMA_INDEX_KEY] || [];
    const matches = [];
    for (const entry of index) {
      if (entry.domain && entry.domain !== u.hostname) continue;
      if (entry.pathPattern) {
        // simple pattern matching
        const pat = entry.pathPattern.replace(/\*/g, '.*').replace(/:[^/]+/g, '[^/]+');
        try {
          const re = new RegExp('^' + pat + '$');
          if (!re.test(u.pathname)) continue;
        } catch { /* ignore bad patterns */ }
      }
      if (schemas[entry.id]) {
        matches.push({ ...entry, score: entry.pathPattern && entry.pathPattern.includes(u.pathname) ? 2 : 1 });
      }
    }
    matches.sort((a, b) => b.score - a.score);
    return matches;
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (!msg || msg.lasso !== true || !handlers[msg.type]) return false;   // ignore everything else (page → panel messages are not ours)
  handlers[msg.type](msg).then((data) => send({ ok: true, data }), (e) => send({ ok: false, error: String(e && e.message || e) }));
  return true;
});
