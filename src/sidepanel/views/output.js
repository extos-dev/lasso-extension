import { h } from '../dom.js';
import { state } from '../state.js';

const EXPORT_FORMATS = [
  { id: 'markdown', label: 'Markdown' },
  { id: 'json', label: 'JSON' },
  { id: 'csv', label: 'CSV' },
];

function makeExportDropdown(actions, isMulti) {
  const wrap = h('div', { class: 'export-wrap' });
  const btn = h('button', { class: 'export-btn', type: 'button' }, 'Export ▾');
  const menu = h('div', { class: 'export-menu', hidden: true });
  const bomRow = h('label', { class: 'export-bom' },
    h('input', { type: 'checkbox', checked: state.bom, onchange: (e) => actions.bom(e.target.checked) }),
    ' Excel BOM (CSV)',
  );
  menu.append(bomRow);
  for (const f of EXPORT_FORMATS) {
    menu.append(h('button', {
      type: 'button',
      class: 'export-item',
      onclick: () => {
        menu.hidden = true;
        if (isMulti && typeof actions.exportAll === 'function') actions.exportAll(f.id);
        else if (typeof actions.export === 'function') actions.export(f.id);
        else if (typeof actions.format === 'function') actions.format(f.id);
      },
    }, f.label));
  }
  btn.onclick = (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  };
  const hide = () => { menu.hidden = true; document.removeEventListener('click', hide); };
  setTimeout(() => document.addEventListener('click', hide), 0);
  wrap.append(btn, menu);
  return wrap;
}

function renderTableView(headers, rows) {
  const table = h('table', { class: 'data-table' });
  const thead = h('thead');
  const trh = h('tr');
  const headCols = (headers && headers.length) ? headers : ((rows && rows[0]) ? rows[0].map((_, i) => `Column ${i + 1}`) : []);
  for (const hcol of headCols) {
    trh.append(h('th', {}, h('input', { class: 'table-cell', value: hcol == null ? '' : String(hcol), spellcheck: 'false' })));
  }
  thead.append(trh);
  table.append(thead);
  const tbody = h('tbody');
  const len = headCols.length || ((rows && rows[0]) ? rows[0].length : 0);
  for (const row of (rows || [])) {
    const tr = h('tr');
    for (let i = 0; i < len; i++) {
      const val = row && row[i] != null ? row[i] : '';
      tr.append(h('td', {}, h('input', { class: 'table-cell', value: String(val), spellcheck: 'false' })));
    }
    tbody.append(tr);
  }
  table.append(tbody);
  const wrap = h('div', { class: 'table-wrap' });
  wrap.append(table);
  return wrap;
}

function getColsForItems(items) {
  if (!Array.isArray(items) || !items.length) return [];
  if (typeof items[0] !== 'object' || items[0] === null) return ['value'];
  const pref = ['title', 'url', 'price', 'date', 'image', 'snippet', 'text'];
  const seen = new Set(items.flatMap((i) => Object.keys(i || {})));
  const cols = [...pref.filter((c) => seen.has(c)), ...[...seen].filter((c) => !pref.includes(c))];
  return cols;
}

function renderDefaultView(result, rendered) {
  if (!result) return h('pre', { class: 'out-pre' }, rendered && rendered.text ? rendered.text : '');
  if (result.kind === 'table') {
    const data = rendered && rendered.data;
    if (data && Array.isArray(data.rows)) {
      return renderTableView(data.headers, data.rows);
    }
  }
  if (result.kind === 'record_list') {
    const data = rendered && rendered.data;
    if (data && Array.isArray(data.items)) {
      const items = data.items;
      if (items.length && typeof items[0] === 'object' && items[0] !== null) {
        const cols = getColsForItems(items);
        const rows = items.map((i) => cols.map((c) => i[c] ?? ''));
        return renderTableView(cols, rows);
      }
    }
  }
  if (result.kind === 'chat') {
    const data = rendered && rendered.data;
    if (data && Array.isArray(data.messages)) {
      const rows = data.messages.map((m) => [m.role || '', m.text || '']);
      return renderTableView(['role', 'text'], rows);
    }
  }
  if (result.kind === 'contact') {
    const data = rendered && rendered.data;
    if (data) {
      const rows = [[
        data.name || '',
        Array.isArray(data.emails) ? data.emails.join('; ') : (data.emails || ''),
        Array.isArray(data.phones) ? data.phones.join('; ') : (data.phones || ''),
        Array.isArray(data.addresses) ? data.addresses.join('; ') : (data.addresses || ''),
        Array.isArray(data.links) ? data.links.map((l) => (l && l.url) ? l.url : l).join('; ') : '',
        data.text || '',
      ]];
      return renderTableView(['name', 'emails', 'phones', 'addresses', 'links', 'text'], rows);
    }
  }
  const pre = h('pre', { class: 'out-pre' });
  pre.textContent = rendered && rendered.text ? rendered.text : '';
  return pre;
}

