/* Lasso engine — namespace, registries and shared utilities.
 * Content files are CLASSIC scripts (not ES modules) injected in filename order
 * by the extension (scripting API). Each file attaches itself to globalThis.Lasso.
 * Re-injection is safe: the namespace is rebuilt and the old overlay is destroyed. */
(() => {
  const VERSION = '0.2.0';
  try { globalThis.Lasso && globalThis.Lasso.overlay && globalThis.Lasso.overlay.destroy(); } catch (_) {}
  const L = (globalThis.Lasso = { version: VERSION, detectors: [], formats: {}, util: {}, last: null });

  /** Extension point: add a detector. {id, kinds, detect(ctx) -> Candidate[]} */
  L.registerDetector = (d) => {
    L.detectors = L.detectors.filter((x) => x.id !== d.id);
    L.detectors.push(d);
  };
  /** Extension point: add an output format. {id, label, mime, ext, render(ctx) -> string|null} */
  L.registerFormat = (id, fmt) => { L.formats[id] = fmt; };

  const u = L.util;
  u.collapse = (s) => s.replace(/\s+/g, ' ');
  u.clamp = (n, a = 0, b = 1) => Math.min(b, Math.max(a, n));
  u.round2 = (n) => Math.round(n * 100) / 100;
  u.sig = (signal, weight, value, note) => ({ signal, weight, value: u.round2(value), note });

  /** Class/id token "pieces": 'cookie-banner' -> ['cookie-banner','cookie','banner'] (whole-token matching). */
  u.pieces = (str) => {
    const out = [];
    for (const t of String(str || '').toLowerCase().split(/\s+/)) {
      if (!t) continue;
      out.push(t);
      for (const p of t.split(/[-_:.]+/)) if (p && p !== t) out.push(p);
    }
    return out;
  };

  /** Hashed / generated class names (CSS-in-JS, CSS modules) are unstable: never fingerprint on them. */
  u.isHashy = (t) =>
    /^(css|sc|jsx|emotion|styled|svelte|astro|chakra|mui|makeStyles)-/i.test(t) ||
    /^_/.test(t) ||
    (/\d/.test(t) && /[a-z]/i.test(t) && t.length >= 8 && /^[a-z0-9]+$/i.test(t) && (t.match(/\d/g) || []).length >= 2) ||
    /^[a-z]{1,3}[A-Z][A-Za-z0-9]{4,}$/.test(t) ||
    /(?=(?:[0-9a-f]*\d){2})[0-9a-f]{6,}/i.test(t);

  u.stableTokens = (cls) =>
    String(cls || '').split(/\s+/).filter((t) => t && !u.isHashy(t)).map((t) => t.toLowerCase().replace(/\d+/g, '#')).sort();

  u.PRICE_RE = /[$€£¥]\s?\d[\d.,]*|(?<![\w.,])\d[\d.,]*\s?(?:[$€£¥](?!\s?\d)|(?:USD|EUR|GBP|MAD|DH|dhs?)\b)/i;
  u.DATE_RE = /\b\d{4}-\d{2}-\d{2}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b|\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}\b/i;

  u.now = () => (globalThis.performance && typeof globalThis.performance.now === 'function' ? globalThis.performance.now() : Date.now());

  /** Resolve an image's real source, preferring lazy-load attributes over placeholders. */
  u.imageSrc = (img) => {
    if (!img) return '';
    const attr = (name) => img.getAttribute(name) || '';
    const srcsetFirst = (v) => (String(v || '').trim().split(/\s+/)[0] || '');
    const direct = img.currentSrc || attr('src');
    const lazy = attr('data-src') || attr('data-original') || attr('data-lazy-src') || attr('data-url') ||
      srcsetFirst(attr('data-srcset')) || srcsetFirst(attr('srcset'));
    const placeholder = !direct || /^data:/i.test(direct) || /(?:^|\/)(?:spacer|blank|transparent|pixel|placeholder)(?:[.\-_]|$)/i.test(direct);
    let src = placeholder && lazy ? lazy : (direct || lazy);
    if (!src || /^data:/i.test(src)) return '';
    try { return new URL(src, img.baseURI || document.baseURI).href; } catch (_) { return src; }
  };

  /** Yield to the event loop so long pipelines never block the page for >~50 ms. */
  u.yieldToMain = () =>
    new Promise((res) => {
      if (globalThis.scheduler && typeof globalThis.scheduler.yield === 'function') globalThis.scheduler.yield().then(res);
      else setTimeout(res, 0);
    });
})();
