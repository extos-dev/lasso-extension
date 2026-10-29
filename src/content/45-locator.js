/* 45-locator.js — Locator Set Builder & Resolver (Milestone B Foundation)
 * Builds ordered locator sets (semantic -> stable attribute -> stable CSS -> structural path -> text signature)
 * and resolves target elements in the snapshot with fallbacks, signature verification, and health diagnostics.
 * Classic-script layer 3: depends on 00-namespace and snapshot utils.
 */
(() => {
  const L = globalThis.Lasso, u = L.util;

  /** Safe CSS.escape wrapper for JS environments / jsdom. */
  function cssEscape(s) {
    if (typeof globalThis.CSS !== 'undefined' && typeof globalThis.CSS.escape === 'function') {
      return globalThis.CSS.escape(s);
    }
    return String(s).replace(/([!#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
  }

  /** Normalize string for whitespace/case-tolerant signature comparisons. */
  function normalizeText(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /** Create a text fingerprint signature for verification. */
  function textSignature(snap, nodeId) {
    const text = L.textOf(snap, nodeId);
    const normalized = normalizeText(text);
    const words = normalized.split(' ').slice(0, 10).join(' ');
    return {
      hash: u.hash32 ? u.hash32(words) : words.slice(0, 32),
      length: text.length,
      prefix: words.slice(0, 50),
    };
  }

  /** Verify whether a candidate node matches the expected signature. */
  function verifySignature(candidateNode, snap, expectedSignature) {
    if (!candidateNode || !expectedSignature) return false;
    if (expectedSignature.tag && candidateNode.tag !== expectedSignature.tag) return false;

    if (expectedSignature.sig) {
      const candSig = textSignature(snap, candidateNode.id);
      // Check prefix or hash match
      if (expectedSignature.sig.prefix && candSig.prefix) {
        const expPref = expectedSignature.sig.prefix;
        const candPref = candSig.prefix;
        if (expPref === candPref || expPref.startsWith(candPref.slice(0, 20)) || candPref.startsWith(expPref.slice(0, 20))) {
          return true;
        }
      }
      if (expectedSignature.sig.hash && candSig.hash && expectedSignature.sig.hash === candSig.hash) {
        return true;
      }
      // Length tolerance check if prefix/hash empty
      if (expectedSignature.sig.length === 0 && candSig.length === 0) return true;
      return false;
    }

    return true;
  }

  /** Build an ordered set of locator strategies for a given node in the snapshot. */
  function buildLocatorSet(snap, nodeId) {
    const node = snap.nodes[nodeId];
    if (!node) throw new Error('Node not found in snapshot: ' + nodeId);
    const el = node.el;
    const strategies = [];

    // 1. Semantic / ARIA strategy
    if (node.role && node.role !== 'presentation' && node.role !== 'none') {
      strategies.push({ type: 'aria', value: `[role="${cssEscape(node.role)}"]` });
    }
    if (['ARTICLE', 'MAIN', 'NAV', 'HEADER', 'FOOTER', 'SECTION', 'TABLE'].includes(node.tag)) {
      strategies.push({ type: 'semantic', value: node.tag.toLowerCase() });
    }

    // 2. Stable Attribute strategy
    if (el && el.id && !/^\d+$/.test(el.id) && !u.isHashy(el.id)) {
      strategies.push({ type: 'id', value: '#' + cssEscape(el.id) });
    }
    if (el && el.attributes) {
      for (const attr of el.attributes) {
        if (attr.name.startsWith('data-') || attr.name === 'itemprop' || attr.name === 'name') {
          if (attr.value && !u.isHashy(attr.value)) {
            strategies.push({ type: 'attribute', value: `[${cssEscape(attr.name)}="${cssEscape(attr.value)}"]` });
          }
        }
      }
    }

    // 3. Stable CSS Strategy (using stable class tokens)
    const stableCls = u.stableTokens(node.cls || '');
    if (stableCls.length > 0) {
      const escapedClasses = stableCls.slice(0, 2).map(cssEscape).join('.');
      strategies.push({ type: 'css_class', value: node.tag.toLowerCase() + '.' + escapedClasses });
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

    const signature = {
      tag: node.tag,
      sig: textSignature(snap, nodeId),
    };

    return { strategies, signature };
  }

  /**
   * Resolves a locator set against a page snapshot.
   * Checks every candidate against locatorSet.signature to prevent matching wrong region.
   * Returns { nodeId, strategyIndex, strategy, matched, health, reason }
   */
  function resolveLocatorSet(snap, locatorSet) {
    if (!locatorSet || !Array.isArray(locatorSet.strategies) || !locatorSet.strategies.length) {
      return { nodeId: null, strategyIndex: -1, matched: false, health: 'broken', reason: 'invalid locator set' };
    }

    const expectedSig = locatorSet.signature;

    for (let i = 0; i < locatorSet.strategies.length; i++) {
      const strat = locatorSet.strategies[i];
      let candidates = [];

      if (strat.type === 'id') {
        const idVal = strat.value.replace(/^#/, '').replace(/\\/g, '');
        candidates = snap.nodes.filter((n) => n.el && n.el.id === idVal);
      } else if (strat.type === 'attribute') {
        const m = strat.value.match(/^\[([a-z0-9_-]+)="([^"]+)"\]$/i);
        if (m) {
          const [, attrName, rawAttrVal] = m;
          const attrVal = rawAttrVal.replace(/\\/g, '');
          candidates = snap.nodes.filter((n) => n.el && n.el.getAttribute && n.el.getAttribute(attrName) === attrVal);
        }
      } else if (strat.type === 'semantic' || strat.type === 'aria') {
        const tagOrRole = strat.value.toUpperCase();
        if (strat.type === 'semantic') {
          candidates = snap.nodes.filter((n) => n.tag === tagOrRole);
        } else {
          const roleVal = strat.value.slice(7, -1).replace(/\\/g, '');
          candidates = snap.nodes.filter((n) => n.role === roleVal);
        }
      } else if (strat.type === 'css_class') {
        const [tag, ...classes] = strat.value.split('.');
        const tagUpper = tag.toUpperCase();
        const unescapedClasses = classes.map((c) => c.replace(/\\/g, ''));
        candidates = snap.nodes.filter((n) => n.tag === tagUpper && unescapedClasses.every((c) => u.stableTokens(n.cls || '').includes(c)));
      } else if (strat.type === 'structural') {
        try {
          candidates = snap.nodes.filter((n) => n.el && n.el.matches && n.el.matches(strat.value));
        } catch (_) {}
      }

      // Verify each candidate against signature
      for (const candidateNode of candidates) {
        if (!expectedSig || verifySignature(candidateNode, snap, expectedSig)) {
          const health = i === 0 ? 'healthy' : 'degraded';
          return {
            nodeId: candidateNode.id,
            strategyIndex: i,
            strategy: strat,
            matched: true,
            health,
            reason: i === 0 ? 'matched primary strategy and verified signature' : `matched fallback strategy #${i + 1} (${strat.type}) and verified signature`,
          };
        }
      }
    }

    return { nodeId: null, strategyIndex: -1, matched: false, health: 'broken', reason: 'no strategy matched signature' };
  }

  L.locator = {
    cssEscape,
    build: buildLocatorSet,
    resolve: resolveLocatorSet,
    textSignature,
    verifySignature,
  };
})();