export function renderOutput(root, actions) {
  root.replaceChildren();
  if (!state.inspect || !state.inspect.active) {
    root.append(h('div', { class: 'empty' }, h('p', { class: 'muted' }, 'Turn on Inspect, choose an element, and apply a pattern to see output here.')));
    return;
  }
  if (state.results.length > 1) {
    renderMulti(root, actions);
    return;
  }

  if (!state.result) {
    root.append(h('div', { class: 'empty' },
      h('p', { class: 'muted' }, 'No pattern applied yet.'),
      h('button', { onclick: actions.openMap }, 'Back to Map'),
    ));
    return;
  }

  const r = state.result;
  const meta = r.kind === 'record_list' ? `${r.count} items · ${r.flavor}`
    : r.kind === 'table' ? `${r.rows} rows × ${r.cols}`
      : r.kind === 'chat' ? `${r.count} messages`
        : r.kind === 'contact' ? `${(r.emails||[]).length} email${(r.emails||[]).length === 1 ? '' : 's'} · ${(r.phones||[]).length} phone${(r.phones||[]).length === 1 ? '' : 's'}`
          : r.kind === 'article' ? `${r.wordCount} words`
            : `${r.chars || 0} chars`;

  root.append(h('div', { class: 'out-head' },
    h('div', {}, h('h2', {}, r.pattern ? (r.pattern.charAt(0).toUpperCase() + r.pattern.slice(1)) : 'Output'), h('div', { class: 'muted tiny' }, `${r.label || ''}${r.label && meta ? ' · ' : ''}${meta}`)),
    h('div', { class: 'row' }, makeExportDropdown(actions, false)),
  ));

  if (!state.rendered) {
    root.append(h('div', { class: 'empty' }, h('p', { class: 'muted' }, 'Rendering…')));
    return;
  }

  root.append(renderDefaultView(r, state.rendered));
  const ta = h('textarea', { class: 'out', readonly: true, spellcheck: 'false', 'aria-label': 'Output', style: 'display:none' });
  ta.value = state.rendered.text || (state.rendered.data ? JSON.stringify(state.rendered.data) : '');
  root.append(ta);
  root.append(h('div', { class: 'out-meta' },
    h('span', {}, `${(state.rendered.chars || 0).toLocaleString()} chars · ~${(state.rendered.tokenEstimate || 0).toLocaleString()} tokens`),
    h('span', { class: 'muted tiny' }, state.rendered.tokenEstimateNote || ''),
  ));
  root.append(h('div', { class: 'row' },
    h('button', { class: 'sec', type: 'button', onclick: () => actions.copy && actions.copy() }, 'Copy'),
    h('button', { class: 'sec', type: 'button', onclick: () => actions.download && actions.download() }, 'Download'),
    h('button', { class: 'sec', type: 'button', onclick: () => actions.saveSchema && actions.saveSchema() }, 'Save schema'),
  ));
}

function renderMulti(root, actions) {
  root.append(h('div', { class: 'out-head' },
    h('div', {}, h('h2', {}, 'Output'), h('div', { class: 'muted tiny' }, `${state.results.length} selected patterns · expand a card to read or copy`)),
    makeExportDropdown(actions, true),
  ));

  if (!state.outputItems.length) {
    root.append(h('div', { class: 'empty' }, h('p', { class: 'muted' }, 'Rendering…')));
    return;
  }

  const list = h('div', { class: 'result-list' });
  for (const item of state.outputItems) {
    const open = state.expandedResults.includes(item.pattern);
    const head = h('button', {
      class: 'out-card-head', type: 'button', 'aria-expanded': String(open),
      onclick: () => actions.toggleResult(item.pattern),
    },
      h('span', { class: 'out-card-title' }, h('b', {}, item.label), h('span', { class: 'muted tiny' }, ` ${item.ok ? item.summary : 'not applicable'}`)),
      h('span', { class: 'out-chev', 'aria-hidden': 'true' }, open ? '▾' : '▸'),
    );
    const body = h('div', { class: 'out-card-body', hidden: !open });
    if (!item.ok || !item.rendered) {
      body.append(h('p', { class: 'warn tiny' }, item.reason || 'No result for this pattern.'));
    } else {
      body.append(renderDefaultView(item.kind ? { kind: item.kind } : null, item.rendered));
      const ta = h('textarea', { class: 'out', readonly: true, spellcheck: 'false', 'aria-label': `${item.label} output`, style: 'display:none' });
      ta.value = item.rendered.text || '';
      body.append(ta);
      body.append(h('div', { class: 'out-meta' },
        h('span', {}, `${item.rendered.chars.toLocaleString()} chars · ~${item.rendered.tokenEstimate.toLocaleString()} tokens`),
        h('span', { class: 'muted tiny' }, item.rendered.tokenEstimateNote || ''),
      ));
      body.append(h('div', { class: 'row' },
        h('button', { class: 'sec', type: 'button', onclick: () => actions.copyResult && actions.copyResult(item.pattern) }, 'Copy'),
        h('button', { class: 'sec', type: 'button', onclick: () => actions.downloadResult && actions.downloadResult(item.pattern) }, 'Download'),
      ));
    }
    list.append(h('div', { class: 'out-card' + (open ? ' open' : '') }, head, body));
  }
  root.append(list);
}
