/* Snapshot: read-only model of the VISIBLE page that references live elements.
 * Never mutates the page. Node ids are per-run (document order = id order). */
(() => {
  const L = globalThis.Lasso, u = L.util;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE']);
  const OPAQUE = new Set(['IFRAME', 'OBJECT', 'EMBED', 'CANVAS', 'VIDEO', 'AUDIO', 'SVG']);
  const BLOCK = new Set(['ADDRESS','ARTICLE','ASIDE','BLOCKQUOTE','DD','DETAILS','DIV','DL','DT','FIELDSET','FIGCAPTION','FIGURE','FOOTER','FORM','H1','H2','H3','H4','H5','H6','HEADER','HR','LI','MAIN','NAV','OL','P','PRE','SECTION','TABLE','TBODY','THEAD','TFOOT','TR','TD','TH','UL','BODY']);
  L.BLOCK = BLOCK;
  // Materialising a computed style per element is the snapshot's hot spot (~0.5 s on a
  // 25k-node page). checkVisibility() answers the same question in one native call and
  // covers display:none, visibility, opacity and content-visibility. jsdom (tests) has
  // no such API, so the computed-style path stays as the fallback and as the
  // disambiguator for the hidden cases.
  const CAN_CHECK_VISIBILITY = typeof Element !== 'undefined' && typeof Element.prototype.checkVisibility === 'function';
  const VISIBILITY_OPTS = { checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true };

  const BP_TOKENS = {
    cookie: .85, cookies: .85, consent: .85, gdpr: .85, newsletter: .8, subscribe: .7, sidebar: .75, advert: .85,
    advertisement: .85, adsense: .85, ad: .85, ads: .85, sponsor: .6, popup: .85, modal: .8, breadcrumb: .6,
    breadcrumbs: .6, share: .6, sharing: .6, social: .6, related: .55, recommended: .55, toolbar: .7,
  };

  function bpOwn(tag, role, tokens, inContent) {
    if (tag === 'BODY' || tag === 'HTML') return 0;
    let s = 0;
    if (tag === 'NAV') s = .85;
    else if (tag === 'ASIDE') s = .7;
    else if (tag === 'FOOTER') s = inContent ? .5 : .8;
    else if (tag === 'HEADER') s = inContent ? 0 : .7;
    if (role === 'navigation') s = Math.max(s, .85);
    else if (role === 'complementary') s = Math.max(s, .7);
    else if (role === 'contentinfo') s = Math.max(s, .8);
    else if (role === 'banner' && !inContent) s = Math.max(s, .7);
    else if (role === 'dialog' || role === 'alertdialog') s = Math.max(s, .85);
    for (const t of tokens) if (BP_TOKENS[t] > s) s = BP_TOKENS[t];
    return s;
  }

  function readMeta(doc) {
    const m = { title: doc.title || '', lang: doc.documentElement.lang || '', canonical: '', description: '', og: {}, meta: {}, jsonld: [], jsonldTypes: [] };
    const c = doc.querySelector('link[rel~="canonical"]'); if (c) m.canonical = c.href || c.getAttribute('href') || '';
    for (const el of doc.querySelectorAll('meta')) {
      const k = (el.getAttribute('property') || el.getAttribute('name') || '').toLowerCase();
      const v = el.getAttribute('content') || '';
      if (!k || !v) continue;
      if (k.startsWith('og:')) m.og[k.slice(3)] = v; else m.meta[k] = v;
    }
    m.description = m.meta.description || m.og.description || '';
    const types = new Set();
    const push = (o) => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) return o.forEach(push);
      if (o['@graph']) push(o['@graph']);
      const t = o['@type']; (Array.isArray(t) ? t : t ? [t] : []).forEach((x) => types.add(String(x)));
      if (o['@type']) m.jsonld.push(o);
    };
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try { push(JSON.parse(s.textContent)); } catch (_) { /* malformed JSON-LD is common; ignore */ }
    }
    m.jsonldTypes = [...types];
    return m;
  }

  L.snapshot = function snapshot(doc = document, opts = {}) {
    const maxNodes = opts.maxNodes || 25000, maxDepth = opts.maxDepth || 80;
    const view = doc.defaultView || globalThis;
    const nodes = [], byEl = new Map();
    const info = { truncated: false, opaque: 0, hiddenSkipped: 0 };
    const t0 = u.now();

    function visit(el, parentId, depth, parentBp, inContent, inPre) {
      const tag = el.tagName.toUpperCase();
      if (SKIP.has(tag)) return null;
      if (nodes.length >= maxNodes || depth > maxDepth) { info.truncated = true; return null; }
      if (el.hidden || el.hasAttribute('inert')) { info.hiddenSkipped++; return null; }
      let hiddenSubtree = false, hiddenSelf = false;
      if (!(CAN_CHECK_VISIBILITY && el.checkVisibility(VISIBILITY_OPTS))) {
        const cs = view.getComputedStyle(el);
        hiddenSubtree = cs.display === 'none' || cs.contentVisibility === 'hidden' ||
          (cs.opacity !== '' && Number(cs.opacity) === 0);
        // visibility:hidden can still have a deliberately visible child. Keep the
        // wrapper (without its own text) so that child survives; skip hidden
        // descendants as usual when their own computed visibility says hidden.
        hiddenSelf = cs.visibility === 'hidden' || cs.visibility === 'collapse';
      }
      if (hiddenSubtree) { info.hiddenSkipped++; return null; }
      if (hiddenSelf) info.hiddenSkipped++;

      const role = (el.getAttribute('role') || '').toLowerCase();
      const clsAttr = el.getAttribute('class') || '';
      const tokens = u.pieces(clsAttr + ' ' + (el.id || ''));
      const ownBp = bpOwn(tag, role, tokens, inContent);
      const bp = Math.max(parentBp, ownBp);
      const rawPre = inPre || tag === 'PRE';
      const id = nodes.length;
      const node = { id, el, tag, role, parentId, depth, cls: clsAttr, children: [], parts: [], bp, bpOwn: ownBp,
        rawParts: rawPre ? [] : null, own: 0, ownWords: 0,
        ariaHidden: el.getAttribute('aria-hidden') === 'true', hiddenSelf, stats: null };
      nodes.push(node); byEl.set(el, node);

      if (OPAQUE.has(tag)) { info.opaque++; node.stats = emptyStats(tag); return node; }

      const nowInContent = inContent || tag === 'ARTICLE' || tag === 'MAIN' || role === 'main' || role === 'article';
      let kids;
      if (tag === 'SLOT' && el.assignedNodes) {
        const a = el.assignedNodes({ flatten: true }); kids = a.length ? a : el.childNodes;
      } else kids = el.shadowRoot ? el.shadowRoot.childNodes : el.childNodes;

      for (const c of kids) {
        if (c.nodeType === 3) {
          if (hiddenSelf) continue;
          const t = u.collapse(c.nodeValue);
          if (!t) continue;
          const tt = t.trim();
          node.parts.push(t);
          if (rawPre) node.rawParts.push(c.nodeValue);
          if (tt) { node.own += tt.length; node.ownWords += tt.split(' ').length; }
        } else if (c.nodeType === 1) {
          const cn = visit(c, id, depth + 1, bp, nowInContent, rawPre);
          if (cn) { node.parts.push(cn.id); if (rawPre) node.rawParts.push(cn.id); node.children.push(cn.id); }
        }
      }

      const s = emptyStats(tag);
      s.textLength = node.own; s.wordCount = node.ownWords;
      for (const cid of node.children) {
        const cs2 = nodes[cid].stats;
        for (const k in s) if (k !== 'linkDensity') s[k] += cs2[k];
      }
      if (tag === 'A') { s.linkTextLength = s.textLength; s.linkCount += 1 - 0; }
      s.linkDensity = s.linkTextLength / Math.max(1, s.textLength);
      node.stats = s;
      return node;
    }

    function emptyStats(tag) {
      return {
        textLength: 0, wordCount: 0, linkTextLength: 0, linkCount: 0, linkDensity: 0,
        imageCount: tag === 'IMG' || tag === 'PICTURE' ? 1 : 0,
        headingCount: /^H[1-6]$/.test(tag) ? 1 : 0, h1Count: tag === 'H1' ? 1 : 0,
        paragraphCount: tag === 'P' ? 1 : 0, tableCount: tag === 'TABLE' ? 1 : 0, listCount: tag === 'UL' || tag === 'OL' ? 1 : 0,
        codeCount: tag === 'PRE' ? 1 : 0,
      };
    }

    const body = doc.body;
    const root = body ? visit(body, null, 0, 0, false, false) : null;
    // Recompute linkCount bottom-up (ids are pre-order so iterate in reverse).
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]; let c = n.tag === 'A' ? 1 : 0;
      for (const cid of n.children) c += nodes[cid].stats.linkCount;
      n.stats.linkCount = c;
    }
    return { doc, url: doc.location ? doc.location.href : '', nodes, byEl, root, meta: readMeta(doc), ...info, ms: u.now() - t0 };
  };

  /** Pre-order walk of a subtree. fn(node) may return false to skip that node's children. */
  L.walk = (snap, id, fn) => {
    const n = snap.nodes[id];
    if (fn(n) === false) return;
    for (const c of n.children) L.walk(snap, c, fn);
  };

  /** Visible text of a subtree (block boundaries become spaces). */
  L.textOf = (snap, id, opts = {}) => {
    const out = [];
    (function rec(n) {
      if (opts.skipAriaHidden && n.ariaHidden) return;
      if (opts.skipBoilerplate && n.bp >= .8) return;
      for (const p of n.parts) {
        if (typeof p === 'string') out.push(p);
        else { const c = snap.nodes[p], b = L.BLOCK.has(c.tag) || c.tag === 'BR'; if (b) out.push(' '); rec(c); if (b) out.push(' '); }
      }
    })(snap.nodes[id]);
    return out.join('').replace(/\s+/g, ' ').trim();
  };

  /** Visible text of a subtree with its original whitespace (for <pre>/code fences). */
  L.rawTextOf = (snap, id, opts = {}) => {
    const out = [];
    (function rec(n) {
      if (opts.skipAriaHidden && n.ariaHidden) return;
      if (opts.skipBoilerplate && n.bp >= .8) return;
      for (const p of n.rawParts || n.parts) {
        if (typeof p === 'string') out.push(p);
        else {
          const c = snap.nodes[p];
          if (c.tag === 'BR') out.push('\n'); else rec(c);
        }
      }
    })(snap.nodes[id]);
    return out.join('').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
  };

  /** Cheap stage-0 info: no snapshot, no page mutation. */
  L.light = (doc = document) => {
    const loc = doc.location, host = (loc && loc.hostname) || '';
    const meta = readMeta(doc);
    let siteName = meta.og.site_name || meta.meta['application-name'] || '';
    if (!siteName) {
      const parts = (doc.title || '').split(/\s[|\u2013\u2014-]\s/);
      siteName = parts.length > 1 ? parts[parts.length - 1].trim() : '';
    }
    if (!siteName) siteName = host.replace(/^www\./, '');
    const icon = doc.querySelector('link[rel~="icon"]');
    return {
      url: loc ? loc.href : '', hostname: host, path: loc ? loc.pathname : '', siteName, title: doc.title || '',
      favicon: icon ? icon.href : loc ? loc.origin + '/favicon.ico' : '', lang: meta.lang,
      jsonldTypes: meta.jsonldTypes, ogType: meta.og.type || '',
      counts: {
        article: doc.querySelectorAll('article').length, table: doc.querySelectorAll('table').length,
        h1: doc.querySelectorAll('h1').length, form: doc.querySelectorAll('form').length,
        password: doc.querySelectorAll('input[type="password"]').length,
      },
    };
  };
})();
