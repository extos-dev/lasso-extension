/* Pipeline: snapshot -> segment -> detectors -> arbitration -> classification. Keeps the last analysis in L.last. */
(() => {
  const L = globalThis.Lasso, u = L.util;

  const label = (n) => n.tag.toLowerCase() + (n.el.id ? '#' + n.el.id : '') + (n.cls ? '.' + n.cls.trim().split(/\s+/)[0] : '');

  function serialize(snap, r) {
    const n = snap.nodes[r.nodeId];
    return {
      id: r.id, kind: r.kind, score: r.score, detectorId: r.detectorId, label: label(n),
      preview: L.textOf(snap, n.id, { skipBoilerplate: true }).slice(0, 160),
      evidence: [...r.evidence].sort((a, b) => Math.abs(b.weight * b.value) - Math.abs(a.weight * a.value)).slice(0, 6),
      hints: r.hints, children: (r.children || []).map((c) => serialize(snap, c)),
      alternatives: (r.alternatives || []).map((a) => ({ kind: a.kind, score: a.score, label: label(snap.nodes[a.nodeId]) })),
    };
  }

  L.analyze = async function analyze(opts = {}) {
    const t0 = u.now(), timings = {};
    const mark = (k, t) => { timings[k] = u.now() - t; };
    let t = u.now();
    const snap = L.snapshot(document, opts); mark('snapshot', t);
    await u.yieldToMain(); t = u.now();
    const groups = L.segment.mineRepetition(snap); mark('segment', t);
    await u.yieldToMain(); t = u.now();
    const ctx = { snap, groups, meta: snap.meta }, cands = [], errors = [];
    for (const d of L.detectors) {
      try { cands.push(...d.detect(ctx)); } catch (e) { errors.push({ detector: d.id, error: String(e && e.message || e) }); }
    }
    mark('detect', t); t = u.now();
    const tree = L.arbitrate(snap, cands); mark('arbitrate', t);
    const light = L.light(document);
    const classification = L.classify(snap, tree.flat, light);
    const byId = new Map(tree.flat.map((r) => [r.id, r]));
    L.last = { snap, tree, byId, classification, light };
    return {
      light, classification, regions: tree.roots.map((r) => serialize(snap, r)),
      stats: { nodes: snap.nodes.length, truncated: snap.truncated, hiddenSkipped: snap.hiddenSkipped, opaqueBoundaries: snap.opaque, errors, timings, totalMs: u.now() - t0 },
    };
  };
})();
