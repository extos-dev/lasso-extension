import { activeTab, send, ensureEngine, bg, isRestricted, isPermissionError, restrictedMessage, scanAllPage, scanSetScope, scanGetScope, scanClearScope } from './api.js';
import { state, set, subscribe } from './state.js';
import { h } from './dom.js';
import { renderPage } from './views/page.js';
import { renderMap } from './views/map.js';
import { renderOutput } from './views/output.js';


const $ = (id) => document.getElementById(id);
const notice = (msg) => { const n = $('notice'); n.hidden = !msg; n.textContent = msg || ''; };
const friendly = (e) => isPermissionError(e)
  ? 'Chrome blocked access to this tab. Check the extension’s site access setting, or open a regular web page.'
  : /Receiving end|Could not establish|message port|message channel/i.test(e.message)
    ? 'The page changed or is still loading. Go to Page and Retry.'
    : e.message;

let gen = 0;
const tabCache = new Map();
const tabUrls = new Map();
const touchedTabs = new Set();
const MAX_TABS = 24;

// Paints are keyed on structural state, so a hover change updates row classes in
// place instead of rebuilding the tree. Hover is the only high-frequency producer
// and is coalesced to one paint per frame; every other change paints immediately.
const raf = typeof requestAnimationFrame === 'function'
  ? (fn) => requestAnimationFrame(fn)
  : (fn) => setTimeout(fn, 16);
const cancelRaf = typeof cancelAnimationFrame === 'function'
  ? (id) => cancelAnimationFrame(id)
  : (id) => clearTimeout(id);
let frame = 0;
let lastKey = null;
let lastHover;

function scheduleHoverPaint() {
  if (!frame) frame = raf(() => { frame = 0; paint(); });
}

/** Paint now, cancelling any pending hover frame. The store subscriber for every non-hover change. */
function flushPaint() {
  if (frame) { cancelRaf(frame); frame = 0; }
  paint();
}

/** Everything the three views read, except hoverId. */
function structuralKey() {
  const tree = state.tree;
  return JSON.stringify([
    state.tab && state.tab.id, state.light, state.site, state.wasFirstVisit, state.busy, state.view,
    state.inspect && [state.inspect.active, state.inspect.url, state.inspect.stats],
    tree ? tree.root : null,
    tree ? [...tree.expanded] : null,
    tree ? [...tree.nodes.values()].map((n) => [n.id, n.childIds ? n.childIds.length : -1, n.truncatedChildren || 0]) : null,
    tree ? [...tree.loading] : null,
    state.selected, state.selectedId, state.breadcrumb, state.patternsReady, state.patternPick,
    state.catalog, state.results, state.result, state.rendered,
    state.outputItems, state.expandedResults, state.format, state.bom,
    state.pageSiteType, state.pageRecipes, state.pageScanResults, state.pageScanItems, state.pageScanExpanded, state.pageScanBusy,
    state.scanConfigOpen, state.selectingScanParent, state.scanScope, state.scanScopeLabel, state.scanPatterns,
  ]);
}

/** Hover is visual only: toggle classes on the rows already rendered. */
function applyHover() {
  for (const row of document.querySelectorAll('#view-map .node-row')) {
    const id = Number(row.dataset.nodeId);
    row.classList.toggle('hover', state.hoverId !== null && state.hoverId !== undefined && id === state.hoverId);
  }
}

function saveUi() {
  const id = state.tab && state.tab.id;
  if (!id) return;
  tabCache.set(id, {
    view: state.view, format: state.format, bom: state.bom, rendered: state.rendered,
    inspect: state.inspect, tree: state.tree, selectedId: state.selectedId, selected: state.selected,
    breadcrumb: state.breadcrumb, patterns: state.patterns, patternsReady: state.patternsReady,
    catalog: state.catalog, patternPick: state.patternPick, results: state.results,
    outputItems: state.outputItems, expandedResults: state.expandedResults, result: state.result,
  });
  while (tabCache.size > MAX_TABS) {
    const oldest = tabCache.keys().next().value;
    if (oldest === id) break;
    tabCache.delete(oldest);
  }
}

