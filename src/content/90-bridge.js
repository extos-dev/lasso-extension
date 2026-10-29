/* Bridge: message API between the side panel and the engine. All messages carry {lasso:true, type}. */
(() => {
  const L = globalThis.Lasso;
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return; // tests / non-extension contexts
  if (globalThis.__lassoListener) chrome.runtime.onMessage.removeListener(globalThis.__lassoListener);

  // Inspect-only surface. The Phase 0 pipeline (L.analyze / L.output.render) is
  // called directly by the fixture harness, not over messages: there is no panel
  // sender for it any more, so no ANALYZE/RENDER/SELECT/OVERLAY/FORMATS handler.
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
    SCHEMA_BUILD: (m) => {
      const snap = L.inspect.snapshot();
      if (!snap || m.nodeId == null || !m.result) return { ok: false, error: 'No snapshot or result' };
      const schema = L.schema ? L.schema.buildSchemaFromResult(snap, m.nodeId, m.result, m.meta || {}) : {};
      return { ok: true, schema };
    },
    SCHEMA_RUN: (m) => {
      const snap = L.inspect.isActive() ? L.inspect.snapshot() : L.snapshot(document);
      if (!snap) return { ok: false, error: 'Failed to snapshot document' };
      return L.schema ? L.schema.run(snap, m.schema) : { ok: false, error: 'Schema module not loaded' };
    },
  };

  globalThis.__lassoListener = (msg, _sender, send) => {
    if (!msg || msg.lasso !== true || !handlers[msg.type]) return false;
    Promise.resolve().then(() => handlers[msg.type](msg)).then((r) => send({ ok: true, data: r }), (e) => send({ ok: false, error: String((e && e.message) || e) }));
    return true;
  };
  chrome.runtime.onMessage.addListener(globalThis.__lassoListener);
})();
