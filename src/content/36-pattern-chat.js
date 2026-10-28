/* Chat pattern: a conversation thread of repeated message blocks.
 * Layer 3 extension loaded after 35-inspect; registers through L.inspect.registerPattern.
 * Roles are read from common AI-chat attributes/classes; absent roles become "message". */
(() => {
  const L = globalThis.Lasso, u = L.util;
  if (!L || !L.inspect || typeof L.inspect.registerPattern !== 'function') return;
  const ROLE_ATTRS = ['data-message-author-role', 'data-author-role', 'data-message-role', 'data-role', 'data-sender', 'data-author', 'data-testid'];
  const ROLE_WORDS = new Set(['user', 'human', 'assistant', 'bot', 'ai', 'model', 'system', 'agent', 'me', 'you']);
  const ROLE_MAP = { human: 'user', me: 'user', you: 'user', bot: 'assistant', ai: 'assistant', model: 'assistant' };
  const MAX_SCAN = 400;

  function roleOfNode(n) {
    if (!n) return '';
    for (const a of ROLE_ATTRS) {
      const v = n.el && n.el.getAttribute(a);
      if (v && String(v).trim()) return normalizeRole(v);
    }
    const pieces = u.pieces((n.cls || '') + ' ' + ((n.el && n.el.id) || ''));
    for (const p of pieces) if (ROLE_WORDS.has(p)) return normalizeRole(p);
    return '';
  }

  function normalizeRole(v) {
    const s = String(v).trim().toLowerCase();
    if (ROLE_WORDS.has(s)) return ROLE_MAP[s] || s;
    if (/^(user|human|me|you)\b/.test(s)) return 'user';
    if (/^(assistant|bot|ai|model)\b/.test(s)) return 'assistant';
    if (/^system\b/.test(s)) return 'system';
    return '';
  }

  function roleFor(snap, n) {
    let cur = n, role = '';
    for (let i = 0; cur && i < 3 && !role; i++) {
      role = roleOfNode(cur);
      cur = cur.parentId !== null ? snap.nodes[cur.parentId] : null;
    }
    return role;
  }

  function roleDeep(snap, n) {
    let role = '';
    L.walk(snap, n.id, (d) => {
      if (d.depth - n.depth > 2) return false;
      role = roleOfNode(d);
      return !role;
    });
    return role;
  }

  function chain(snap, n) {
    const out = [];
    let cur = n;
    while (cur) { out.push(cur.id); cur = cur.parentId !== null ? snap.nodes[cur.parentId] : null; }
    return out;
  }

  function commonAncestor(snap, ids) {
    if (!ids.length) return null;
    let common = new Set(chain(snap, snap.nodes[ids[0]]));
    for (const id of ids.slice(1)) {
      const own = new Set(chain(snap, snap.nodes[id]));
      common = new Set([...common].filter((x) => own.has(x)));
    }
    const first = chain(snap, snap.nodes[ids[0]]);
    return first.find((id) => common.has(id)) ?? null;
  }

  function topRoleNodes(snap, ids) {
    const set = new Set(ids);
    return ids.filter((id) => !chain(snap, snap.nodes[id]).slice(1).some((x) => set.has(x)));
  }

  function fromGroup(snap, g) {
    const items = g.itemIds;
    if (items.length < 2 || items.length > 200) return null;
    const texts = items.map((id) => L.textOf(snap, id).trim());
    if (texts.some((t) => !t)) return null;
    const avg = texts.reduce((a, t) => a + t.length, 0) / texts.length;
    const roles = items.map((id) => roleFor(snap, snap.nodes[id]) || roleDeep(snap, snap.nodes[id]));
    const hintRatio = roles.filter(Boolean).length / items.length;
    if (avg < 40 || g.avgLinkDensity > .22) return null;
    if (hintRatio < .5 && !(items.length >= 3 && avg >= 140 && g.avgLinkDensity <= .10)) return null;
    const score = items.length * 2 + hintRatio * 12 + Math.min(10, avg / 40) + (g.avgLinkDensity <= .10 ? 3 : 0);
    return { parentId: g.parentId, itemIds: items, roles, hintRatio, avg, score };
  }

  function fromRoles(snap, start) {
    let p = start;
    for (let i = 0; i < 5 && p; i++) {
      const ids = [];
      L.walk(snap, p.id, (n) => {
        if (ids.length > 200) return false;
        if (roleOfNode(n)) ids.push(n.id);
      });
      if (ids.length >= 2) {
        const top = topRoleNodes(snap, ids);
        const parentId = commonAncestor(snap, top);
        if (top.length >= 2 && parentId !== null) {
          const roles = top.map((id) => roleOfNode(snap.nodes[id]));
          return { parentId, itemIds: top, roles, hintRatio: 1, avg: 0, score: 100 + top.length };
        }
      }
      p = p.parentId !== null ? snap.nodes[p.parentId] : null;
    }
    return null;
  }

  function detect(startId) {
    const snap = L.inspect.snapshot(), start = snap && snap.nodes[startId];
    if (!start) return { ok: false, reason: 'element not found' };
    const seen = new Set(), candidates = [];
    const add = (p) => {
      if (!p || seen.has(p.id)) return;
      seen.add(p.id);
      const g = L.segment.groupForParent(snap, p, 2);
      const c = g && fromGroup(snap, g);
      if (c) candidates.push(c);
    };
    let p = start;
    for (let i = 0; i < 7 && p; i++) { add(p); p = p.parentId !== null ? snap.nodes[p.parentId] : null; }
    let walked = 0;
    L.walk(snap, start.id, (n) => {
      if (walked++ > MAX_SCAN) return false;
      if (n !== start && n.children.length >= 2) add(n);
    });
    const roleThread = fromRoles(snap, start);
    if (roleThread) candidates.push(roleThread);
    if (!candidates.length) return { ok: false, reason: 'no conversation thread in this selection' };
    candidates.sort((a, b) => b.score - a.score || b.itemIds.length - a.itemIds.length);
    const best = candidates[0];
    const withRoles = best.roles.filter(Boolean).length;
    return {
      ok: true, nodeId: best.parentId, itemIds: best.itemIds, roles: best.roles,
      reason: `${best.itemIds.length} messages${withRoles ? ` · ${withRoles} with roles` : ''}`,
      meta: { count: best.itemIds.length, roles: withRoles, roleHints: best.hintRatio >= .5 },
    };
  }

  function build(r) {
    const snap = L.inspect.snapshot();
    const messages = r.itemIds.map((id, i) => ({ role: r.roles[i] || 'message', text: L.textOf(snap, id).trim() }));
    return { kind: 'chat', nodeId: r.nodeId, count: messages.length, messages };
  }

  L.inspect.registerPattern({ id: 'chat', label: 'Chat', order: 25, detect, build });
})();
