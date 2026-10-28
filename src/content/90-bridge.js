/* Bridge: message API between the side panel and the engine. */
(() => {
  const L = globalThis.Lasso;
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return;
  if (globalThis.__lassoListener) chrome.runtime.onMessage.removeListener(globalThis.__lassoListener);
  const handlers = {
    PING: () => ({ ok: true, version: L.version }),
    LIGHT: () => L.light(document),
    INSPECT_START: () => { const info = L.inspect.start(); L.overlay.inspectStart(); return info; },
    INSPECT_STATE: () => L.inspect.info(),
    INSPECT_STOP: () => { const info = L.inspect.stop(); L.overlay.inspectStop(); return info; },
    INSPECT_TREE: (m) => L.inspect.childrenOf(m.nodeId),
    INSPECT_SELECT: (m) => { const res = L.inspect.select(m.nodeId); L.overlay.inspectSelect(m.nodeId, m.scroll !== false); return res; },
    INSPECT_PATTERNS: (m) => L.inspect.detectPatterns(m.nodeId, m.patterns, m.opts || {}),
    INSPECT_SCAN_ALL: (m) => (L.scan ? L.scan.run({ patterns: m.patterns }) : L.inspect.scanAll(m.patterns)),
    SCAN_SET_SCOPE: (m) => (L.scan ? L.scan.setScope(m.nodeId) : { ok: false }),
    SCAN_GET_SCOPE: () => (L.scan ? L.scan.getScope() : { scopeId: null }),
    SCAN_CLEAR_SCOPE: () => (L.scan ? L.scan.clearScope() : { ok: false }),
    SCAN_RUN: (m) => (L.scan ? L.scan.run(m || {}) : L.inspect.scanAll(m && m.patterns)),
    INSPECT_RENDER: (m) => L.output.renderInspect(m.format),
    INSPECT_RENDER_ALL: (m) => L.output.renderInspectResults(m.format, m.results),
    RECIPE_RUN: (m) => L.recipe.run(m.recipe),
  };
  globalThis.__lassoListener = (msg, _sender, send) => {
    if (!msg || msg.lasso !== true || !handlers[msg.type]) return false;
    Promise.resolve().then(() => handlers[msg.type](msg)).then((r) => send({ ok: true, data: r }), (e) => send({ ok: false, error: String((e && e.message) || e) }));
    return true;
  };
  chrome.runtime.onMessage.addListener(globalThis.__lassoListener);
})();