function makeTree(st) {
  const nodes = new Map();
  const kids = (st && st.rootChildren) || [];
  if (st && st.root) nodes.set(st.root.id, { ...st.root, childIds: kids.map((c) => c.id) });
  for (const c of kids) if (!nodes.has(c.id)) nodes.set(c.id, { ...c });
  return { root: st && st.root, nodes, expanded: new Set(st && st.root ? [st.root.id] : []), loading: new Set() };
}

function scrollRowTo(id) {
  if (id === null || id === undefined) return;
  flushPaint();
  const row = document.querySelector(`#view-map .node-row[data-node-id="${id}"]`);
  if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
}

async function revealPath(crumbs, tabId) {
  if (!crumbs || !crumbs.length || !state.tree) return;
  for (const b of crumbs) {
    if (state.tab && state.tab.id !== tabId) return;
    if (!state.tree) return;
    const n = state.tree.nodes.get(b.id);
    if (!n) continue;
    if (n.childCount > 0 && n.childIds === undefined) await ensureChildren(b.id, tabId);
    if (!state.tree) return;
    const cur = state.tree, node = cur.nodes.get(b.id);
    if (node && node.childIds && node.childIds.length && !cur.expanded.has(b.id)) {
      cur.expanded.add(b.id);
      set({ tree: { ...cur } });
    }
  }
}

async function ensureChildren(id, tabId) {
  const tree = state.tree;
  if (!tree || !tree.nodes.has(id)) return;
  const node = tree.nodes.get(id);
  if (node.childIds !== undefined || tree.loading.has(id)) return;
  tree.loading.add(id);
  set({ tree: { ...tree } });
  try {
    const res = await send(tabId, 'INSPECT_TREE', { nodeId: id });
    if (!state.tab || state.tab.id !== tabId || !state.tree) return;
    const cur = state.tree, n = cur.nodes.get(id);
    if (!n) return;
    for (const c of res.children) cur.nodes.set(c.id, c);
    n.childIds = res.children.map((c) => c.id);
    n.truncatedChildren = Math.max(0, res.total - res.children.length);
    cur.loading.delete(id);
    set({ tree: { ...cur } });
  } catch (e) {
    if (state.tab && state.tab.id === tabId && state.tree) {
      state.tree.loading.delete(id);
      set({ tree: { ...state.tree } });
      notice(friendly(e));
    }
  }
}

async function stage0() {
  const my = ++gen;
  saveUi();
  notice(null);
  const tab = await activeTab();
  if (my !== gen) return;
  set({ tab, light: null, site: null, wasFirstVisit: null, inspect: null, tree: null, selectedId: null, selected: null, hoverId: null, breadcrumb: [], patterns: [], patternsReady: false, catalog: [], patternPick: ['text'], results: [], outputItems: [], expandedResults: [], result: null, rendered: null, view: 'page', busy: false, pageSiteType: null, pageRecipes: [], pageScanResults: [], pageScanItems: [], pageScanExpanded: [], pageScanBusy: false });
  if (!tab || !tab.id) return;
  tabUrls.set(tab.id, tab.url || '');
  if (isRestricted(tab.url)) { notice(restrictedMessage(tab.url)); return; }
  try {
    await ensureEngine(tab.id);
    if (my !== gen) return;
    const light = await send(tab.id, 'LIGHT');
    if (my !== gen) return;
    const prior = await bg('SITE_GET', { hostname: light.hostname });
    if (my !== gen) return;
    set({ light, site: prior, wasFirstVisit: !prior, pageSiteType: light.siteName || light.hostname });

    let st = null;
    try { st = await send(tab.id, 'INSPECT_STATE'); } catch (_) { st = null; }
    if (my !== gen) return;
    const cached = tabCache.get(tab.id);
    if (st && st.active) {
      const tree = makeTree(st);
      const keep = !!(cached && cached.inspect && cached.inspect.active);
      const view = keep ? (cached.view || 'map') : 'map';
      set({
        inspect: st, tree: makeTree(st), selectedId: st.selectedId ?? null, selected: st.selected ?? null, hoverId: null,
        breadcrumb: st.breadcrumb || [], patterns: st.patterns || [], patternsReady: !!st.patternsReady,
        catalog: st.catalog || [], results: st.results || [], patternPick: st.patternsReady ? (st.results || []).map((r) => r.pattern) : ['text'],
        outputItems: [], expandedResults: [], result: st.lastResult || null,
        format: (cached && cached.format) || 'markdown', bom: cached ? cached.bom !== false : true,
        rendered: null, view, pageScanResults: [], pageScanItems: [], pageScanExpanded: [],
      });
      if (st.selectedId !== null && st.selectedId !== undefined) revealPath(st.breadcrumb || [], tab.id).then(() => scrollRowTo(st.selectedId));
      if (view === 'output' && (st.results || []).length > 1) renderAll();
      else if (view === 'output' && st.lastResult) render();
      else if (view === 'output') set({ view: 'map' });
    } else {
      set({ inspect: st || { active: false }, view: 'page', format: (cached && cached.format) || 'markdown', rendered: null, pageScanResults: [], pageScanItems: [], pageScanExpanded: [] });
    }
  } catch (e) {
    if (my === gen) notice(friendly(e));
  }
}

