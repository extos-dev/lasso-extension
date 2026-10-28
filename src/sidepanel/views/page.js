import { h } from '../dom.js';
import { state } from '../state.js';

const SCAN_PATTERNS = [
  { id: 'article', label: 'Article' },
  { id: 'table', label: 'Table' },
  { id: 'list', label: 'List' },
  { id: 'chat', label: 'Chat' },
  { id: 'contact', label: 'Contact' },
  { id: 'text', label: 'Text' },
];

function renderPageScanResults(root, actions) {
  const results = state.pageScanResults || [];
  if (!results.length) return;
  root.append(h('div', { class: 'card' },
    h('div', { class: 'card-title' }, `Scan results (${results.length})`),
  ));

  for (const it of results) {
    if (!it.ok || !it.result) {
      root.append(h('div', { class: 'card result-card' },
        h('div', { class: 'sel-title' }, h('b', {}, it.label || it.pattern), h('span', { class: 'muted tiny' }, ' not applicable')),
        h('p', { class: 'warn tiny' }, it.reason || ''),
      ));
      continue;
    }
    root.append(h('div', { class: 'card result-card' },
      h('div', { class: 'sel-title' }, h('b', {}, it.result.label || it.label || it.pattern), h('span', { class: 'muted tiny' }, ` ${it.summary || ''}`)),
      h('div', { class: 'row' },
        h('button', { class: 'sec', onclick: () => actions.viewScanResultInOutput && actions.viewScanResultInOutput(it) }, 'View in Output'),
        h('button', { class: 'sec', onclick: () => actions.copyPageScanResult && actions.copyPageScanResult(it.pattern) }, 'Copy'),
      ),
    ));
  }
}

export function renderPage(root, actions) {
  root.replaceChildren();
  if (!state.tab) {
    root.append(h('p', { class: 'muted' }, 'Open a web page to get started.'));
    return;
  }
  if (!state.light) {
    root.append(
      h('p', { class: 'muted' }, 'Lasso can’t read this tab yet. Check Chrome’s site access setting, or open a regular web page.'),
      h('div', { class: 'row' },
        h('button', { class: 'pri', disabled: state.busy, onclick: actions.retry }, 'Retry'),
      ),
    );
    return;
  }

  const l = state.light, site = state.site;
  const siteType = state.pageSiteType || l.siteName || l.hostname;
  root.append(h('div', { class: 'card site-card' },
    h('div', { class: 'card-title' }, l.siteName || l.hostname),
    h('div', { class: 'muted' }, l.hostname + (siteType && siteType !== l.hostname ? ' — ' + siteType : '')),
    h('div', { class: 'site-stats' },
      h('span', {}, h('b', {}, site ? site.visits : 1), ' visits'),
      site && site.lastSeen ? h('span', {}, 'last seen ', new Date(site.lastSeen).toLocaleDateString()) : null,
      site && site.lastKind ? h('span', {}, site.lastKind) : null,
    ),
    h('div', { class: 'muted tiny' }, state.wasFirstVisit ? 'First visit to this site.' : 'Welcome back.'),
  ));

  // Saved extractions / recipes
  const recipes = state.pageRecipes || [];
  root.append(h('div', { class: 'card' },
    h('div', { class: 'card-title' }, 'Saved extractions'),
    recipes.length
      ? h('div', { class: 'list' }, recipes.map((r) => h('div', { class: 'row between' }, h('span', {}, r.name || r.id || 'Recipe'), h('button', { class: 'small', onclick: () => actions.runRecipe && actions.runRecipe(r) }, 'Run'))))
      : h('p', { class: 'muted' }, 'No saved extractions for this site yet.'),
  ));

  // Unified Scan
  root.append(h('div', { class: 'card scan-card' },
    h('div', { class: 'card-title' }, 'Scan'),
    h('div', { class: 'muted tiny' }, state.scanScope ? `Scanning within: ${state.scanScopeLabel || 'selected node'}` : 'Scanning: Whole page'),
    state.scanScope ? h('button', { class: 'link tiny', onclick: () => actions.clearScanScope && actions.clearScanScope() }, 'Clear scope') : null,
    h('div', { class: 'pattern-picks' }, SCAN_PATTERNS.map((p) => {
      const checked = (state.scanPatterns || []).includes(p.id);
      return h('label', { class: 'pick' },
        h('input', { type: 'checkbox', checked, onchange: (e) => actions.toggleScanPattern && actions.toggleScanPattern(p.id, e.target.checked) }),
        h('span', {}, p.label)
      );
    })),
    h('div', { class: 'row' },
      h('button', { class: 'scan-btn', disabled: state.pageScanBusy || state.busy || !(state.scanPatterns && state.scanPatterns.length), onclick: actions.scanAllPage },
        h('span', {}, state.pageScanBusy ? 'Scanning…' : 'Scan')
      ),
    ),
    h('p', { class: 'muted tiny' }, 'Use Inspect → select a node → "Set as scan parent" to scan just that region.'),
  ));

  renderPageScanResults(root, actions);

  if (state.inspect && state.inspect.active) {
    const st = state.inspect.stats || {};
    root.append(h('div', { class: 'card accent' },
      h('div', { class: 'card-title' }, 'Inspect mode is on'),
      h('p', { class: 'muted' }, 'Click any element on the page. Right-click to choose a pattern.'),
      h('div', { class: 'kv' },
        h('span', {}, 'Nodes'), h('b', {}, (st.nodes || 0).toLocaleString()),
        h('span', {}, 'Snapshot'), h('b', {}, `${Math.round(st.snapshotMs || 0)} ms`),
        h('span', {}, 'Selections'), h('b', {}, st.selections || 0),
        h('span', {}, 'Applied'), h('b', {}, st.patternsApplied || 0),
      ),
      st.truncated ? h('p', { class: 'warn tiny' }, 'The DOM is very large; only the first 25,000 nodes are mapped.') : null,
      h('div', { class: 'row' },
        h('button', { class: 'pri', onclick: actions.openMap }, 'Open Map'),
        h('button', { onclick: actions.exitInspect }, 'Exit inspect'),
      ),
    ));
  } else {
    // Intentionally removed the "Point at what you want" card per UX adjustment
  }

  root.append(h('div', { class: 'footnote' },
    h('button', { class: 'link', onclick: actions.retry }, 'Reload page info'),
    h('button', { class: 'link', onclick: actions.clearHistory }, 'Clear all site history'),
  ));
}
