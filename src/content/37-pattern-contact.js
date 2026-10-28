/* Contact pattern: public name/email/phone/address/social links, usually a footer.
 * Layer 3 extension loaded after 35-inspect; registers through L.inspect.registerPattern. */
(() => {
  const L = globalThis.Lasso, u = L.util;
  if (!L || !L.inspect || typeof L.inspect.registerPattern !== 'function') return;
  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{1,4}\)?[\s.-]?){2,6}\d{2,4}/g;
  const FOOTER_WORDS = new Set(['footer', 'contact', 'contacts', 'about', 'imprint', 'legal', 'colophon']);
  const GENERIC_NAMES = new Set(['contact', 'contacts', 'contact us', 'get in touch', 'about', 'about us', 'imprint', 'legal', 'legal notice', 'colophon', 'footer']);
  const MAX_LINKS = 30;

  const uniq = (xs) => [...new Set(xs.map((x) => String(x).trim()).filter(Boolean))];

  function isFooterish(n) {
    if (!n) return false;
    if (n.tag === 'FOOTER' || n.role === 'contentinfo') return true;
    return u.pieces((n.cls || '') + ' ' + ((n.el && n.el.id) || '')).some((x) => FOOTER_WORDS.has(x));
  }

  function targetFor(snap, start) {
    let p = start;
    for (let i = 0; i < 6 && p; i++) {
      if (isFooterish(p)) return p;
      p = p.parentId !== null ? snap.nodes[p.parentId] : null;
    }
    let found = null;
    L.walk(snap, start.id, (n) => {
      if (!found && n !== start && isFooterish(n)) { found = n; return false; }
    });
    return found || start;
  }

  const visibleText = (snap, id) => L.textOf(snap, id, { skipAriaHidden: true });

  function walkVisible(snap, id, fn) {
    const root = snap.nodes[id];
    if (!root) return;
    (function rec(n) {
      if (n !== root && n.ariaHidden) return;
      if (fn(n) === false) return;
      for (const c of n.children) rec(snap.nodes[c]);
    })(root);
  }

  function firstVisible(snap, id, pred) {
    let hit = null;
    walkVisible(snap, id, (n) => {
      if (!hit && pred(n)) hit = n;
      return !hit;
    });
    return hit;
  }

  function readName(snap, id) {
    const clean = (x) => String(x || '').replace(/\s+/g, ' ').trim();
    const explicit = firstVisible(snap, id, (n) => n.el && n.el.getAttribute && n.el.getAttribute('itemprop') === 'name');
    if (explicit) {
      const text = clean(visibleText(snap, explicit.id));
      if (text) return text.slice(0, 120);
    }
    const headings = [];
    walkVisible(snap, id, (n) => { if (n !== snap.nodes[id] && /^H[1-4]$/.test(n.tag)) headings.push(n); });
    for (const node of headings) {
      const text = clean(visibleText(snap, node.id));
      if (text && !GENERIC_NAMES.has(text.toLowerCase())) return text.slice(0, 120);
    }
    const candidates = [];
    walkVisible(snap, id, (n) => { if (n !== snap.nodes[id] && /^(P|STRONG|B)$/.test(n.tag)) candidates.push(n); });
    for (const node of candidates) {
      const text = clean(visibleText(snap, node.id));
      if (text.length < 2 || text.length > 120) continue;
      if (GENERIC_NAMES.has(text.toLowerCase()) || /@|https?:\/\/|^\+?[\d\s().-]{7,}$/.test(text)) continue;
      return text.slice(0, 120);
    }
    return '';
  }

  function readLinks(snap, id) {
    const out = [];
    walkVisible(snap, id, (n) => {
      if (n.tag !== 'A') return;
      if (out.length >= MAX_LINKS) return false;
      const href = (n.el.getAttribute && n.el.getAttribute('href')) || '';
      if (!href) return;
      const text = visibleText(snap, n.id).replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!/^(mailto:|tel:)/i.test(href) && !text) return;
      let url = href;
      try { url = new URL(href, n.el.ownerDocument.baseURI).href; } catch (_) {}
      out.push({ text, url: url.slice(0, 500) });
    });
    return out;
  }

  function detect(startId) {
    const snap = L.inspect.snapshot(), start = snap && snap.nodes[startId];
    if (!start) return { ok: false, reason: 'element not found' };
    const target = targetFor(snap, start);
    const text = L.textOf(snap, target.id, { skipAriaHidden: true });
    const emails = uniq((text.match(EMAIL_RE) || []).map((s) => s.toLowerCase()));
    const phones = uniq((text.match(PHONE_RE) || []).filter((s) => {
      const d = s.replace(/\D/g, '');
      return d.length >= 7 && d.length <= 15;
    }).map((s) => s.replace(/\s+/g, ' ').trim()));
    const links = readLinks(snap, target.id);
    const footer = isFooterish(target);
    const addr = firstVisible(snap, target.id, (n) => n.tag === 'ADDRESS');
    const addresses = addr ? [visibleText(snap, addr.id).replace(/\s+/g, ' ').trim().slice(0, 300)].filter(Boolean) : [];
    if (!emails.length && !phones.length && !addresses.length && !footer) {
      return { ok: false, reason: 'no contact details in this selection' };
    }
    const name = readName(snap, target.id);
    const parts = [];
    if (emails.length) parts.push(`${emails.length} email${emails.length > 1 ? 's' : ''}`);
    if (phones.length) parts.push(`${phones.length} phone${phones.length > 1 ? 's' : ''}`);
    if (!parts.length && footer) parts.push(footer ? 'footer' : 'contact details');
    return {
      ok: true, nodeId: target.id,
      reason: parts.join(' · ') + (links.length ? ` · ${links.length} links` : ''),
      meta: { name, emails, phones, addresses, links, text, footer },
    };
  }

  function build(r) {
    const m = r.meta;
    return {
      kind: 'contact', nodeId: r.nodeId, name: m.name || '', emails: m.emails, phones: m.phones,
      addresses: m.addresses, links: m.links, text: m.text, footer: m.footer,
    };
  }

  L.inspect.registerPattern({ id: 'contact', label: 'Contact', order: 55, detect, build });
})();