async function scanAllPageAction() {
  if (!state.tab || !state.light) return;
  const tabId = state.tab.id;
  set({ pageScanBusy: true });
  notice(null);
  try {
    await ensureEngine(tabId);
    if (!state.tab || state.tab.id !== tabId) return;
    // Apply scope if set
    if (state.scanScope) {
      try { await scanSetScope(tabId, state.scanScope); } catch (_) {}
    } else {
      try { await scanClearScope(tabId); } catch (_) {}
    }
    const res = await scanAllPage(tabId, state.scanPatterns && state.scanPatterns.length ? state.scanPatterns : undefined);
    if (!state.tab || state.tab.id !== tabId) return;
    const results = res.results || res.data?.results || [];
    set({ pageScanResults: results, pageScanItems: [], pageScanExpanded: [], pageScanBusy: false });
  } catch (e) {
    if (state.tab && state.tab.id === tabId) { set({ pageScanBusy: false }); notice(friendly(e)); }
  }
}

async function renderPageScanAll() {
  if (!state.pageScanResults.length || !state.tab) return set({ pageScanItems: [] });
  const tabId = state.tab.id;
  try {
    const out = await send(tabId, 'INSPECT_RENDER_ALL', { format: state.pageScanFormat || state.format, results: state.pageScanResults });
    if (state.tab && state.tab.id === tabId) set({ pageScanItems: out.items || [] });
  } catch (e) {
    if (state.tab && state.tab.id === tabId) { set({ pageScanItems: [] }); notice(friendly(e)); }
  }
}

async function startInspect() {
  if (!state.tab) return;
  const tabId = state.tab.id;
  set({ busy: true });
  notice(null);
  try {
    await ensureEngine(tabId);
    if (!state.tab || state.tab.id !== tabId) return set({ busy: false });
    const light = state.light || await send(tabId, 'LIGHT');
    if (!state.tab || state.tab.id !== tabId) return set({ busy: false });
    if (!state.light) set({ light });
    const st = await send(tabId, 'INSPECT_START');
    if (!state.tab || state.tab.id !== tabId) return set({ busy: false });
    let touched = null;
    if (!touchedTabs.has(tabId)) {
      try {
        touched = await bg('SITE_TOUCH', { hostname: light.hostname, name: light.siteName, kind: 'inspect' });
        touchedTabs.add(tabId);
      } catch (_) { /* site profile is optional */ }
    }
    set({
      inspect: st, tree: makeTree(st), selectedId: null, selected: null, hoverId: null, breadcrumb: [], patterns: [], patternsReady: false,
      catalog: st.catalog || [], patternPick: ['text'], results: [], outputItems: [], expandedResults: [],
      result: null, rendered: null, view: 'map', busy: false,
      site: touched ? touched.current : state.site,
      wasFirstVisit: touched ? !touched.previous : state.wasFirstVisit,
    });
  } catch (e) {
    if (state.tab && state.tab.id === tabId) { set({ busy: false }); notice(friendly(e)); }
  }
}

