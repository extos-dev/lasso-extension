import { h } from '../dom.js';
import { state } from '../state.js';

export function renderMap(root, actions) {
  root.replaceChildren();
  if (!state.inspect || !state.inspect.active) {
    root.append(h('div', { class: 'empty' },
      h('p', { class: 'muted' }, 'Map shows the page structure while inspect mode is on.'),
      h('button', { class: 'pri', disabled: !state.tab || state.busy, onclick: actions.toggleInspect }, 'Inspect this page'),
    ));
    return;
  }
  if (!state.tree) {
    root.append(h('div', { class: 'empty' }, h('p', { class: 'muted' }, 'Preparing the map…')));
    return;
  }

  const st = state.inspect.stats || {};
  root.append(h('div', { class: 'map-head' },
    h('div', {}, h('h2', {}, 'Map'), h('div', { class: 'muted tiny' }, 'Inspect mode is on · this tab only')),
    h('button', { class: 'link', onclick: actions.exitInspect }, 'Exit'),
  ));
  root.append(h('div', { class: 'statline' },
    h('span', {}, h('b', {}, (st.nodes || 0).toLocaleString()), ' nodes'),
    h('span', {}, h('b', {}, `${Math.round(st.snapshotMs || 0)} ms`), ' snapshot'),
    h('span', {}, h('b', {}, st.selections || 0), ' selections'),
    h('span', {}, h('b', {}, st.patternsApplied || 0), ' applied'),
  ));
  if (st.truncated) root.append(h('p', { class: 'warn tiny' }, 'The DOM is very large; only the first 25,000 nodes are mapped.'));

  if (state.breadcrumb.length) {
    const crumbs = [];
    state.breadcrumb.forEach((b, i) => {
      if (i) crumbs.push(h('span', { class: 'sep' }, '›'));
      crumbs.push(h('button', {
        class: 'crumb' + (i === state.breadcrumb.length - 1 ? ' cur' : ''),
        title: b.tag,
        onclick: () => actions.selectNode(b.id, true),
      }, b.label));
    });
    root.append(h('div', { class: 'breadcrumb', 'aria-label': 'Selection path' }, ...crumbs));
  }

  if (state.selected) {
    const sel = state.selected;
      root.append(h('div', { class: 'card sel-card' },
        h('div', { class: 'sel-title' }, h('b', {}, sel.label), h('span', { class: 'muted tiny' }, ` ${sel.tag} · ${sel.textLength.toLocaleString()} chars · ${sel.linkCount} links`)),
        sel.text ? h('div', { class: 'preview' }, sel.text) : h('div', { class: 'muted tiny' }, 'No direct text in this element.'),
        h('div', { class: 'row' }, h('button', { class: 'small', onclick: () => actions.setScanScopeFromSelection && actions.setScanScopeFromSelection() }, 'Set as scan parent')),
      ));
    if (!state.patternsReady) {
      root.append(h('h3', {}, 'Choose patterns'));
      const picks = h('div', { class: 'pattern-picks' });
      for (const def of state.catalog) {
        const checked = state.patternPick.includes(def.id);
        const cb = h('input', {
          type: 'checkbox', value: def.id, checked,
          onchange: (e) => actions.togglePatternPick(def.id, e.target.checked),
        });
        picks.append(h('label', { class: 'pick' }, cb, h('span', {}, h('b', {}, def.label), h('span', { class: 'muted tiny' }, ' Detected only in this selection.'))));
      }
      root.append(picks);
      root.append(h('button', {
        class: 'pri detect-patterns', disabled: state.busy || !state.patternPick.length,
        onclick: actions.detectPatterns,
      }, 'Detect selected'));
      root.append(h('p', { class: 'muted tiny' }, 'Text is selected by default. Choosing another pattern unchecks Text; check Text again to include both. Nothing runs until Detect.'));
    } else if (state.results.length === 1) {
      const item = state.results[0];
      root.append(h('h3', {}, 'Result'));
      root.append(h('div', { class: 'card result-card' },
        h('div', { class: 'sel-title' }, h('b', {}, item.label), h('span', { class: 'muted tiny' }, ` ${item.ok ? item.summary : 'not applicable'}`)),
        !item.ok ? h('p', { class: 'warn tiny' }, item.reason) : null,
      ));
      if (item.ok) root.append(h('button', { class: 'pri', onclick: actions.sendToOutput }, 'Send to Output'));
      root.append(h('button', { class: 'link', onclick: actions.changePatterns }, 'Choose patterns again'));
    } else {
      root.append(h('h3', {}, 'Results'));
      root.append(h('div', { class: 'result-list' }, ...state.results.map((item) => h('div', { class: 'card result-card' },
        h('div', { class: 'sel-title' }, h('b', {}, item.label), h('span', { class: 'muted tiny' }, ` ${item.ok ? item.summary : 'not applicable'}`)),
        !item.ok ? h('p', { class: 'warn tiny' }, item.reason) : null,
      ))));
      root.append(h('button', { class: 'pri', onclick: () => actions.setView('output') }, 'Open Output'));
      root.append(h('button', { class: 'link', onclick: actions.changePatterns }, 'Choose patterns again'));
    }
  } else {
    root.append(h('div', { class: 'empty' }, h('p', { class: 'muted' }, 'Click an element on the page or in the tree.')));
  }

  root.append(h('div', { class: 'tree-head' }, h('h3', {}, 'DOM tree'), h('span', { class: 'muted tiny' }, 'Click to select · twisty to expand')));
  const tree = h('div', { class: 'tree', role: 'tree', 'aria-label': 'Page elements' });
  if (state.tree.root) tree.append(renderNode(state.tree.root.id, 1, actions, treeFocusId()));
  else tree.append(h('p', { class: 'muted' }, 'No visible elements.'));
  root.append(tree);
  root.append(h('p', { class: 'muted tiny' }, 'Children load on demand; up to 400 per node.'));
}

