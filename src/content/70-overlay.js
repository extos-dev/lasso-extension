/* Overlay: our own closed shadow-root host. The ONLY thing Lasso ever adds to the page.
 * One mode: inspect (hover highlight, click selection, right-click checkbox picker, Escape exit). */
(() => {
  const L = globalThis.Lasso;
  const STYLE = `
    :host { all: initial; }
    .hl { position: fixed; box-sizing: border-box; border-radius: 3px; pointer-events: none; transition: opacity .08s; }
    .hl.sel { border: 2px solid #2563eb; background: rgba(37,99,235,.10); }
    .hl.hover { border: 1px dashed #7c3aed; background: rgba(124,58,237,.06); }
    .bd { position: fixed; max-width: 70vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 600 11px/18px system-ui, sans-serif; color: #fff; background: #111827; padding: 0 6px; border-radius: 3px; pointer-events: none; }
    .bd.sel { background: #2563eb; }
    .menu { position: fixed; z-index: 2; min-width: 230px; max-width: 300px; max-height: min(70vh, 420px); overflow: auto; pointer-events: auto; background: #fff; color: #14181f; border: 1px solid #d0d5dd; border-radius: 10px; box-shadow: 0 12px 32px rgba(16,24,40,.22); padding: 6px; font: 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; }
    .mh { padding: 5px 8px 7px; color: #667085; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    .mi { display: block; width: 100%; text-align: left; border: 0; border-radius: 7px; background: transparent; color: inherit; padding: 7px 8px; cursor: pointer; font: inherit; }
    .mi:hover:not(:disabled), .mi:focus-visible { background: #eef4ff; outline: none; }
    .mi:disabled { color: #98a2b3; cursor: default; }
    .mi b { display: block; font-weight: 650; }
    .mi span { display: block; font-size: 11px; color: #667085; margin-top: 1px; }
    .mf { padding: 6px 8px 2px; color: #98a2b3; font-size: 11px; border-top: 1px solid #eaecf0; margin-top: 4px; }
    .mcheck { display:flex; align-items:flex-start; gap:7px; padding:6px 8px; border-radius:7px; cursor:pointer; }
    .mcheck:hover, .mcheck:focus-within { background:#eef4ff; }
    .mcheck input { margin:2px 0 0; accent-color:#2563eb; flex:none; }
    .mcheck b { display:block; font-weight:650; }
    .mcheck span { display:block; font-size:11px; color:#667085; margin-top:1px; }
    .mdetect { width:calc(100% - 16px); margin:6px 8px 2px; border:0; border-radius:7px; background:#2563eb; color:#fff; padding:8px; font:600 13px/1.2 system-ui,sans-serif; cursor:pointer; }
    .mdetect:disabled { opacity:.5; cursor:default; }
    .mr { padding:4px 8px 8px; }
    .mr b { display:block; font-size:14px; }
    .mr span { display:block; color:#667085; font-size:12px; margin-top:2px; }
    .mr .mwhy { color:#b45309; }
    .msend { width:calc(100% - 16px); margin:2px 8px 4px; border:0; border-radius:7px; background:#2563eb; color:#fff; padding:8px; font:600 13px/1.2 system-ui,sans-serif; cursor:pointer; }
    .mback { width:calc(100% - 16px); margin:2px 8px 2px; border:1px solid #d0d5dd; border-radius:7px; background:#fff; color:#14181f; padding:7px 8px; font:600 12px/1.2 system-ui,sans-serif; cursor:pointer; }
    @media (prefers-color-scheme: dark) {
      .menu { background: #171a21; color: #e8eaee; border-color: #2a2f3a; }
      .mh, .mi span, .mf { color: #98a2b3; }
      .mi:hover:not(:disabled), .mi:focus-visible { background: #222b3a; }
      .mi:disabled { color: #667085; }
      .mcheck:hover, .mcheck:focus-within { background:#222b3a; }
      .mcheck span, .mr span { color:#98a2b3; }
      .mback { background:#171a21; color:#e8eaee; border-color:#2a2f3a; }
      .mf { border-top-color: #2a2f3a; }
    }
  `;

  let host = null, shadow = null, raf = 0, bound = false;
  let inspectActive = false, selectedId = null, hoverId = null, menu = null, menuNodeId = null, picks = [];

  const schedule = () => { if (!raf && host) raf = requestAnimationFrame(() => { raf = 0; paint(); }); };
  const inHost = (e) => {
    if (!host) return false;
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    return path.includes(host) || (e.target && host.contains(e.target));
  };
  const send = (type, payload) => { try { chrome.runtime.sendMessage({ lasso: true, type, ...(payload || {}) }); } catch (_) {} };
  // Press AND release for mouse/touch: sites commonly navigate or open menus on
  // mouseup/auxclick, not only on mousedown.
  const ACTION_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'auxclick', 'touchstart', 'touchend', 'pointercancel', 'dblclick', 'dragstart', 'submit'];

  function ensure() {
    if (host) return;
    // Re-injection after an extension reload leaves the previous isolated
    // world's host in the page DOM; remove any stale host before mounting.
    for (const old of document.querySelectorAll('[data-lasso-overlay]')) old.remove();
    host = document.createElement('div');
    host.setAttribute('data-lasso-overlay', '');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    shadow = host.attachShadow({ mode: 'closed' });
    const st = document.createElement('style');
    st.textContent = STYLE;
    shadow.append(st);
    document.documentElement.append(host);
    bind();
  }

  function bind() {
    if (bound) return;
    addEventListener('scroll', onScroll, true);
    addEventListener('resize', onResize);
    addEventListener('mousemove', onMove, true);
    addEventListener('click', onClick, true);
    addEventListener('contextmenu', onContext, true);
    addEventListener('keydown', onKey, true);
    for (const type of ACTION_EVENTS) addEventListener(type, onGuard, true);
    bound = true;
  }

  function unbind() {
    if (!bound) return;
    removeEventListener('scroll', onScroll, true);
    removeEventListener('resize', onResize);
    removeEventListener('mousemove', onMove, true);
    removeEventListener('click', onClick, true);
    removeEventListener('contextmenu', onContext, true);
    removeEventListener('keydown', onKey, true);
    for (const type of ACTION_EVENTS) removeEventListener(type, onGuard, true);
    bound = false;
  }

  function clearBoxes() {
    if (!shadow) return;
    for (const el of [...shadow.querySelectorAll('.hl, .bd')]) el.remove();
  }

  function paint() {
    if (!shadow) return;
    clearBoxes();
    paintInspect();
  }

  function paintInspect() {
    const snap = L.inspect && L.inspect.snapshot();
    if (!snap) return;
    const ids = [];
    if (selectedId !== null) ids.push(['sel', selectedId]);
    if (hoverId !== null && hoverId !== selectedId) ids.push(['hover', hoverId]);
    for (const [kind, id] of ids) {
      const n = snap.nodes[id];
      if (!n) continue;
      const rect = n.el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      const box = document.createElement('div');
      box.className = 'hl ' + kind;
      box.style.left = `${rect.left}px`; box.style.top = `${rect.top}px`;
      box.style.width = `${rect.width}px`; box.style.height = `${rect.height}px`;
      shadow.append(box);
      const bd = document.createElement('div');
      bd.className = 'bd' + (kind === 'sel' ? ' sel' : '');
      const tag = L.inspect.nodeLabel(n);
      bd.textContent = `${kind === 'sel' ? 'selected · ' : ''}${tag} · ${Math.round(rect.width)}×${Math.round(rect.height)}`;
      bd.style.left = `${Math.max(4, Math.min(rect.left, innerWidth - 220))}px`;
      bd.style.top = `${Math.max(4, rect.top - 22)}px`;
      shadow.append(bd);
    }
  }

  function onScroll() { closeMenu(); schedule(); }
  function onResize() { closeMenu(); schedule(); }

  function onMove(e) {
    if (!inspectActive || inHost(e)) return;
    if (menu) {
      if (hoverId !== null) { hoverId = null; schedule(); send('NODE_HOVERED', { id: null }); }
      return;
    }
    const n = L.inspect.nodeAt(e.target);
    const id = n ? n.id : null;
    if (id !== hoverId) { hoverId = id; schedule(); send('NODE_HOVERED', { id }); }
  }

  function onGuard(e) {
    if (!inspectActive || inHost(e)) return;
    // Block unconditionally, even when the target is outside the snapshot
    // (truncated documents, foreign subtrees). Inspect mode must never let the
    // page navigate or react under the picker, and the overlay is the only
    // thing allowed to receive these events.
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onClick(e) {
    if (!inspectActive || inHost(e)) return;
    const n = L.inspect.nodeAt(e.target);
    if (!n) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    closeMenu();
    const res = L.inspect.select(n.id);
    selectedId = n.id; hoverId = null; schedule();
    send('NODE_SELECTED', res);
  }

  function onContext(e) {
    if (!inspectActive || inHost(e)) return;
    const n = L.inspect.nodeAt(e.target);
    if (!n) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const res = L.inspect.select(n.id);
    selectedId = n.id; hoverId = null; schedule();
    send('NODE_SELECTED', res);
    openMenu(e.clientX, e.clientY, n.id, res.patternsReady, res.results);
  }

  function onKey(e) {
    if (!inspectActive) return;
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      if (selectedId === null) return;
      const snap = L.inspect && L.inspect.snapshot();
      const n = snap && snap.nodes[selectedId];
      if (!n) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const rect = n.el.getBoundingClientRect();
      const st = L.inspect.info();
      openMenu(rect.left + Math.min(12, rect.width / 2), rect.top + Math.min(12, rect.height / 2), n.id, st.patternsReady, st.results);
      return;
    }
    if (e.key !== 'Escape') return;
    if (menu) { closeMenu(); e.preventDefault(); e.stopImmediatePropagation(); return; }
    e.preventDefault();
    e.stopImmediatePropagation();
    L.inspect.stop();
    inspectStop();
    send('INSPECT_EXITED');
  }

  function patternLabel(id) {
    const d = L.inspect.catalog().find((x) => x.id === id);
    return d ? d.label : id;
  }

  function openMenu(x, y, nodeId, ready, results) {
    closeMenu();
    if (!shadow) return;
    hoverId = null; schedule();
    menuNodeId = nodeId;
    const detected = Array.isArray(results) ? results : [];
    picks = ready && detected.length ? detected.map((r) => r.pattern) : ['text'];
    menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', 'Choose patterns');
    menu.addEventListener('click', (e) => e.stopPropagation());
    menu.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
    menu.addEventListener('keydown', onMenuKey);
    renderPicker();
    shadow.append(menu);
    const r = menu.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
    menu.style.left = `${Math.max(6, Math.min(x, vw - r.width - 6))}px`;
    menu.style.top = `${Math.max(6, Math.min(y, vh - r.height - 6))}px`;
    const first = menu.querySelector('input, button:not(:disabled)');
    if (first) first.focus({ preventScroll: true });
  }

  function renderPicker() {
    if (!menu) return;
    menu.replaceChildren();
    const head = document.createElement('div');
    head.className = 'mh'; head.textContent = 'Choose patterns';
    menu.append(head);
    const boxes = new Map();
    for (const def of L.inspect.catalog()) {
      const lab = document.createElement('label');
      lab.className = 'mcheck';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = def.id; cb.checked = picks.includes(def.id);
      const text = document.createElement('span');
      const b = document.createElement('b'); b.textContent = def.label;
      const why = document.createElement('span'); why.textContent = 'Scoped to the selected region';
      text.append(b, why);
      lab.append(cb, text);
      cb.addEventListener('change', () => {
        if (cb.checked) {
          if (def.id !== 'text') picks = picks.filter((x) => x !== 'text');
          if (!picks.includes(def.id)) picks.push(def.id);
        } else picks = picks.filter((x) => x !== def.id);
        const t = boxes.get('text');
        if (t) t.checked = picks.includes('text');
      });
      boxes.set(def.id, cb);
      menu.append(lab);
    }
    const scopeBtn = document.createElement('button');
    scopeBtn.className = 'mback'; scopeBtn.type = 'button'; scopeBtn.textContent = 'Set as scan parent';
    scopeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        if (L.scan && typeof L.scan.setScope === 'function') {
          L.scan.setScope(menuNodeId);
        }
        closeMenu();
        send('NODE_SELECTED', L.inspect.select ? L.inspect.select(menuNodeId) : { selectedId: menuNodeId });
      } catch (_) { closeMenu(); }
    });
    menu.append(scopeBtn);

    const detect = document.createElement('button');
    detect.className = 'mdetect'; detect.type = 'button'; detect.textContent = 'Detect selected';
    detect.disabled = !picks.length;
    detect.addEventListener('click', (e) => {
      e.stopPropagation();
        if (!picks.length) return;
        try {
          const res = L.inspect.detectPatterns(menuNodeId, picks.slice(), { scoped: true });
          selectedId = menuNodeId; hoverId = null; schedule();
          send('NODE_SELECTED', res);
          send('PATTERNS_DETECTED', res);
          if ((res.results || []).length === 1) showResult(res);
          else closeMenu();
        } catch (err) {
        closeMenu();
        send('PATTERN_ERROR', { error: String((err && err.message) || err) });
      }
    });
    menu.append(detect);
    const foot = document.createElement('div');
    foot.className = 'mf'; foot.textContent = 'Text is the default · Esc closes';
    menu.append(foot);
  }

  function showResult(res) {
    if (!menu) return;
    menu.replaceChildren();
    const item = (res.results || [])[0];
    const head = document.createElement('div');
    head.className = 'mh'; head.textContent = 'Result';
    const box = document.createElement('div');
    box.className = 'mr';
    const b = document.createElement('b');
    b.textContent = item && item.label ? item.label : patternLabel(item && item.pattern);
    const sub = document.createElement('span');
    sub.textContent = item && item.ok
      ? (item.result ? L.inspect.summary(item.result) : item.summary || '')
      : (item && item.reason ? item.reason : 'No result');
    if (item && !item.ok) sub.className = 'mwhy';
    box.append(b, sub);
    menu.append(head, box);
    if (item && item.ok) {
      const sendBtn = document.createElement('button');
      sendBtn.className = 'msend'; sendBtn.type = 'button'; sendBtn.textContent = 'Send to Output';
      sendBtn.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); send('SHOW_OUTPUT'); });
      menu.append(sendBtn);
    }
    const back = document.createElement('button');
    back.className = 'mback'; back.type = 'button'; back.textContent = 'Choose patterns again';
    back.addEventListener('click', (e) => { e.stopPropagation(); picks = []; renderPicker(); });
    menu.append(back);
    const foot = document.createElement('div');
    foot.className = 'mf'; foot.textContent = 'Nothing is sent until you choose Send to Output.';
    menu.append(foot);
    const first = menu.querySelector('button:not(:disabled)');
    if (first) first.focus({ preventScroll: true });
  }

  function closeMenu() {
    if (menu) { menu.remove(); menu = null; }
    menuNodeId = null;
    picks = [];
  }

  function onMenuKey(e) {
    if (!menu) return;
    if (e.target && e.target.tagName === 'INPUT') return;
    const items = [...menu.querySelectorAll('button:not(:disabled)')];
    if (!items.length) return;
    const active = (shadow && shadow.activeElement) || document.activeElement;
    const i = items.indexOf(active);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1 + items.length) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (items[i] || items[0]).click(); }
  }

  function inspectStart() {
    ensure();
    inspectActive = true;
    selectedId = L.inspect.selectedId();
    hoverId = null; closeMenu(); schedule();
  }

  function inspectSelect(id, scroll) {
    if (!inspectActive) return;
    closeMenu();
    selectedId = id; hoverId = null;
    const snap = L.inspect && L.inspect.snapshot();
    if (scroll && snap && snap.nodes[id]) snap.nodes[id].el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    schedule();
  }

  function inspectStop() {
    inspectActive = false; selectedId = null; hoverId = null;
    closeMenu();
    destroy();
  }

  function destroy() {
    closeMenu();
    try { unbind(); } catch (_) {}
    if (host) host.remove();
    host = shadow = null;
    inspectActive = false; selectedId = null; hoverId = null;
  }

  L.overlay = { inspectStart, inspectSelect, inspectStop, destroy };
})();