async function stopInspect() {
  const tabId = state.tab && state.tab.id;
  if (!tabId) return;
  set({ busy: true });
  try {
    const st = await send(tabId, 'INSPECT_STOP');
    if (!state.tab || state.tab.id !== tabId) return;
    set({ inspect: st, tree: null, selectedId: null, selected: null, hoverId: null, breadcrumb: [], patterns: [], patternsReady: false, catalog: st.catalog || [], patternPick: ['text'], results: [], outputItems: [], expandedResults: [], result: null, rendered: null, view: 'page', busy: false });
  } catch (e) {
    if (state.tab && state.tab.id === tabId) {
      set({ inspect: { active: false }, tree: null, selectedId: null, selected: null, hoverId: null, breadcrumb: [], patterns: [], patternsReady: false, catalog: [], patternPick: ['text'], results: [], outputItems: [], expandedResults: [], result: null, rendered: null, view: 'page', busy: false });
      notice(friendly(e));
    }
  }
}

async function selectNode(id, scroll = true) {
  if (!state.inspect || !state.inspect.active || !state.tab) return;
  const tabId = state.tab.id;
  try {
    const res = await send(tabId, 'INSPECT_SELECT', { nodeId: id, scroll });
    if (!state.tab || state.tab.id !== tabId || !state.inspect || !state.inspect.active) return;
    const ready = !!res.patternsReady;
    set({
      selectedId: id, selected: res.selected, hoverId: null, breadcrumb: res.breadcrumb || [], patterns: res.patterns || [],
      patternsReady: ready, catalog: res.catalog || state.catalog,
      patternPick: ready ? state.patternPick : ['text'], results: ready ? (res.results || []) : [],
      outputItems: [], expandedResults: [], result: ready ? state.result : null, rendered: ready ? state.rendered : null,
      view: 'map', inspect: { ...state.inspect, stats: res.stats, selectedId: id, selected: res.selected },
    });
    await revealPath(res.breadcrumb || [], tabId);
    scrollRowTo(id);
  } catch (e) { notice(friendly(e)); }
}

async function expandNode(id) {
  if (!state.tree) return;
  const tree = state.tree, node = tree.nodes.get(id);
  if (!node) return;
  if (tree.expanded.has(id)) {
    tree.expanded.delete(id);
    set({ tree: { ...tree } });
    return;
  }
  if (!node.childCount) return;
  tree.expanded.add(id);
  set({ tree: { ...tree } });
  if (node.childIds === undefined && state.tab) await ensureChildren(id, state.tab.id);
}

async function render() {
  if (!state.result || !state.tab) return set({ rendered: null });
  const tabId = state.tab.id;
  try {
    const out = await send(tabId, 'INSPECT_RENDER', { format: state.format });
    if (state.tab && state.tab.id === tabId) set({ rendered: out });
  } catch (e) {
    if (state.tab && state.tab.id === tabId) { set({ rendered: null }); notice(friendly(e)); }
  }
}

async function renderAll() {
  if (!state.results.length || !state.tab) return set({ outputItems: [] });
  const tabId = state.tab.id;
  try {
    const out = await send(tabId, 'INSPECT_RENDER_ALL', { format: state.format });
    if (state.tab && state.tab.id === tabId) set({ outputItems: out.items || [] });
  } catch (e) {
    if (state.tab && state.tab.id === tabId) { set({ outputItems: [] }); notice(friendly(e)); }
  }
}

