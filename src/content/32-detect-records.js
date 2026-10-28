/* Record-list detector: scores repetition groups and extracts per-item fields. */
(() => {
  const L = globalThis.Lasso, u = L.util;
  const first = (snap, id, pred) => { let hit = null; L.walk(snap, id, (n) => { if (!hit && pred(n)) hit = n; return !hit; }); return hit; };

  function extractItem(snap, id) {
    const item = {}, text = L.textOf(snap, id);
    const h = first(snap, id, (n) => /^H[1-6]$/.test(n.tag) && n.stats.textLength > 1);
    const a = first(snap, id, (n) => n.tag === 'A' && n.el.getAttribute('href') && !/^(javascript:|#)/i.test(n.el.getAttribute('href')));
    const strong = first(snap, id, (n) => (n.tag === 'STRONG' || n.tag === 'B') && n.stats.textLength > 2);
    const title = h ? L.textOf(snap, h.id) : a && L.textOf(snap, a.id).length >= 3 ? L.textOf(snap, a.id) : strong ? L.textOf(snap, strong.id) : '';
    if (title) item.title = title;
    if (a) item.url = a.el.href || a.el.getAttribute('href');
    const img = first(snap, id, (n) => n.tag === 'IMG');
    if (img) { const src = u.imageSrc(img.el); if (src) item.image = src; }
    const price = text.match(u.PRICE_RE); if (price) item.price = price[0].trim();
    const tm = first(snap, id, (n) => n.tag === 'TIME');
    const date = tm ? tm.el.getAttribute('datetime') || L.textOf(snap, tm.id) : (text.match(u.DATE_RE) || [''])[0];
    if (date) item.date = date;
    const p = first(snap, id, (n) => n.tag === 'P' && n.stats.textLength > 20);
    let snippet = p ? L.textOf(snap, p.id) : '';
    if (!snippet) {                                     // fallback: leftover text once known fields are removed
      snippet = text; for (const k of ['title', 'price', 'date']) if (item[k]) snippet = snippet.replace(item[k], ' ');
      snippet = snippet.replace(/\s+/g, ' ').trim(); if (snippet.length < 25) snippet = '';
    }
    if (snippet && snippet !== title) item.snippet = snippet.slice(0, 300);
    if (!Object.keys(item).length) item.text = text.slice(0, 300);
    return item;
  }
  L.extractRecordItem = extractItem;

  L.registerDetector({
    id: 'record_list', kinds: ['record_list'],
    detect(ctx) {
      const { snap, groups } = ctx, out = [];
      for (const g of groups) {
        const parent = snap.nodes[g.parentId], n = g.itemIds.length, f = g.fields;
        const richness = Math.max(f.link, f.image, f.heading);
        if (richness < .6) continue;                         // plain bullet lists are not records
        if (g.avgText < 15 && f.image < .6) continue;
        if (n < 4 && !((f.link >= .6 || f.image >= .6) && g.avgText >= 40)) continue;   // tiny groups need real content (avoids feature cards)
        const navLike = g.avgLinkDensity > .85 && g.avgText < 45 && f.image < .3;
        if (navLike) continue;
        const flavor = f.price >= .5 ? 'product' : f.date >= .5 && f.heading >= .5 ? 'post' : f.link >= .6 && f.heading >= .5 && g.avgText > 60 ? 'result' : 'generic';
        const ev = [
          u.sig('base', .05, 1, 'prior'),
          u.sig('count', .25, u.clamp((n - 2) / 8), `${n} items`),
          u.sig('consistency', .20, g.ratio, `${Math.round(g.ratio * 100)}% of siblings share the fingerprint`),
          u.sig('richness', .25, (f.link + f.image + f.heading) / 3 + (f.price + f.date) / 4, 'link/image/heading/price/date presence'),
          u.sig('itemText', .10, g.avgText >= 30 && g.avgText <= 700 ? 1 : .4, `avg ${Math.round(g.avgText)} chars/item`),
          u.sig('classStable', .10, g.keyKind === 'class+shape' ? 1 : .5, g.keyKind),
          u.sig('navLike', -.30, g.avgLinkDensity > .7 ? 1 : 0, 'mostly link text (penalty)'),
          u.sig('boilerplate', -.40, parent.bp, 'boilerplate ancestry'),
        ];
        const score = u.round2(u.clamp(ev.reduce((a, e) => a + e.weight * e.value, 0)));
        out.push({ detectorId: 'record_list', kind: 'record_list', nodeId: parent.id, score, evidence: ev,
          itemIds: g.itemIds, hints: { flavor, count: n, fields: Object.fromEntries(Object.entries(f).filter(([, v]) => v >= .5).map(([k, v]) => [k, u.round2(v)])) } });
      }
      return out;
    },
  });
})();
