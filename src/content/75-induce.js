/* Lasso engine — Induction from sample elements.
 * Classic-script layer 75.
 * Induces LCA scope, relative item selector/locator, and aligned field locators
 * from a set of sample DOM elements. */
(() => {
  const L = globalThis.Lasso, u = L.util;

  function findLCA(elements) {
    if (!elements || !elements.length) return document.body || document.documentElement;
    if (elements.length === 1) return elements[0].parentElement || elements[0];

    let lca = elements[0].parentElement;
    while (lca && lca !== document.documentElement) {
      if (elements.every((el) => lca.contains(el))) return lca;
      lca = lca.parentElement;
    }
    return document.body || document.documentElement;
  }

  function induceItemSelector(scopeEl, elements) {
    if (!elements || !elements.length) return '*';
    const tag = elements[0].tagName.toLowerCase();
    const sameTag = elements.every((el) => el.tagName.toLowerCase() === tag);

    if (!sameTag) return '*';

    // Find common stable class names
    const commonClasses = L.locator ? L.locator.makeFingerprint(elements[0]).classes : [];
    const sharedClasses = commonClasses.filter((cls) =>
      elements.every((el) => el.classList && el.classList.contains(cls))
    );

    function cssEscape(str) {
      if (typeof globalThis.CSS !== 'undefined' && typeof globalThis.CSS.escape === 'function') {
        return globalThis.CSS.escape(str);
      }
      return String(str || '').replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
    }

    if (sharedClasses.length > 0) {
      return `${tag}.${sharedClasses.map(cssEscape).join('.')}`;
    }

    // Role or attribute induction
    const role = elements[0].getAttribute('role');
    if (role && elements.every((el) => el.getAttribute('role') === role)) {
      return `${tag}[role="${cssEscape(role)}"]`;
    }

    return tag;
  }

  function findFieldInItem(itemEl, type) {
    if (!itemEl) return null;

    switch (type) {
      case 'title': {
        const heading = itemEl.querySelector('h1, h2, h3, h4, h5, h6, .title, .name, [class*="title"], [class*="name"]');
        if (heading) return heading;
        const firstLink = itemEl.querySelector('a');
        if (firstLink && u.collapse(firstLink.textContent || '').length > 3) return firstLink;
        return null;
      }
      case 'link': {
        return itemEl.querySelector('a[href]') || (itemEl.tagName === 'A' && itemEl.hasAttribute('href') ? itemEl : null);
      }
      case 'image': {
        return itemEl.querySelector('img') || (itemEl.tagName === 'IMG' ? itemEl : null);
      }
      case 'price': {
        const priceEl = itemEl.querySelector('.price, [class*="price"], [id*="price"]');
        if (priceEl) return priceEl;
        const all = itemEl.querySelectorAll('span, p, div, b, strong');
        for (const el of all) {
          if (el.children.length === 0 && u.PRICE_RE && u.PRICE_RE.test(el.textContent || '')) {
            return el;
          }
        }
        return null;
      }
      case 'date': {
        const dateEl = itemEl.querySelector('.date, time, [class*="date"], [id*="date"]');
        if (dateEl) return dateEl;
        const all = itemEl.querySelectorAll('span, p, time, div');
        for (const el of all) {
          if (el.children.length === 0 && u.DATE_RE && u.DATE_RE.test(el.textContent || '')) {
            return el;
          }
        }
        return null;
      }
      case 'description': {
        const p = itemEl.querySelector('p, .description, .summary, [class*="desc"]');
        if (p) return p;
        return null;
      }
      default:
        return null;
    }
  }

  function induceFields(sampleElements) {
    if (!sampleElements || !sampleElements.length) return {};
    const sample = sampleElements[0];
    const fields = {};

    const fieldTypes = ['title', 'link', 'image', 'price', 'date', 'description'];

    for (const fieldType of fieldTypes) {
      const matchInFirst = findFieldInItem(sample, fieldType);
      if (!matchInFirst) continue;

      // Check if match exists across majority of samples
      const matchCount = sampleElements.filter((el) => !!findFieldInItem(el, fieldType)).length;
      if (matchCount < Math.ceil(sampleElements.length * 0.5)) continue;

      let type = 'text';
      let attribute = null;

      if (fieldType === 'link') {
        type = 'attribute';
        attribute = 'href';
      } else if (fieldType === 'image') {
        type = 'attribute';
        attribute = 'src';
      }

      fields[fieldType] = {
        name: fieldType,
        type,
        attribute,
        locator: L.makeLocator(matchInFirst, sample),
      };
    }

    return fields;
  }

  function fromSamples(elements) {
    if (!elements || !elements.length) {
      return {
        scope: null,
        scopeEl: document.body,
        itemCss: '*',
        item: null,
        fields: {},
      };
    }

    const scopeEl = findLCA(elements);
    const scopeLocator = L.makeLocator(scopeEl);
    const itemCss = induceItemSelector(scopeEl, elements);
    const itemLocator = L.makeLocator(elements[0], scopeEl);
    if (itemLocator) {
      itemLocator.css = itemCss;
    }

    const fields = induceFields(elements);

    return {
      scope: scopeLocator,
      scopeEl,
      itemCss,
      item: itemLocator,
      fields,
    };
  }

  L.induce = {
    fromSamples,
    findLCA,
    induceItemSelector,
    induceFields,
  };
})();
