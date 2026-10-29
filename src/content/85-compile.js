/* Lasso engine — Recipe compiler converting candidates to serializable extractions.
 * Classic-script layer 85.
 * Converts detect() candidates into serializable Extraction specifications that can be
 * saved in recipes and replayed on live DOM without snapshot node IDs. */
(() => {
  const L = globalThis.Lasso;

  function resolveElement(candidate, scopeEl) {
    if (scopeEl && scopeEl.nodeType === 1) return scopeEl;
    if (candidate && candidate.el && candidate.el.nodeType === 1) return candidate.el;

    // Look up via inspect snapshot if nodeId is present
    if (candidate && candidate.nodeId !== undefined && L.inspect) {
      const snap = L.inspect.snapshot();
      if (snap && snap.nodes && snap.nodes[candidate.nodeId]) {
        return snap.nodes[candidate.nodeId].el || null;
      }
    }
    return null;
  }

  function compileRecords(candidate, targetEl) {
    let sampleEls = [];

    if (candidate && candidate.itemIds && candidate.itemIds.length && L.inspect) {
      const snap = L.inspect.snapshot();
      if (snap && snap.nodes) {
        sampleEls = candidate.itemIds.map((id) => snap.nodes[id] && snap.nodes[id].el).filter(Boolean);
      }
    }

    if (!sampleEls.length && targetEl) {
      sampleEls = Array.from(targetEl.children).filter((c) => c.nodeType === 1);
    }

    const induced = L.induce ? L.induce.fromSamples(sampleEls) : {};
    const scopeLocator = L.makeLocator(targetEl);

    return {
      version: 1,
      pattern: 'records',
      shape: 'record_list',
      scope: scopeLocator,
      itemCss: induced.itemCss || '*',
      item: induced.item || null,
      fields: induced.fields || {},
    };
  }

  function compileArticle(candidate, targetEl) {
    return {
      version: 1,
      pattern: 'article',
      shape: 'article',
      scope: L.makeLocator(targetEl),
      title: (candidate && candidate.title) || '',
    };
  }

  function compileTable(candidate, targetEl) {
    return {
      version: 1,
      pattern: 'table',
      shape: 'table',
      scope: L.makeLocator(targetEl),
    };
  }

  function compileChat(candidate, targetEl) {
    const itemEl = targetEl ? targetEl.querySelector('[data-message-author-role], .message, .msg, div') : null;
    return {
      version: 1,
      pattern: 'chat',
      shape: 'chat',
      scope: L.makeLocator(targetEl),
      itemCss: '[data-message-author-role], .message, .msg',
      item: itemEl ? L.makeLocator(itemEl, targetEl) : null,
    };
  }

  function compileContact(candidate, targetEl) {
    return {
      version: 1,
      pattern: 'contact',
      shape: 'contact',
      scope: L.makeLocator(targetEl),
    };
  }

  function compileText(candidate, targetEl) {
    return {
      version: 1,
      pattern: 'text',
      shape: 'text',
      scope: L.makeLocator(targetEl),
    };
  }

  function compileCandidate(pattern, candidate, scopeEl) {
    const targetEl = resolveElement(candidate, scopeEl) || document.body;
    const pat = String(pattern || (candidate && candidate.pattern) || (candidate && candidate.kind) || 'text').toLowerCase();

    switch (pat) {
      case 'records':
      case 'record_list':
      case 'list':
        return compileRecords(candidate, targetEl);
      case 'article':
        return compileArticle(candidate, targetEl);
      case 'table':
        return compileTable(candidate, targetEl);
      case 'chat':
        return compileChat(candidate, targetEl);
      case 'contact':
        return compileContact(candidate, targetEl);
      case 'text':
      default:
        return compileText(candidate, targetEl);
    }
  }

  L.compileCandidate = compileCandidate;
  L.compile = {
    compileCandidate,
  };
})();
