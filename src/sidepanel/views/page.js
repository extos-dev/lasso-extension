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

function getColsForItems(items) {
  if (!Array.isArray(items) || !items.length) return [];
  if (typeof items[0] !== 'object' || items[0] === null) return ['value'];
  const pref = ['title', 'url', 'price', 'date', 'image', 'snippet', 'text'];
  const seen = new Set(items.flatMap((i) => Object.keys(i || {})));
  return [...pref.filter((c) => seen.has(c)), ...[...seen].filter((c) => !pref.includes(c))];
}

function renderTableView(headers, rows) {
  const table = h('table', { class: 'data-table' });
  const thead = h('thead');
  const trh = h('tr');
  const headCols = (headers && headers.length) ? headers : ((rows && rows[0]) ? rows[0].map((_, i) => `Column ${i + 1}`) : []);
  for (const hcol of headCols) {
    trh.append(h('th', {}, h('span', { class: 'table-cell' }, hcol == null ? '' : String(hcol))));
  }
  thead.append(trh);
  table.append(thead);
  const tbody = h('tbody');
  const len = headCols.length || ((rows && rows[0]) ? rows[0].length : 0);
  for (const row of (rows || [])) {
    const tr = h('tr');
    for (let i = 0; i < len; i++) {
      const val = row && row[i] != null ? row[i] : '';
      tr.append(h('td', {}, h('span', { class: 'table-cell' }, String(val))));
    }
    tbody.append(tr);
  }
  table.append(tbody);
  const wrap = h('div', { class: 'table-wrap' });
  wrap.append(table);
  return wrap;
}

function renderScanResultDetail(it, renderedItem) {
  const res = it.result;
  if (!res) return h('div', { class: 'muted tiny' }, 'No result details');

  if (res.kind === 'table' && Array.isArray(res.rows)) {
    return renderTableView(res.headers, res.rows);
  }
  if (res.kind === 'record_list' && Array.isArray(res.items)) {
    const items = res.items;
    if (items.length && typeof items[0] === 'object' && items[0] !== null) {
      const cols = getColsForItems(items);
      const rows = items.map((i) => cols.map((c) => i[c] ?? ''));
      return renderTableView(cols, rows);
    }
  }
  if (res.kind === 'chat' && Array.isArray(res.messages)) {
    const rows = res.messages.map((m) => [m.role || '', m.text || '']);
    return renderTableView(['role', 'text'], rows);
  }
  if (res.kind === 'contact') {
    const rows = [[
      res.name || '',
      Array.isArray(res.emails) ? res.emails.join('; ') : (res.emails || ''),
      Array.isArray(res.phones) ? res.phones.join('; ') : (res.phones || ''),
      Array.isArray(res.addresses) ? res.addresses.join('; ') : (res.addresses || ''),
      Array.isArray(res.links) ? res.links.map((l) => (l && l.url) ? l.url : l).join('; ') : '',
      res.text || '',
    ]];
    return renderTableView(['name', 'emails', 'phones', 'addresses', 'links', 'text'], rows);
  }

  const textContent = (renderedItem && renderedItem.rendered && renderedItem.rendered.text)
    || res.markdown || res.text || JSON.stringify(res, null, 2);
  const pre = h('pre', { class: 'render' });
  pre.textContent = textContent;
  return pre;
}

