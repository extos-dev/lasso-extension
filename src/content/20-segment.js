/* Segmentation: repetition mining (record groups) + per-item field vectors. */
(() => {
  const L = globalThis.Lasso, u = L.util;
  const SKIP_PARENTS = new Set(['TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TR', 'SELECT', 'DL', 'HEAD']);

  function shape(snap, n, d) {
    if (d === 0 || !n.children.length) return n.tag;
    return n.tag + '[' + n.children.slice(0, 8).map((c) => shape(snap, snap.nodes[c], d - 1)).join(',') + ']';
  }

  function fieldVector(snap, id) {
    const n = snap.nodes[id], s = n.stats, text = L.textOf(snap, id);
    return {
      link: s.linkCount > 0, image: s.imageCount > 0, heading: s.headingCount > 0,
      price: u.PRICE_RE.test(text), date: u.DATE_RE.test(text) || hasTag(snap, id, 'TIME'),
      textLength: s.textLength, linkDensity: s.linkDensity,
    };
  }
  function hasTag(snap, id, tag) { let f = false; L.walk(snap, id, (n) => { if (n.tag === tag) f = true; return !f; }); return f; }

  /** One repetition group under a parent, or null. Shared by global mining and inspect. */
  function groupForParent(snap, parent, minItems = 3, opts = {}) {
    if (!parent || parent.children.length < minItems || SKIP_PARENTS.has(parent.tag)) return null;
    const kids = parent.children.map((c) => snap.nodes[c]).filter((k) => !['BR', 'HR'].includes(k.tag));
    if (kids.length < minItems) return null;
    const relaxed = opts.relaxed || minItems < 3;
    const attempt = (keyFn, kind) => {
      const buckets = new Map();
      for (const k of kids) {
        const key = keyFn(k);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(k.id);
      }
      let best = null;
      for (const [key, ids] of buckets) if (!best || ids.length > best.ids.length) best = { key, ids };
      const threshold = relaxed ? 0.4 : 0.6;
      if (best && best.ids.length >= minItems && best.ids.length / kids.length >= threshold) return { key: best.key, ids: best.ids, kind };
      return null;
    };
    let hit =
      attempt((k) => shape(snap, k, 2) + '|' + u.stableTokens(k.cls).join('.'), 'class+shape') ||
      attempt((k) => shape(snap, k, 2), 'shape');
    // Fallback: if relaxed and no good cluster, try to find groups by tag similarity
    if (!hit && relaxed) {
      const tagBuckets = new Map();
      for (const k of kids) {
        const key = k.tag + (k.role ? '|' + k.role : '');
        if (!tagBuckets.has(key)) tagBuckets.set(key, []);
        tagBuckets.get(key).push(k.id);
      }
      let best = null;
      for (const [key, ids] of tagBuckets) if (!best || ids.length > best.ids.length) best = { key, ids };
      if (best && best.ids.length >= minItems && best.ids.length >= 2) {
        hit = { key: best.key, ids: best.ids, kind: 'tag' };
      }
    }
    if (!hit) return null;
    const vecs = hit.ids.map((id) => fieldVector(snap, id));
    const frac = (f) => vecs.filter(f).length / vecs.length;
    return {
      parentId: parent.id, itemIds: hit.ids, total: kids.length, ratio: hit.ids.length / kids.length, keyKind: hit.kind,
      fields: { link: frac((v) => v.link), image: frac((v) => v.image), heading: frac((v) => v.heading), price: frac((v) => v.price), date: frac((v) => v.date) },
      avgText: vecs.reduce((a, v) => a + v.textLength, 0) / vecs.length,
      avgLinkDensity: vecs.reduce((a, v) => a + v.linkDensity, 0) / vecs.length,
    };
  }

  /** Find groups of >=3 structurally similar siblings (dominant cluster ratio >= 0.6). */
  function mineRepetition(snap) {
    const groups = [];
    for (const parent of snap.nodes) {
      const g = groupForParent(snap, parent);
      if (g) groups.push(g);
    }
    return groups;
  }

  L.segment = { mineRepetition, groupForParent, fieldVector };
})();
