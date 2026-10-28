// Tiny observable store. Views subscribe and re-render; no framework needed.
const listeners = new Set();
export const state = {
  tab: null, light: null, site: null, wasFirstVisit: null,
  inspect: null, tree: null, selectedId: null, selected: null, hoverId: null, breadcrumb: [],
  patterns: [], patternsReady: false, catalog: [], patternPick: ['text'], results: [], outputItems: [], expandedResults: [], result: null, rendered: null,
  format: 'markdown', bom: true, busy: false, error: null, view: 'page',
  pageSiteType: null, pageRecipes: [], pageScanResults: [], pageScanItems: [], pageScanExpanded: [], pageScanBusy: false, pageScanFormat: 'markdown',
  scanScope: null,
  scanPatterns: ['article', 'table', 'list', 'text'],
};
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const set = (patch) => { Object.assign(state, patch); for (const fn of listeners) fn(state); };
