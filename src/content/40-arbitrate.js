/* Arbitration: candidates -> region TREE. Same-kind overlaps compete; different kinds nest. */
(() => {
  const L = globalThis.Lasso, u = L.util;
  const MIN_SCORE = { article: .45, table: .45, record_list: .5 };

  L.arbitrate = function arbitrate(snap, candidates) {
    const live = candidates.filter((c) => c.score >= (MIN_SCORE[c.kind] ?? .45)).sort((a, b) => a.nodeId - b.nodeId || b.score - a.score);
    const contains = (a, b) => a.nodeId !== b.nodeId && snap.nodes[a.nodeId].el.contains(snap.nodes[b.nodeId].el);
    const prim = [];
    for (const c of live) {
      c.alternatives = [];
      const rival = prim.find((p) => p.kind === c.kind && c.kind !== 'table' && (p.nodeId === c.nodeId || contains(p, c) || contains(c, p)));
      if (!rival) { prim.push(c); continue; }
      if (c.score > rival.score) { prim[prim.indexOf(rival)] = c; c.alternatives.push(rival, ...rival.alternatives); delete rival.alternatives; }
      else rival.alternatives.push(c);
    }
    prim.sort((a, b) => a.nodeId - b.nodeId);
    let i = 0; const stack = [], roots = [];
    for (const r of prim) {
      r.id = 'r' + ++i; r.children = [];
      while (stack.length && !contains(stack[stack.length - 1], r)) stack.pop();
      if (stack.length) stack[stack.length - 1].children.push(r); else roots.push(r);
      stack.push(r);
    }
    return { roots, flat: prim };
  };
})();