function applyDetection(res) {
  const results = res.results || [];
  const single = results.length === 1 ? results[0] : null;
  set({
    patterns: res.patterns || [], patternsReady: true, catalog: res.catalog || state.catalog,
    patternPick: results.map((r) => r.pattern), results, busy: false,
    selected: res.selected, breadcrumb: res.breadcrumb || [],
    result: single && single.ok ? single.result : null,
    outputItems: [], expandedResults: [], rendered: null,
    view: results.length > 1 ? 'output' : 'map',
    inspect: { ...state.inspect, stats: res.stats, selected: res.selected, selectedId: res.selectedId },
  });
  if (results.length > 1) renderAll();
}

async function detectPatterns() {
  if (!state.inspect || !state.inspect.active || !state.tab || state.selectedId === null || state.selectedId === undefined) return;
  if (!state.patternPick.length) { notice('Choose at least one pattern.'); return; }
  const tabId = state.tab.id;
  set({ busy: true });
  notice(null);
  try {
  const res = await send(tabId, 'INSPECT_PATTERNS', { nodeId: state.selectedId, patterns: state.patternPick, opts: { scoped: true } });
  if (!state.tab || state.tab.id !== tabId) return;
  applyDetection(res);
  } catch (e) {
    if (state.tab && state.tab.id === tabId) { set({ busy: false }); notice(friendly(e)); }
  }
}

async function sendToOutput() {
  if (!state.results.length) return;
  if (state.results.length > 1) {
    set({ view: 'output', rendered: null });
    if (!state.outputItems.length) await renderAll();
    return;
  }
  const item = state.results[0];
  if (!item.ok) return;
  set({ result: item.result || state.result, view: 'output', rendered: null });
  await render();
}

