/* Article detector: Readability-style paragraph scoring -> container -> feature scoring + field hints. */
(() => {
  const L = globalThis.Lasso, u = L.util;
  const MIN_PROSE = 300;
  const prose = (n) => n.stats.textLength - n.stats.linkTextLength;

  function findIn(snap, rootId, pred) { let hit = null; L.walk(snap, rootId, (n) => { if (!hit && pred(n)) hit = n; return !hit; }); return hit; }
  const allRoot = (snap) => snap.root.id;
  const clean = (s) => (s || '').replace(/^\s*by\s+/i, '').replace(/\s+/g, ' ').trim();

  function ldValue(meta, keys) {
    for (const o of meta.jsonld) for (const k of keys) {
      let v = o[k]; if (Array.isArray(v)) v = v[0];
      if (v && typeof v === 'object') v = v.name || v['@id'] || v.url;
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  function hintsFor(snap, node, opts = {}) {
    const scoped = !!opts.scoped;
    const meta = snap.meta, id = node.id;
    const inScope = (pred) => findIn(snap, id, pred) ||
      (!scoped && findIn(snap, allRoot(snap), (n) => n.bp < 0.8 && pred(n)));
    const h1 = inScope((n) => n.tag === 'H1' && L.textOf(snap, n.id).length > 2);
    const title = (scoped ? '' : ldValue(meta, ['headline'])) || (h1 && L.textOf(snap, h1.id)) ||
      (scoped ? '' : (meta.og.title || meta.title || ''));
    let author = scoped ? '' : ldValue(meta, ['author']);
    if (!author) {
      const a = inScope((n) => n.el.getAttribute('rel') === 'author' || n.el.getAttribute('itemprop') === 'author') ||
        inScope((n) => { const p = u.pieces(n.cls); return (p.includes('author') || p.includes('byline')) && n.stats.textLength > 1 && n.stats.textLength <= 120; });
      if (a) author = L.textOf(snap, a.id).split(/\s[·|•—–]\s|\s{2,}/)[0];
    }
    author = clean(author || (scoped ? '' : (meta.meta.author || meta.meta['article:author'])) || '');
    let date = scoped ? '' : ldValue(meta, ['datePublished', 'dateCreated']);
    const t = inScope((n) => n.tag === 'TIME');
    if (!date && t) date = t.el.getAttribute('datetime') || L.textOf(snap, t.id);
    if (!date && !scoped) date = meta.meta['article:published_time'] || '';
    const headings = [];
    L.walk(snap, id, (n) => { if (/^H[2-6]$/.test(n.tag) && n.bp < 0.8) headings.push({ level: +n.tag[1], text: L.textOf(snap, n.id) }); });
    const img = findIn(snap, id, (n) => n.tag === 'IMG');
    const image = (scoped ? '' : meta.og.image) || (img ? img.el.currentSrc || img.el.src || '' : '');
    return { title: clean(title), author, publishedAt: date, headings: headings.slice(0, 60), image, wordCount: node.stats.wordCount };
  }

  L.articleHints = hintsFor;

  function refine(snap, cur) {
    // 1) climb to a semantic <article> that adds little extra prose
    for (let p = cur; p.parentId !== null; ) {
      p = snap.nodes[p.parentId];
      if (p.tag === 'BODY') break;
      if ((p.tag === 'ARTICLE' || p.tag === 'MAIN') && prose(p) <= prose(cur) * 1.5 && p.stats.paragraphCount <= cur.stats.paragraphCount + 3) return p.tag === 'ARTICLE' ? p : cur;
    }
    // 2) if our container lacks the H1, climb (<=4 levels) to a wrapper that has it without adding paragraphs
    if (!cur.stats.h1Count) {
      let p = cur;
      for (let i = 0; i < 4 && p.parentId !== null; i++) {
        p = snap.nodes[p.parentId];
        if (p.tag === 'BODY' || p.bp >= 0.8) break;
        if (p.stats.h1Count && p.stats.paragraphCount <= cur.stats.paragraphCount + 1 && prose(p) <= prose(cur) * 1.35) return p;
      }
    }
    // 3) tighten upward: absorb wrappers that add (almost) no extra prose and no boilerplate siblings (title/byline blocks)
    let c = cur;
    for (let i = 0; i < 3 && c.parentId !== null; i++) {
      const p = snap.nodes[c.parentId];
      if (p.tag === 'BODY' || p.tag === 'HTML' || p.bp >= 0.8) break;
      if (prose(p) > prose(c) * 1.08 || p.children.some((k) => snap.nodes[k].bp >= 0.8)) break;
      c = p;
    }
    return c;
  }

  function score(snap, node, groups) {
    const s = node.stats, ev = [], pr = prose(node);
    const has = (pred) => !!findIn(snap, node.id, pred);
    let paraLike = 0;
    L.walk(snap, node.id, (n) => { if (n.bp >= .8) return false; if (n.tag === 'P' || n.tag === 'BLOCKQUOTE' || (['DIV', 'SECTION', 'LI'].includes(n.tag) && n.own >= 80)) paraLike++; });
    let repetition = 0;
    for (const g of groups) {
      const par = snap.nodes[g.parentId];
      if (!(par === node || node.el.contains(par.el)) || (g.fields.heading < .6 && g.fields.link < .6)) continue;
      const cover = g.itemIds.reduce((a, i) => a + snap.nodes[i].stats.textLength, 0) / Math.max(1, s.textLength);
      if (cover > repetition) repetition = cover;
    }
    repetition = repetition > .7 ? repetition : 0;
    ev.push(u.sig('prose', .30, u.clamp(pr / 2500), `${pr} chars of non-link text`));
    ev.push(u.sig('paragraphs', .15, u.clamp(paraLike / 6), `${paraLike} paragraph-like blocks`));
    ev.push(u.sig('semantic', .12, node.tag === 'ARTICLE' ? 1 : node.tag === 'MAIN' ? .5 : 0, `<${node.tag.toLowerCase()}>`));
    const h1 = s.h1Count > 0 || !!findIn(snap, snap.root.id, (n) => n.tag === 'H1' && n.bp < .8);
    ev.push(u.sig('heading', .08, h1 ? 1 : 0, h1 ? 'h1 present' : 'no h1'));
    const ldArticle = snap.meta.jsonldTypes.some((t) => /Article|BlogPosting|NewsArticle|Report/i.test(t));
    ev.push(u.sig('jsonld', .08, ldArticle ? 1 : 0, ldArticle ? 'JSON-LD article type' : 'none'));
    const byline = has((n) => n.tag === 'TIME' || u.pieces(n.cls).some((p) => p === 'byline' || p === 'author'));
    ev.push(u.sig('byline', .07, byline ? 1 : 0, byline ? 'time/byline found' : 'none'));
    ev.push(u.sig('base', .10, 1, 'prior'));
    ev.push(u.sig('linkDensity', -.25, s.linkDensity, 'link text share (penalty)'));
    ev.push(u.sig('repetition', -.40, repetition, 'content is a repeated item list (penalty)'));
    ev.push(u.sig('boilerplate', -.40, node.bp, 'boilerplate ancestry (penalty)'));
    const total = u.clamp(ev.reduce((a, e) => a + e.weight * e.value, 0));
    return { score: u.round2(total), evidence: ev };
  }

  L.registerDetector({
    id: 'article', kinds: ['article'],
    detect(ctx) {
      const { snap } = ctx, sc = new Map();
      const add = (id, v) => { if (id !== null && id !== undefined) sc.set(id, (sc.get(id) || 0) + v); };
      for (const n of snap.nodes) {
        if (n.bp >= 0.8) continue;
        const para = n.tag === 'P' || n.tag === 'PRE' || n.tag === 'BLOCKQUOTE' || (['DIV', 'SECTION', 'LI', 'TD', 'SPAN'].includes(n.tag) && n.own >= 80);
        const len = n.tag === 'P' || n.tag === 'PRE' || n.tag === 'BLOCKQUOTE' ? n.stats.textLength - n.stats.linkTextLength : n.own;
        if (!para || len < 25) continue;
        const v = 1 + Math.min(len / 100, 3);
        add(n.parentId, v);
        if (n.parentId !== null) add(snap.nodes[n.parentId].parentId, v / 2);
      }
      let best = null;
      for (const [id, v] of sc) {
        const n = snap.nodes[id];
        if (n.tag === 'BODY' || n.tag === 'HTML' || prose(n) < MIN_PROSE || n.stats.paragraphCount + (sc.get(id) > 4 ? 1 : 0) < 1) continue;
        const adj = v * (1 - n.stats.linkDensity);
        if (!best || adj > best.adj) best = { n, adj };
      }
      const out = [];
      if (best) {
        const node = refine(snap, best.n);
        out.push({ detectorId: 'article', kind: 'article', nodeId: node.id, ...score(snap, node, ctx.groups) });
        for (const a of snap.nodes) {
          if (a.tag !== 'ARTICLE' || a.id === node.id || a.bp >= .8) continue;
          if (prose(a) < 1200 || snap.nodes[node.id].el.contains(a.el) || a.el.contains(snap.nodes[node.id].el)) continue;
          out.push({ detectorId: 'article', kind: 'article', nodeId: a.id, ...score(snap, a, ctx.groups) });
        }
      }
      for (const c of out) c.hints = hintsFor(snap, snap.nodes[c.nodeId]);
      return out;
    },
  });
})();
