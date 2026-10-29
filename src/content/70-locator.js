/* Lasso engine — Locator generation and resolution on live DOM.
 * Classic-script layer 70.
 * Constructs serializable locator objects from live DOM elements and resolves
 * locators against live DOM using multi-strategy confidence scoring and shadow DOM traversal. */
(() => {
  const L = globalThis.Lasso, u = L.util;

  function isHashy(str) {
    if (u && typeof u.isHashy === 'function') return u.isHashy(str);
    return /^(css|sc|jsx|emotion|styled|svelte|astro|chakra|mui|makeStyles)-/i.test(str) ||
      /^_/.test(str) ||
      (/\d/.test(str) && /[a-z]/i.test(str) && str.length >= 8);
  }

  function stableTokens(cls) {
    if (u && typeof u.stableTokens === 'function') return u.stableTokens(cls);
    return String(cls || '').split(/\s+/).filter((t) => t && !isHashy(t)).sort();
  }

  function getTestId(el) {
    if (!el || !el.getAttribute) return null;
    return el.getAttribute('data-testid') ||
      el.getAttribute('data-test-id') ||
      el.getAttribute('data-qa') ||
      el.getAttribute('data-cy') ||
      null;
  }

  function getAria(el) {
    if (!el || !el.getAttribute) return null;
    return el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || null;
  }

  function getRole(el) {
    if (!el || !el.getAttribute) return null;
    return el.getAttribute('role') || null;
  }

  function cssEscape(str) {
    if (typeof globalThis.CSS !== 'undefined' && typeof globalThis.CSS.escape === 'function') {
      return globalThis.CSS.escape(str);
    }
    return String(str || '').replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
  }

  function makeCss(el, rootEl) {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    let cur = el;
    const boundary = rootEl && rootEl.nodeType === 1 ? rootEl : document.body || document.documentElement;

    while (cur && cur.nodeType === 1 && cur !== boundary && cur !== document.documentElement) {
      let part = cur.tagName.toLowerCase();
      if (cur.id && !isHashy(cur.id)) {
        part += '#' + cssEscape(cur.id);
        parts.unshift(part);
        break; // ID is anchored
      }

      const testid = getTestId(cur);
      if (testid) {
        part += `[data-testid="${cssEscape(testid)}"]`;
        parts.unshift(part);
        break;
      }

      const classes = stableTokens(cur.className).slice(0, 2);
      if (classes.length) {
        part += '.' + classes.map(cssEscape).join('.');
      }

      // Add nth-of-type if ambiguous among siblings with same tag
      if (cur.parentElement) {
        const siblings = Array.from(cur.parentElement.children).filter((c) => c.tagName === cur.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(cur) + 1;
          part += `:nth-of-type(${idx})`;
        }
      }

      parts.unshift(part);
      cur = cur.parentElement || (cur.parentNode && cur.parentNode.host ? cur.parentNode.host : null);
    }

    if (!parts.length) parts.push(el.tagName.toLowerCase());
    return parts.join(' > ');
  }

  function makePath(el, rootEl) {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    let cur = el;
    const boundary = rootEl && rootEl.nodeType === 1 ? rootEl : document.body || document.documentElement;

    while (cur && cur.nodeType === 1 && cur !== boundary && cur !== document.documentElement) {
      let part = cur.tagName;
      if (cur.parentElement) {
        const siblings = Array.from(cur.parentElement.children).filter((c) => c.tagName === cur.tagName);
        const idx = siblings.indexOf(cur) + 1;
        part += `:nth-of-type(${idx})`;
      } else {
        part += ':nth-of-type(1)';
      }
      parts.unshift(part);
      cur = cur.parentElement || (cur.parentNode && cur.parentNode.host ? cur.parentNode.host : null);
    }

    if (cur === document.body || (!rootEl && parts[0] !== 'BODY')) {
      if (parts[0] !== 'BODY') parts.unshift('BODY');
    }
    return parts.join(' > ');
  }

  function getDepth(el, rootEl) {
    let d = 0;
    let cur = el;
    const boundary = rootEl || document.documentElement;
    while (cur && cur !== boundary && cur !== document.documentElement) {
      d++;
      cur = cur.parentElement || (cur.parentNode && cur.parentNode.host ? cur.parentNode.host : null);
    }
    return d;
  }

  function makeFingerprint(el, rootEl) {
    if (!el || el.nodeType !== 1) return null;
    const attrs = {};
    for (const attr of ['href', 'src', 'type', 'name', 'value', 'alt', 'title']) {
      if (el.hasAttribute(attr)) attrs[attr] = el.getAttribute(attr);
    }
    const textSnippet = u.collapse(el.textContent || '').trim().slice(0, 60);

    return {
      tag: el.tagName,
      classes: stableTokens(el.className),
      attributes: attrs,
      textSnippet,
      childCount: el.children.length,
      depth: getDepth(el, rootEl),
    };
  }

  function makeLocator(el, rootEl) {
    if (!el || el.nodeType !== 1) return null;

    const id = el.id && !isHashy(el.id) ? el.id : null;
    const testid = getTestId(el);
    const aria = getAria(el);
    const role = getRole(el);

    return {
      anchors: { id, testid, aria, role },
      css: makeCss(el, rootEl),
      path: makePath(el, rootEl),
      fingerprint: makeFingerprint(el, rootEl),
    };
  }

  function collectElementsWithShadow(root = document, max = 2000) {
    const list = [];
    const queue = [root];
    while (queue.length && list.length < max) {
      const parent = queue.shift();
      const children = parent.querySelectorAll ? parent.querySelectorAll('*') : [];
      for (let i = 0; i < children.length && list.length < max; i++) {
        const child = children[i];
        list.push(child);
        if (child.shadowRoot) {
          queue.push(child.shadowRoot);
        }
      }
    }
    return list;
  }

  function querySelectorAllWithShadow(root, cssSelector) {
    if (!cssSelector) return [];
    let matches = [];
    try {
      matches = Array.from((root || document).querySelectorAll(cssSelector));
    } catch (_) {
      matches = [];
    }
    if (matches.length > 0) return matches;

    // Search inside open shadow roots if top-level query yielded no matches
    const all = collectElementsWithShadow(root);
    const shadowMatches = [];
    for (const el of all) {
      if (el.shadowRoot) {
        try {
          const sub = el.shadowRoot.querySelectorAll(cssSelector);
          for (const s of sub) shadowMatches.push(s);
        } catch (_) {}
      }
    }
    return shadowMatches;
  }

  function scoreFingerprint(fp, candidate, candidateDepth) {
    if (!fp || !candidate || candidate.nodeType !== 1) return 0;
    if (fp.tag && candidate.tagName !== fp.tag) return 0;

    let score = 0.25; // Base score for tag match

    // Classes score (weight 0.25)
    if (fp.classes && fp.classes.length) {
      const candClasses = new Set(stableTokens(candidate.className));
      let matches = 0;
      for (const c of fp.classes) if (candClasses.has(c)) matches++;
      score += 0.25 * (matches / fp.classes.length);
    } else {
      score += 0.15; // neutral credit if no classes specified
    }

    // Attributes score (weight 0.20)
    const fpAttrKeys = Object.keys(fp.attributes || {});
    if (fpAttrKeys.length) {
      let matches = 0;
      for (const k of fpAttrKeys) {
        if (candidate.getAttribute(k) === fp.attributes[k]) matches++;
      }
      score += 0.20 * (matches / fpAttrKeys.length);
    } else {
      score += 0.15;
    }

    // Text snippet score (weight 0.15)
    if (fp.textSnippet) {
      const candText = u.collapse(candidate.textContent || '').trim().slice(0, 60);
      if (candText === fp.textSnippet) score += 0.15;
      else if (candText.includes(fp.textSnippet) || fp.textSnippet.includes(candText)) score += 0.10;
    } else {
      score += 0.10;
    }

    // Child count similarity (weight 0.15)
    const candChildren = candidate.children.length;
    const diff = Math.abs(candChildren - (fp.childCount || 0));
    const maxC = Math.max(candChildren, fp.childCount || 0, 1);
    score += 0.15 * (1 - diff / maxC);

    return u.round2(score);
  }

  function resolveByPath(pathStr, rootEl) {
    if (!pathStr) return null;
    const scope = rootEl && rootEl.nodeType === 1 ? rootEl : document.body || document.documentElement;
    const steps = pathStr.split('>').map((s) => s.trim()).filter(Boolean);
    let cur = scope;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (i === 0 && step === 'BODY' && scope.tagName === 'BODY') continue;

      const match = step.match(/^([A-Z0-9-]+)(?::nth-of-type\((\d+)\))?$/i);
      if (!match) return null;
      const [, tag, nthStr] = match;
      const nth = nthStr ? parseInt(nthStr, 10) - 1 : 0;

      const children = Array.from(cur.children).filter((c) => c.tagName.toUpperCase() === tag.toUpperCase());
      if (nth >= children.length) return null;
      cur = children[nth];
    }
    return cur !== scope ? cur : null;
  }

  function resolveLocator(locator, rootEl = document) {
    if (!locator) return { el: null, elements: [], confidence: 0, strategy: 'none' };

    // Support string CSS input for backward compatibility/convenience
    if (typeof locator === 'string') {
      const matches = querySelectorAllWithShadow(rootEl, locator);
      return {
        el: matches[0] || null,
        elements: matches,
        confidence: matches.length ? 0.85 : 0,
        strategy: 'css',
      };
    }

    const { anchors, css, path, fingerprint } = locator;

    // 1. Anchors strategy
    if (anchors) {
      let anchorMatch = null;
      let conf = 0;
      if (anchors.id) {
        try { anchorMatch = (rootEl || document).querySelector('#' + cssEscape(anchors.id)); conf = 1.0; } catch (_) {}
      }
      if (!anchorMatch && anchors.testid) {
        try {
          anchorMatch = (rootEl || document).querySelector(
            `[data-testid="${cssEscape(anchors.testid)}"],[data-test-id="${cssEscape(anchors.testid)}"],[data-qa="${cssEscape(anchors.testid)}"]`
          );
          conf = 0.95;
        } catch (_) {}
      }
      if (!anchorMatch && anchors.aria) {
        try { anchorMatch = (rootEl || document).querySelector(`[aria-label="${cssEscape(anchors.aria)}"]`); conf = 0.90; } catch (_) {}
      }

      if (anchorMatch) {
        return { el: anchorMatch, elements: [anchorMatch], confidence: conf, strategy: 'anchor' };
      }
    }

    // 2. Stable CSS strategy
    if (css) {
      const cssMatches = querySelectorAllWithShadow(rootEl, css);
      if (cssMatches.length > 0) {
        return {
          el: cssMatches[0],
          elements: cssMatches,
          confidence: 0.85,
          strategy: 'css',
        };
      }
    }

    // 3. Structural Path strategy
    if (path) {
      const pathMatch = resolveByPath(path, rootEl);
      if (pathMatch) {
        return {
          el: pathMatch,
          elements: [pathMatch],
          confidence: 0.70,
          strategy: 'path',
        };
      }
    }

    // 4. Fingerprint Similarity strategy
    if (fingerprint) {
      const candidates = collectElementsWithShadow(rootEl || document);
      let best = null;
      let bestScore = 0;

      for (const cand of candidates) {
        const score = scoreFingerprint(fingerprint, cand);
        if (score > bestScore) {
          bestScore = score;
          best = cand;
        }
      }

      if (best && bestScore >= 0.5) {
        return {
          el: best,
          elements: [best],
          confidence: bestScore,
          strategy: 'fingerprint',
        };
      }
    }

    return { el: null, elements: [], confidence: 0, strategy: 'none' };
  }

  L.makeLocator = makeLocator;
  L.resolveLocator = resolveLocator;
  L.locator = {
    make: makeLocator,
    resolve: resolveLocator,
    makeCss,
    makePath,
    makeFingerprint,
    querySelectorAllWithShadow,
  };
})();