/** Roving focus: exactly one row is in the tab order — the selection, or the root. */
function treeFocusId() {
  const root = state.tree && state.tree.root;
  if (!root) return null;
  const id = state.selectedId;
  if (id === null || id === undefined || !isRowVisible(id)) return root.id;
  return id;
}

function isRowVisible(id) {
  let n = state.tree.nodes.get(id);
  while (n) {
    if (n.parentId === null || n.parentId === undefined) return true;
    const p = state.tree.nodes.get(n.parentId);
    if (!p || !state.tree.expanded.has(p.id)) return false;
    n = p;
  }
  return false;
}

function focusNode(id) {
  const row = document.querySelector(`#view-map .node-row[data-node-id="${id}"]`);
  if (row) row.focus({ preventScroll: true });
}

async function onNodeKey(e, id, actions) {
  const n = state.tree && state.tree.nodes.get(id);
  if (!n) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault(); await actions.selectNode(id, true); focusNode(id); return;
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    if (n.childCount && !state.tree.expanded.has(id)) await actions.expand(id);
    if (n.childIds && n.childIds.length) focusNode(n.childIds[0]);
    return;
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    if (state.tree.expanded.has(id)) { await actions.expand(id); return; }
    if (n.parentId !== null && n.parentId !== undefined) focusNode(n.parentId);
    return;
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const rows = [...document.querySelectorAll('#view-map .node-row')];
    const i = rows.indexOf(document.activeElement);
    const next = rows[(i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length];
    if (next) next.focus({ preventScroll: true });
    return;
  }
  if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
    e.preventDefault();
    await actions.selectNode(id, true);
    const first = document.querySelector('#view-map .pattern:not(:disabled), #view-map .detect-patterns:not(:disabled)');
    if (first) first.focus({ preventScroll: true });
  }
}

function renderNode(id, level, actions, focusId) {
  const n = state.tree.nodes.get(id);
  if (!n) return h('div', { class: 'muted tiny' }, '(element no longer available)');
  const expanded = state.tree.expanded.has(id);
  const hasKids = n.childCount > 0;
  const twist = hasKids
    ? h('button', {
        class: 'twisty', 'aria-label': expanded ? 'Collapse' : 'Expand', 'aria-expanded': String(expanded),
        onclick: (e) => { e.stopPropagation(); actions.expand(id); },
      }, expanded ? '▾' : '▸')
    : h('span', { class: 'twisty-spacer' });
  const row = h('div', {
    class: 'node-row' + (state.selectedId === id ? ' sel' : '') + (state.hoverId === id ? ' hover' : ''),
    role: 'treeitem', 'aria-level': level, 'aria-selected': String(state.selectedId === id), tabindex: id === focusId ? '0' : '-1',
    'data-node-id': String(id),
    style: `padding-left:${(level - 1) * 12 + 2}px`,
    onclick: () => actions.selectNode(id, true),
    onkeydown: (e) => onNodeKey(e, id, actions),
  },
    twist,
    h('span', { class: 'node-label', title: n.label }, n.label),
    n.preview ? h('span', { class: 'node-preview', title: n.preview }, n.preview) : null,
    hasKids ? h('span', { class: 'node-count' }, String(n.childCount)) : null,
  );
  const kids = h('div', { role: 'group' });
  if (expanded) {
    if (n.childIds === undefined) kids.append(h('div', { class: 'muted tiny loading', style: `padding-left:${(level - 1) * 12 + 24}px` }, 'Loading…'));
    else if (!n.childIds.length) kids.append(h('div', { class: 'muted tiny loading', style: `padding-left:${(level - 1) * 12 + 24}px` }, 'No visible children'));
    else for (const cid of n.childIds) kids.append(renderNode(cid, level + 1, actions, focusId));
    if (n.truncatedChildren) kids.append(h('div', { class: 'muted tiny loading', style: `padding-left:${(level - 1) * 12 + 24}px` }, `… ${n.truncatedChildren} more`));
  }
  return h('div', { class: 'node' }, row, kids);
}