async function saveSchema() {
  if (!state.result) return;
  try {
    const id = 'schema_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    const hostname = state.light?.hostname || '';
    const schema = {
      schemaVersion: 1,
      id,
      name: state.result.label || (state.result.kind + ' from ' + hostname),
      origin: 'manual',
      match: { domain: hostname, pageKind: state.result.kind },
      kind: state.result.kind,
      container: state.selectedId ? { nodeId: state.selectedId } : {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await bg('SCHEMA_SAVE', { schema });
    notice('Schema saved.');
    setTimeout(() => notice(null), 2000);
  } catch (e) {
    notice('Failed to save schema: ' + friendly(e));
  }
}

function togglePatternPick(id, checked) {
  let pick = state.patternPick.slice();
  if (checked) {
    if (id !== 'text') pick = pick.filter((x) => x !== 'text');
    if (!pick.includes(id)) pick.push(id);
  } else pick = pick.filter((x) => x !== id);
  set({ patternPick: pick });
}

function changePatterns() {
  set({
    patternsReady: false, patternPick: ['text'], results: [], result: null,
    outputItems: [], expandedResults: [], rendered: null, view: 'map',
  });
}

function onPageMessage(m, sender) {
  if (!m || m.lasso !== true) return;
  if (sender && sender.tab && state.tab && sender.tab.id !== state.tab.id) return;
  if (m.type === 'NODE_SELECTED') {
    if (!state.inspect || !state.inspect.active) return;
    if (state.selectingScanParent) {
      set({
        scanScope: m.selectedId,
        scanScopeLabel: m.selected?.label || String(m.selectedId),
        selectingScanParent: false,
        selectedId: m.selectedId,
        selected: m.selected,
        breadcrumb: m.breadcrumb || [],
      });
      if (state.tab) { scanSetScope(state.tab.id, m.selectedId).catch(() => {}); }
      notice('Parent node selected for scanning.');
      setTimeout(() => notice(null), 1500);
      return;
    }
    const ready = !!m.patternsReady;
    set({
      selectedId: m.selectedId, selected: m.selected, hoverId: null, breadcrumb: m.breadcrumb || [], patterns: m.patterns || [],
      patternsReady: ready, catalog: m.catalog || state.catalog,
      patternPick: ready ? state.patternPick : ['text'], results: ready ? (m.results || []) : [],
      outputItems: [], expandedResults: [], result: ready ? state.result : null, rendered: ready ? state.rendered : null,
      view: 'map', inspect: { ...state.inspect, stats: m.stats, selectedId: m.selectedId, selected: m.selected },
    });
    if (sender && sender.tab) revealPath(m.breadcrumb || [], sender.tab.id).then(() => scrollRowTo(m.selectedId));
  } else if (m.type === 'NODE_HOVERED') {
    if (!state.inspect || !state.inspect.active) return;
    if (state.hoverId !== m.id) { state.hoverId = m.id; scheduleHoverPaint(); }
  } else if (m.type === 'PATTERNS_DETECTED') {
    if (!state.inspect || !state.inspect.active) return;
    applyDetection(m);
  } else if (m.type === 'SHOW_OUTPUT') {
    if (!state.inspect || !state.inspect.active) return;
    sendToOutput();
  } else if (m.type === 'PATTERN_ERROR') {
    notice(m.error || 'That pattern did not apply.');
  } else if (m.type === 'INSPECT_EXITED') {
    if (!state.inspect || !state.inspect.active) return;
    set({ inspect: { active: false }, tree: null, selectedId: null, selected: null, hoverId: null, breadcrumb: [], patterns: [], patternsReady: false, catalog: [], patternPick: ['text'], results: [], outputItems: [], expandedResults: [], result: null, rendered: null, view: 'page' });
  }
}

const actions = {
  async toggleInspect() {
    if (state.inspect && state.inspect.active) return stopInspect();
    return startInspect();
  },
  toggleScanConfig() {
    set({ scanConfigOpen: !state.scanConfigOpen });
  },
  async selectParentNode() {
    set({ selectingScanParent: true });
    notice('Click any element on the page to set as scan parent node.');
    if (!state.inspect || !state.inspect.active) {
      await startInspect();
    }
  },
  scanAllPage: () => scanAllPageAction(),
  toggleScanPattern(id, checked) {
    let pick = (state.scanPatterns || []).slice();
    if (checked) {
      if (!pick.includes(id)) pick.push(id);
    } else {
      pick = pick.filter((x) => x !== id);
    }
    set({ scanPatterns: pick });
  },
  async setScanScopeFromSelection() {
    if (!state.selectedId || !state.tab) return;
    set({ scanScope: state.selectedId, scanScopeLabel: state.selected?.label || String(state.selectedId) });
    try { await scanSetScope(state.tab.id, state.selectedId); } catch (_) {}
    set({ view: 'page' });
    notice('Scan scope set to selected node.');
    setTimeout(() => notice(null), 1500);
  },
  async clearScanScope() {
    set({ scanScope: null, scanScopeLabel: null });
    if (state.tab) { try { await scanClearScope(state.tab.id); } catch (_) {} }
  },
  togglePageScanResult: (pattern) => {
    const cur = (state.pageScanExpanded || []).slice();
    const i = cur.indexOf(pattern);
    if (i >= 0) cur.splice(i, 1); else cur.push(pattern);
    set({ pageScanExpanded: cur });
  },
  async pageScanFormat(id) {
    set({ pageScanFormat: id });
    if (state.pageScanResults.length > 1) await renderPageScanAll();
  },
  async copyPageScanResult(pattern) {
    const item = (state.pageScanResults || []).find((x) => x.pattern === pattern && x.ok && x.result);
    if (item) {
      try {
        const tabId = state.tab && state.tab.id;
        if (tabId) {
          // Set as last result temporarily
          const res = await send(tabId, 'INSPECT_SELECT', { nodeId: item.result.nodeId, scroll: false }).catch(() => null);
        }
      } catch (_) {}
    }
    const renderedItem = (state.pageScanItems || []).find((x) => x.pattern === pattern);
    if (renderedItem && renderedItem.rendered) {
      try { await navigator.clipboard.writeText(renderedItem.rendered.text); notice('Copied to clipboard.'); setTimeout(() => notice(null), 1500); return; }
      catch (_) {}
    }
    try { await navigator.clipboard.writeText(JSON.stringify(item?.result || item, null, 2)); notice('Copied to clipboard.'); setTimeout(() => notice(null), 1500); }
    catch (_) { notice('Clipboard blocked.'); }
  },
  downloadPageScanResult(pattern) {
    const item = (state.pageScanItems || []).find((x) => x.pattern === pattern);
    if (!item || !item.rendered) return;
    const bom = (state.pageScanFormat || state.format) === 'csv' && state.bom ? '\uFEFF' : '';
    const url = URL.createObjectURL(new Blob([bom + item.rendered.text], { type: item.rendered.mime + ';charset=utf-8' }));
    const a = h('a', { href: url, download: item.rendered.filename });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
  retry: () => stage0(),
  async clearHistory() {
    try {
      await bg('SITES_CLEAR');
      set({ site: null, wasFirstVisit: true });
      notice('Site history cleared.');
    } catch (e) { notice(friendly(e)); }
  },
  openMap: () => set({ view: 'map' }),
  exitInspect: () => stopInspect(),
  selectNode: (id, scroll) => selectNode(id, scroll !== false),
  expand: (id) => expandNode(id),
  detectPatterns: () => detectPatterns(),
  togglePatternPick: (id, checked) => togglePatternPick(id, checked),
  changePatterns: () => changePatterns(),
  sendToOutput: () => sendToOutput(),
  saveSchema: () => saveSchema(),
  toggleResult: (pattern) => {
    const cur = state.expandedResults.slice();
    const i = cur.indexOf(pattern);
    if (i >= 0) cur.splice(i, 1); else cur.push(pattern);
    set({ expandedResults: cur });
  },
  setView(view) {
    set({ view });
    if (view !== 'output') return;
    if (state.results.length > 1) { if (!state.outputItems.length) renderAll(); }
    else if (state.result && !state.rendered) render();
  },
  async format(id) {
    set({ format: id });
    if (state.results.length > 1) await renderAll();
    else if (state.result) await render();
  },
  bom(v) { set({ bom: v }); },
  async export(id) {
    set({ format: id });
    if (state.results.length > 1) {
      if (!state.outputItems.length) await renderAll();
      await this.exportAll(id);
      return;
    }
    if (state.result) {
      await render();
      this.download();
      return;
    }
  },
  async exportAll(id) {
    set({ format: id });
    await renderAll();
    const bom = state.format === 'csv' && state.bom ? '\uFEFF' : '';
    const items = (state.outputItems || []).filter((x) => x.ok && x.rendered);
    if (!items.length) return;
    if (items.length === 1) {
      const o = items[0].rendered;
      const url = URL.createObjectURL(new Blob([bom + o.text], { type: o.mime + ';charset=utf-8' }));
      const a = h('a', { href: url, download: o.filename });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
      return;
    }
    // concatenate as a simple multi-document export
    const parts = [];
    for (const it of items) {
      parts.push(`## ${it.label}\n\n` + it.rendered.text + '\n\n---\n\n');
    }
    const text = parts.join('');
    const mime = items[0].rendered.mime || 'text/plain';
    const ext = items[0].rendered.filename && items[0].rendered.filename.includes('.') ? items[0].rendered.filename.split('.').pop() : state.format;
    const url = URL.createObjectURL(new Blob([bom + text], { type: mime + ';charset=utf-8' }));
    const a = h('a', { href: url, download: `lasso-output.${ext}` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
  async copy() {
    if (!state.rendered) return;
    try { await navigator.clipboard.writeText(state.rendered.text); notice('Copied to clipboard.'); setTimeout(() => notice(null), 1500); }
    catch (_) { notice('Clipboard blocked — use Download instead.'); }
  },
  async copyResult(pattern) {
    const item = state.outputItems.find((x) => x.pattern === pattern);
    if (!item || !item.rendered) return;
    try { await navigator.clipboard.writeText(item.rendered.text); notice('Copied to clipboard.'); setTimeout(() => notice(null), 1500); }
    catch (_) { notice('Clipboard blocked — use Download instead.'); }
  },
  download() {
    const o = state.rendered;
    if (!o) return;
    const bom = state.format === 'csv' && state.bom ? '\uFEFF' : '';
    const url = URL.createObjectURL(new Blob([bom + o.text], { type: o.mime + ';charset=utf-8' }));
    const a = h('a', { href: url, download: o.filename });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
  downloadResult(pattern) {
    const item = state.outputItems.find((x) => x.pattern === pattern);
    if (!item || !item.rendered) return;
    const bom = state.format === 'csv' && state.bom ? '\uFEFF' : '';
    const url = URL.createObjectURL(new Blob([bom + item.rendered.text], { type: item.rendered.mime + ';charset=utf-8' }));
    const a = h('a', { href: url, download: item.rendered.filename });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
};

$('inspectToggle').addEventListener('click', () => actions.toggleInspect());
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => actions.setView(b.dataset.view)));

function resetInspect() {
  set({ inspect: null, tree: null, selectedId: null, selected: null, hoverId: null, breadcrumb: [], patterns: [], patternsReady: false, catalog: [], patternPick: ['text'], results: [], outputItems: [], expandedResults: [], result: null, rendered: null, view: 'page', pageScanResults: [], pageScanItems: [], pageScanExpanded: [] });
}

chrome.runtime.onMessage.addListener(onPageMessage);
chrome.tabs.onActivated.addListener(() => stage0());
chrome.tabs.onUpdated.addListener((id, info) => {
  const prev = tabUrls.get(id);
  const navigated = !!(info.url && prev && info.url !== prev);
  if (info.url) tabUrls.set(id, info.url);
  const isActive = !!(state.tab && state.tab.id === id);
    if (info.status === 'loading' || navigated) {
      tabCache.delete(id);
      touchedTabs.delete(id);
      if (isActive) { resetInspect(); set({ pageSiteType: null, pageRecipes: [], pageScanResults: [], pageScanItems: [], pageScanExpanded: [], pageScanBusy: false }); }
      if (navigated) chrome.tabs.sendMessage(id, { lasso: true, type: 'INSPECT_STOP' }).catch(() => {});
    }
    if (info.status === 'complete' && isActive) stage0();
});
chrome.tabs.onRemoved.addListener((id) => { tabCache.delete(id); tabUrls.delete(id); touchedTabs.delete(id); });

function paint() {
  const key = structuralKey();
  if (key === lastKey) {
    if (lastHover !== state.hoverId) { applyHover(); lastHover = state.hoverId; }
    return;
  }
  lastKey = key;
  lastHover = state.hoverId;

  $('favicon').src = state.light ? (state.light.favicon || '') : '';
  $('favicon').style.visibility = state.light && state.light.favicon ? 'visible' : 'hidden';
  $('siteName').textContent = state.light ? state.light.siteName : 'Lasso';
  if (!state.light) $('siteMeta').textContent = 'Open a web page, then click Inspect.';
  else if (state.inspect && state.inspect.active) {
    const st = state.inspect.stats;
    $('siteMeta').textContent = `${state.light.hostname} · inspecting${st ? ` · ${st.nodes.toLocaleString()} nodes` : ''}`;
  } else $('siteMeta').textContent = `${state.light.hostname}${state.site ? ` · visit #${state.site.visits}` : ' · first visit'}`;

  const active = !!(state.inspect && state.inspect.active);
  const btn = $('inspectToggle');
  btn.classList.toggle('on', active);
  btn.setAttribute('aria-pressed', String(active));
  btn.disabled = !state.tab || state.busy;
  $('inspectLabel').textContent = state.busy ? 'Working…' : active ? 'Inspecting' : 'Inspect';
  $('inspectToggle').title = active ? 'Stop inspecting this page' : 'Inspect the active page';

  document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === state.view)));
  for (const v of ['page', 'map', 'output']) $('view-' + v).hidden = state.view !== v;
  renderPage($('view-page'), actions);
  renderMap($('view-map'), actions);
  renderOutput($('view-output'), actions);
  applyHover();
}

subscribe(flushPaint);
paint();
stage0();
