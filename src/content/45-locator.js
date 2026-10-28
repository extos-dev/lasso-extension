/* 45-locator.js — Locator Set Builder & Resolver (Milestone B Foundation)
 * Builds ordered locator sets (semantic -> stable attribute -> stable CSS -> structural path -> text signature)
 * and resolves target elements in the snapshot with fallbacks and health diagnostics.
 * Classic-script layer 3: depends on 00-namespace and snapshot utils.
 */
(() => {
  const L = globalThis.Lasso, u = L.util;

  /** Create a text fingerprint signature for verification. */
  function textSignature(snap, nodeId) {
    const text = L.textOf(snap, nodeId);
    const words = text.trim().split(/\s+/).slice(0, 10).join(' ');
    return {
      hash: u.hash32 ? u.hash32(words) : words.slice(0, 32),
      length: text.length,
      prefix: words.slice(0, 50),
    };
  }

  /** Build an ordered set of locator strategies for a given node in the snapshot. */
  function buildLocatorSet(snap, nodeId) {
    const node = snap.nodes[nodeId];
    if (!node) throw new Error('Node not found in snapshot: ' + nodeId);
    const el = node.el;
    const strategies = [];

    // 1. Semantic / ARIA strategy
    if (node.role && node.role !== 'presentation' && node.role !== 'none') {
      strategies.push({ type: 'aria', value: `[role="${node.role}"]` });
    }
    if (['ARTICLE', 'MAIN', 'NAV', 'HEADER', 'FOOTER', 'SECTION', 'TABLE'].includes(node.tag)) {
      strategies.push({ type: 'semantic', value: node.tag.toLowerCase() });
    }

    // 2. Stable Attribute strategy
    if (el && el.id && !/^\d+$/.test(el.id) && !u.isHashy(el.id)) {
      strategies.push({ type: 'id', value: '#' + el.id });
    }
    if (el && el.attributes) {
      for (const attr of el.attributes) {
        if (attr.name.startsWith('data-') || attr.name === 'itemprop' || attr.name === 'name') {
          if (attr.value && !u.isHashy(attr.value)) {
            strategies.push({ type: 'attribute', value: `[${attr.name}="${attr.value}"]` });
          }
        }
      }
    }

    // 3. Stable CSS Strategy (using stable class tokens)
    const stableCls = u.stableTokens(node.cls || '');
    if (stableCls.length > 0) {
      strategies.push({ type: 'css_class', value: node.tag.toLowerCase() + '.' + stableCls.slice(0, 2).join('.') });
    }

    // 4. Structural Path Strategy (index-based path from root/body)
    const path = [];
    let curr = node;
    while (curr) {
      if (curr.parentId === null) {
        path.unshift(curr.tag.toLowerCase());
        break;
      }
      const parent = snap.nodes[curr.parentId];
      const sibIdx = parent.children.indexOf(curr.id);
      path.unshift(`${curr.tag.toLowerCase()}:nth-child(${sibIdx + 1})`);
      curr = parent;
    }
    strategies.push({ type: 'structural', value: path.join(' > ') });

    // Signature used for verifying health / drift during resolution
    const signature = {
      tag: node.tag,
      sig: textSignature(snap, nodeId),
    };

    return { strategies, signature };
  }

  /**
   * Resolves a locator set against a page snapshot.
   * Returns { nodeId, strategyIndex, strategy, matched, health }
   */
  function resolveLocatorSet(snap, locatorSet) {
    if (!locatorSet || !Array.isArray(locatorSet.strategies) || !locatorSet.strategies.length) {
      return { nodeId: null, strategyIndex: -1, matched: false, health: 'broken', reason: 'invalid locator set' };
    }

    for (let i = 0; i < locatorSet.strategies.length; i++) {
      const strat = locatorSet.strategies[i];
      let candidateId = null;

      if (strat.type === 'id') {
        const idVal = strat.value.slice(1);
        const matched = snap.nodes.find((n) => n.el && n.el.id === idVal);
        if (matched) candidateId = matched.id;
      } else if (strat.type === 'attribute') {
        const m = strat.value.match(/^\[([a-z0-9_-]+)="([^"]+)"\]$/i);
        if (m) {
          const [, attrName, attrVal] = m;
          const matched = snap.nodes.find((n) => n.el && n.el.getAttribute && n.el.getAttribute(attrName) === attrVal);
          if (matched) candidateId = matched.id;
        }
      } else if (strat.type === 'semantic' || strat.type === 'aria') {
        const tagOrRole = strat.value.toUpperCase();
        const matched = snap.nodes.find((n) => (strat.type === 'semantic' ? n.tag === tagOrRole : n.role === strat.value.slice(7, -1)));
        if (matched) candidateId = matched.id;
      } else if (strat.type === 'css_class') {
        const [tag, ...classes] = strat.value.split('.');
        const tagUpper = tag.toUpperCase();
        const matched = snap.nodes.find((n) => n.tag === tagUpper && classes.every((c) => u.stableTokens(n.cls || '').includes(c)));
        if (matched) candidateId = matched.id;
      } else if (strat.type === 'structural') {
        try {
          const matchedNode = snap.nodes.find((n) => n.el && n.el.matches && n.el.matches(strat.value));
          if (matchedNode) candidateId = matchedNode.id;
        } catch (_) {}
      }

      if (candidateId !== null) {
        const candidateNode = snap.nodes[candidateId];
        const health = i === 0 ? 'healthy' : 'degraded';
        return {
          nodeId: candidateId,
          strategyIndex: i,
          strategy: strat,
          matched: true,
          health,
          reason: i === 0 ? 'matched primary strategy' : `matched fallback strategy #${i + 1} (${strat.type})`,
        };
      }
    }

    return { nodeId: null, strategyIndex: -1, matched: false, health: 'broken', reason: 'no strategy matched' };
  }

  L.locator = {
    build: buildLocatorSet,
    resolve: resolveLocatorSet,
    textSignature,
  };
})();
