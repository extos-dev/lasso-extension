/* Stable locator generation for recipe authoring. No page mutation. */
(() => {
  const L = globalThis.Lasso;
  const MAX = 900;
  const esc = (value) => {
    const s = String(value || '');
    if (globalThis.CSS && typeof CSS.escape === 'function') return CSS.escape(s);
    return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
  };
  const useful = (value) => {
    const s = String(value || '').trim();
    return s && s.length <= 80 && !L.util.isHashy(s) ? s : '';
  };
  const stableClass = (el) => [...(el.classList || [])].map(useful).filter(Boolean).slice(0, 2);
  const unique = (root, selector, el) => {
    try { return root.querySelectorAll(selector).length === 1 && root.querySelector(selector) === el; } catch (_) { return false; }
  };
  const simple = (el) => {
    if (el.id && useful(el.id)) return `#${esc(el.id)}`;
    for (const attr of ['data-testid', 'data-test', 'name', 'aria-label']) {
      const value = useful(el.getAttribute(attr));
      if (value) {
        const selector = `[${attr}="${esc(value)}"]`;
        if (unique(document, selector, el)) return selector;
      }
    }
    const classes = stableClass(el);
    return el.tagName.toLowerCase() + classes.map((c) => `.${esc(c)}`).join('');
  };
  const path = (el, root = document.body) => {
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && node !== root; node = node.parentElement) {
      const base = simple(node);
      if (unique(root, base, node)) { parts.unshift(base); break; }
      const siblings = node.parentElement ? [...node.parentElement.children].filter((x) => x.tagName === node.tagName) : [];
      const index = Math.max(1, siblings.indexOf(node) + 1);
      parts.unshift(`${base}:nth-of-type(${index})`);
    }
    return parts.join(' > ').slice(0, MAX);
  };
  const signature = (el) => ({ tag: el.tagName.toLowerCase(), text: String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120), childTags: [...el.children].slice(0, 12).map((c) => c.tagName.toLowerCase()) });
  L.locator = {
    forElement(el, root = document.body) {
      if (!el || el.nodeType !== 1) throw new Error('Locator target must be an element');
      const selectors = [];
      const direct = simple(el);
      if (unique(root, direct, el)) selectors.push(direct);
      const structural = path(el, root);
      if (structural && !selectors.includes(structural) && unique(root, structural, el)) selectors.push(structural);
      if (!selectors.length) selectors.push(structural || direct);
      return { selector: selectors[0].slice(0, MAX), fallbacks: selectors.slice(1, 4), signature: signature(el) };
    },
    resolve(locator, root = document.body) {
      if (!locator || typeof locator !== 'object') return null;
      for (const selector of [locator.selector, ...(locator.fallbacks || [])]) {
        try { const el = root.querySelector(selector); if (el) return el; } catch (_) {}
      }
      return null;
    },
  };
})();