function renderPageScanResults(root, actions) {
  const results = state.pageScanResults || [];
  if (!results.length) return;

  const container = h('div', { class: 'card scan-results-card' });
  container.append(h('div', { class: 'card-title' }, `Scan Results (${results.length})`));

  const list = h('div', { class: 'result-list' });

  for (const it of results) {
    const isExpanded = (state.pageScanExpanded || []).includes(it.pattern);
    const renderedItem = (state.pageScanItems || []).find((x) => x.pattern === it.pattern);

    const head = h('button', {
      class: 'out-card-head',
      type: 'button',
      'aria-expanded': String(isExpanded),
      onclick: () => actions.togglePageScanResult && actions.togglePageScanResult(it.pattern),
    },
      h('span', { class: 'out-card-title' },
        h('b', {}, it.label || (it.pattern.charAt(0).toUpperCase() + it.pattern.slice(1))),
        h('span', { class: 'muted tiny' }, ` ${it.ok ? (it.summary || '') : 'not applicable'}`),
      ),
      h('span', { class: 'out-chev', 'aria-hidden': 'true' }, isExpanded ? '▾' : '▸')
    );

    const body = h('div', { class: 'out-card-body', hidden: !isExpanded });

    if (!it.ok || !it.result) {
      body.append(h('p', { class: 'warn tiny' }, it.reason || 'Not applicable for this region.'));
    } else {
      body.append(renderScanResultDetail(it, renderedItem));
      body.append(h('div', { class: 'row' },
        h('button', { class: 'sec', type: 'button', onclick: () => actions.copyPageScanResult && actions.copyPageScanResult(it.pattern) }, 'Copy'),
        h('button', { class: 'sec', type: 'button', onclick: () => actions.downloadPageScanResult && actions.downloadPageScanResult(it.pattern) }, 'Download'),
      ));
    }

    list.append(h('div', { class: 'out-card' + (isExpanded ? ' open' : '') }, head, body));
  }

  container.append(list);
  root.append(container);
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

  // Unified Scan Component
  const isConfigOpen = !!state.scanConfigOpen;
  const isScanning = !!state.pageScanBusy;

  const scanCard = h('div', { class: 'card scan-card' },
    h('div', { class: 'scan-split-btn' },
      h('button', {
        class: 'scan-main-btn pri',
        disabled: isScanning || state.busy || !(state.scanPatterns && state.scanPatterns.length),
        onclick: actions.scanAllPage,
      }, isScanning ? 'Scanning…' : 'Scan'),
      h('button', {
        class: 'scan-cfg-toggle' + (isConfigOpen ? ' open' : ''),
        title: isConfigOpen ? 'Hide scan options' : 'Scan options',
        'aria-expanded': String(isConfigOpen),
        onclick: actions.toggleScanConfig,
      }, '▾')
    ),
    isConfigOpen ? h('div', { class: 'scan-config' },
      h('div', { class: 'scan-scope-box' },
        h('div', { class: 'muted tiny' }, state.scanScope ? `Scanning within: ${state.scanScopeLabel || 'selected node'}` : 'Scanning: Whole page'),
        h('div', { class: 'row' },
          h('button', { class: 'sec tiny-btn', onclick: actions.selectParentNode }, state.scanScope ? 'Change parent node' : 'Select parent node'),
          state.scanScope ? h('button', { class: 'link tiny', onclick: actions.clearScanScope }, 'Clear scope') : null,
        )
      ),
      h('div', { class: 'card-title tiny-title' }, 'Patterns'),
      h('div', { class: 'pattern-picks' }, SCAN_PATTERNS.map((p) => {
        const checked = (state.scanPatterns || []).includes(p.id);
        return h('label', { class: 'pick' },
          h('input', { type: 'checkbox', checked, onchange: (e) => actions.toggleScanPattern && actions.toggleScanPattern(p.id, e.target.checked) }),
          h('span', {}, p.label)
        );
      })),
      h('div', { class: 'row center-row' },
        h('button', {
          class: 'pri wide-btn',
          disabled: isScanning || state.busy || !(state.scanPatterns && state.scanPatterns.length),
          onclick: actions.scanAllPage,
        }, isScanning ? 'Scanning…' : 'Scan')
      )
    ) : null
  );

  root.append(scanCard);

  renderPageScanResults(root, actions);

  if (state.inspect && state.inspect.active && !state.selectingScanParent) {
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
  }

  root.append(h('div', { class: 'footnote' },
    h('button', { class: 'link', onclick: actions.retry }, 'Reload page info'),
    h('button', { class: 'link', onclick: actions.clearHistory }, 'Clear all site history'),
  ));
}
