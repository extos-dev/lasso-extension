/* Output formats: json, csv, markdown (+ token estimate). New formats: L.registerFormat(id, {...}). */
(() => {
  const L = globalThis.Lasso, u = L.util;
  const INLINE = new Set(['A','SPAN','STRONG','B','EM','I','CODE','SMALL','MARK','U','SUB','SUP','TIME','ABBR','LABEL','FONT','S','DEL','INS','Q','CITE','KBD','BR','IMG','PICTURE']);
  const DROP = new Set(['BUTTON', 'FORM', 'SELECT', 'INPUT', 'TEXTAREA', 'NAV', 'ASIDE', 'SVG', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO']);
  const esc = (s) => s.replace(/([\\`*\[\]])/g, '\\$1');
  const codeSpan = (s) => {
    const t = String(s).replace(/\s+/g, ' ').trim();
    const runs = t.match(/`+/g) || [];
    const fence = '`'.repeat(Math.max(1, ...runs.map((r) => r.length + 1)));
    const pad = /^`|`$/.test(t) ? ' ' : '';
    return fence + pad + t + pad + fence;
  };
  const fenceLang = (n) => {
    const code = n.el && n.el.querySelector ? n.el.querySelector('code') : null;
    const cls = (code && code.getAttribute('class')) || '';
    const m = cls.match(/(?:language|lang)-([\w-]+)/);
    const raw = (m && m[1]) || (code && (code.getAttribute('data-language') || code.getAttribute('data-lang'))) || '';
    return String(raw).replace(/[^\w-]/g, '').slice(0, 32);
  };
  const fence = (text) => '`'.repeat(Math.max(3, ...(text.match(/`+/g) || []).map((r) => r.length + 1)));

  const allows = (n, ctx) => n.bp < .8 || !!(ctx && n.bp === ctx.bp && (n.id === ctx.rootId || n.bpOwn < .85));

  function inlineMd(snap, n, ctx = null) {
    if (!allows(n, ctx) || DROP.has(n.tag)) return '';
    const kids = () => n.parts.map((p) => (typeof p === 'string' ? esc(p) : inlineMd(snap, snap.nodes[p], ctx))).join('');
    switch (n.tag) {
      case 'BR': return '  \n';
      case 'IMG': { const src = u.imageSrc(n.el); return src ? `![${(n.el.getAttribute('alt') || '').replace(/[\[\]]/g, '')}](${src})` : ''; }
      case 'A': { const t = kids().trim(), href = n.el.href || n.el.getAttribute('href') || ''; return t && href && !/^javascript:/i.test(href) ? `[${t}](${href})` : t; }
      case 'STRONG': case 'B': { const t = kids().trim(); return t ? `**${t}**` : ''; }
      case 'EM': case 'I': { const t = kids().trim(); return t ? `*${t}*` : ''; }
      case 'CODE': case 'KBD': return codeSpan(L.textOf(snap, n.id));
      default: return kids();
    }
  }

  function blockMd(snap, n, out, listDepth = 0, ctx = null) {
    if (!allows(n, ctx) || DROP.has(n.tag)) return;
    const push = (s) => { s = s.replace(/[ \t]+\n/g, '\n').trim(); if (s) out.push(s); };
    const pushRaw = (s) => { s = s.replace(/[ \t]+\n/g, '\n').replace(/\s+$/, ''); if (s.trim()) out.push(s); };
    const tag = n.tag;
    if (/^H[1-6]$/.test(tag)) return push('#'.repeat(+tag[1]) + ' ' + inlineMd(snap, { ...n, tag: 'SPAN' }, ctx).trim());
    if (tag === 'P' || tag === 'FIGCAPTION') return push(inlineMd(snap, { ...n, tag: 'SPAN' }, ctx));
    if (tag === 'PRE') {
      const raw = L.rawTextOf ? L.rawTextOf(snap, n.id, { skipAriaHidden: true }) : L.textOf(snap, n.id);
      const text = (raw || L.textOf(snap, n.id)).replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
      const f = fence(text);
      return push(f + fenceLang(n) + '\n' + text + '\n' + f);
    }
    if (tag === 'HR') return push('---');
    if (tag === 'BLOCKQUOTE') { const sub = []; for (const c of n.children) blockMd(snap, snap.nodes[c], sub, listDepth, ctx); if (!n.children.length) sub.push(inlineMd(snap, { ...n, tag: 'SPAN' }, ctx)); return push(sub.join('\n\n').split('\n').map((l) => '> ' + l).join('\n')); }
    if (tag === 'UL' || tag === 'OL') {
      let i = 0;
      for (const c of n.children) {
        const li = snap.nodes[c]; if (li.tag !== 'LI' || !allows(li, ctx)) continue;
        const sub = []; blockMd(snap, { ...li, tag: 'DIV' }, sub, listDepth + 1, ctx);
        if (!sub.length) continue;
        const bullet = tag === 'OL' ? `${++i}. ` : '- ';
        const lines = sub.join('\n').split('\n');
        const head = lines.shift();
        const prefix = '  '.repeat(listDepth);
        const first = head && !/^\s*(?:[-*]|\d+\.)\s/.test(head) ? prefix + bullet + head : prefix + bullet.trimEnd();
        pushRaw([first, ...lines].join('\n'));
      }
      return;
    }
    if (tag === 'TABLE' || n.role === 'grid') { const t = L.extractTable(snap, n); return push(mdTable(t.headers, t.rows)); }
    // generic container: group consecutive inline content into paragraphs
    let buf = '';
    const flush = () => { push(buf); buf = ''; };
    for (const p of n.parts) {
      if (typeof p === 'string') { buf += esc(p); continue; }
      const c = snap.nodes[p];
      if (INLINE.has(c.tag)) {
        const piece = inlineMd(snap, c, ctx);
        if (c.tag === 'A' && buf && !/\s$/.test(buf) && /^\[/.test(piece)) buf += ' ';
        buf += piece;
      } else { flush(); blockMd(snap, c, out, listDepth, ctx); }
    }
    flush();
  }

  function mdTable(headers, rows) {
    const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const h = headers.length ? headers : (rows[0] || []).map((_, i) => `Column ${i + 1}`);
    return ['| ' + h.map(cell).join(' | ') + ' |', '| ' + h.map(() => '---').join(' | ') + ' |', ...rows.map((r) => '| ' + h.map((_, i) => cell(r[i] ?? '')).join(' | ') + ' |')].join('\n');
  }

  function toMarkdown(snap, id) {
    const out = [], n = snap.nodes[id];
    const ctx = n && n.bp >= .8 ? { bp: n.bp, rootId: n.id } : null;
    blockMd(snap, n, out, 0, ctx);
    return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  L.toMarkdown = toMarkdown;

  const formulaRisk = (s) => { const t = s.replace(/^\s+/, ''); return /^[=@\t\r]|^\+.*[+*/^&]|^\+[A-Za-z(]|^-.*[+*/^&]|^-[A-Za-z(\s]/.test(t); };
  const csvCell = (v) => { let s = v == null ? '' : String(v); if (formulaRisk(s)) s = "'" + s; return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const toCsv = (headers, rows) => [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  L.toCsv = toCsv;
  const tokens = (s) => Math.ceil(s.length / 4);

  /** Modular Field Transforms for cleaning data strings. */
  const TRANSFORMS = {
    trim: (v) => (v == null ? '' : String(v).trim()),
    strip_tags: (v) => (v == null ? '' : String(v).replace(/<[^>]*>/g, '')),
    currency: (v) => {
      if (v == null) return '';
      // Correctly parses '1,234.56' -> 1234.56
      const m = String(v).match(/[\d,]+\.?\d*/);
      return m ? parseFloat(m[0].replace(/,/g, '')) : '';
    },
    date: (v) => {
      if (!v) return '';
      const d = new Date(v);
      return isNaN(d.getTime()) ? String(v) : d.toISOString().split('T')[0];
    },
    uppercase: (v) => (v == null ? '' : String(v).toUpperCase()),
    lowercase: (v) => (v == null ? '' : String(v).toLowerCase()),
  };

  function applyFieldTransforms(val, transforms) {
    if (!Array.isArray(transforms) || !transforms.length) return val;
    let res = val;
    for (const t of transforms) {
      if (typeof t === 'function') res = t(res);
      else if (typeof t === 'string' && TRANSFORMS[t]) res = TRANSFORMS[t](res);
      else if (t && typeof t === 'object' && t.type === 'regex_replace') {
        // Enforce max pattern length (100) to prevent ReDoS / hostile expressions
        if (typeof t.pattern === 'string' && t.pattern.length <= 100) {
          try {
            const re = new RegExp(t.pattern, 'g');
            res = String(res || '').replace(re, String(t.replacement || '').slice(0, 100));
          } catch (_) {}
        }
      }
    }
    return res;
  }
  L.applyFieldTransforms = applyFieldTransforms;
  L.fieldTransforms = TRANSFORMS;

  /** Structured data for a region (shared by all formats). */
  function dataFor(an, region) {
    const { snap } = an, n = snap.nodes[region.nodeId];
    if (region.kind === 'article') {
      const h = region.hints, body = toMarkdown(snap, n.id);
      return { kind: 'article', url: snap.url, title: h.title, author: h.author, publishedAt: h.publishedAt, image: h.image, headings: h.headings, wordCount: h.wordCount, markdown: body };
    }
    if (region.kind === 'table') { const t = L.extractTable(snap, n); return { kind: 'table', url: snap.url, headers: t.headers, rows: t.rows }; }
    const items = region.itemIds.map((id) => L.extractRecordItem(snap, id));
    return { kind: 'record_list', url: snap.url, flavor: region.hints.flavor, count: items.length, items };
  }
  L.regionData = dataFor;

  /** Structured data for an inspect result (point-selected + pattern). */
  function dataForInspect(result) {
    const snap = L.inspect.snapshot(), n = snap.nodes[result.nodeId];
    if (!n) throw new Error('The selected element is no longer in the page snapshot');
    if (result.kind === 'article') {
      const h = L.articleHints(snap, n, { scoped: true }), body = toMarkdown(snap, n.id);
      return { kind: 'article', url: snap.url, title: h.title, author: h.author, publishedAt: h.publishedAt, image: h.image, headings: h.headings, wordCount: h.wordCount, markdown: body };
    }
    if (result.kind === 'table') { const t = L.extractTable(snap, n); return { kind: 'table', url: snap.url, headers: t.headers, rows: t.rows }; }
    if (result.kind === 'record_list') {
      const items = result.itemIds.map((id) => L.extractRecordItem(snap, id));
      return { kind: 'record_list', url: snap.url, flavor: result.flavor, count: items.length, items };
    }
    if (result.kind === 'chat') {
      return { kind: 'chat', url: snap.url, count: result.count, messages: result.messages };
    }
    if (result.kind === 'contact') {
      return { kind: 'contact', url: snap.url, name: result.name, emails: result.emails, phones: result.phones, addresses: result.addresses, links: result.links, text: result.text };
    }
    return { kind: 'text', url: snap.url, label: result.label, text: L.textOf(snap, n.id) };
  }

  L.registerFormat('json', { label: 'JSON', mime: 'application/json', ext: 'json', render: (d) => JSON.stringify(d, null, 2) });
  L.registerFormat('csv', {
    label: 'CSV', mime: 'text/csv', ext: 'csv',
    render(d) {
      if (d.kind === 'table') return toCsv(d.headers, d.rows);
      if (d.kind === 'record_list') {
        const pref = ['title', 'url', 'price', 'date', 'image', 'snippet', 'text'], seen = new Set(d.items.flatMap((i) => Object.keys(i)));
        const cols = [...pref.filter((c) => seen.has(c)), ...[...seen].filter((c) => !pref.includes(c))];
        return toCsv(cols, d.items.map((i) => cols.map((c) => i[c] ?? '')));
      }
      if (d.kind === 'chat') return toCsv(['role', 'text'], d.messages.map((m) => [m.role, m.text]));
      if (d.kind === 'contact') return toCsv(['name', 'emails', 'phones', 'addresses', 'links', 'text'], [[
        d.name || '', d.emails.join('; '), d.phones.join('; '), d.addresses.join('; '), d.links.map((l) => l.url).join('; '), d.text,
      ]]);
      if (d.kind === 'text') return toCsv(['text'], [[d.text]]);
      return toCsv(['title', 'author', 'publishedAt', 'url', 'wordCount', 'markdown'], [[d.title, d.author, d.publishedAt, d.url, d.wordCount, d.markdown]]);
    },
  });
  L.registerFormat('markdown', {
    label: 'Markdown', mime: 'text/markdown', ext: 'md',
    render(d) {
      if (d.kind === 'text') return d.text;
      if (d.kind === 'chat') return d.messages.map((m) => `**${m.role}:**\n\n${m.text}`).join('\n\n');
      if (d.kind === 'contact') {
        const lines = [];
        if (d.name) lines.push(`# ${d.name}`);
        if (d.emails.length) lines.push(d.emails.join(' · '));
        if (d.phones.length) lines.push(d.phones.join(' · '));
        for (const a of d.addresses) lines.push(a);
        const links = d.links.filter((l) => !/^mailto:|^tel:/i.test(l.url));
        if (links.length) lines.push(links.map((l) => `[${l.text || l.url}](${l.url})`).join(' · '));
        if (d.text) lines.push(d.text);
        return lines.join('\n\n');
      }
      if (d.kind === 'table') return mdTable(d.headers, d.rows);
      if (d.kind === 'record_list') {
        const cols = ['title', 'price', 'date', 'url'].filter((c) => d.items.some((i) => i[c]));
        return cols.length ? mdTable(cols, d.items.map((i) => cols.map((c) => i[c] || ''))) : d.items.map((i) => '- ' + (i.text || i.snippet || '')).join('\n');
      }
      const md = d.markdown, meta = [d.author, d.publishedAt].filter(Boolean).filter((x) => !md.includes(x) && !(x === d.publishedAt && u.DATE_RE.test(md.slice(0, 600))));
      const metaLine = meta.length ? `*${meta.join(' · ')}*` : '';
      if (/^#\s/.test(md)) { const i = md.indexOf('\n\n'); return metaLine && i > 0 ? md.slice(0, i) + '\n\n' + metaLine + md.slice(i) : md; }
      return (d.title ? `# ${d.title}\n\n` : '') + (metaLine ? metaLine + '\n\n' : '') + md;
    },
  });

  L.output = {
    render(regionId, formatId) {
      const an = L.last; if (!an) throw new Error('No analysis yet');
      const region = an.byId.get(regionId), fmt = L.formats[formatId];
      if (!region) throw new Error('Unknown region ' + regionId);
      if (!fmt) throw new Error('Unknown format ' + formatId);
      const text = fmt.render(dataFor(an, region));
      const host = (an.light.hostname || 'page').replace(/[^\w.-]+/g, '_');
      return { text, mime: fmt.mime, filename: `${host}-${region.kind}.${fmt.ext}`, chars: text.length, tokenEstimate: tokens(text), tokenEstimateNote: 'estimate (chars/4)' };
    },
    renderInspectResult(result, formatId) {
      const snap = L.inspect.snapshot();
      if (!result || !snap) throw new Error('No inspect result yet');
      const fmt = L.formats[formatId];
      if (!fmt) throw new Error('Unknown format ' + formatId);
      const data = dataForInspect(result);
      const text = fmt.render(data);
      let host = 'page';
      try { host = new URL(snap.url).hostname; } catch (_) {}
      host = host.replace(/[^\w.-]+/g, '_') || 'page';
      return { text, mime: fmt.mime, filename: `${host}-${result.pattern}.${fmt.ext}`, chars: text.length, tokenEstimate: tokens(text), tokenEstimateNote: 'estimate (chars/4)', data, kind: data.kind };
    },
    renderInspect(formatId) {
      return this.renderInspectResult(L.inspect.lastResult(), formatId);
    },
    renderInspectResults(formatId, provided) {
      const results = Array.isArray(provided) ? provided : (L.inspect.detectedResults ? L.inspect.detectedResults() : []);
      if (!results.length) return { items: [] };
      if (!L.formats[formatId]) throw new Error('Unknown format ' + formatId);
      return {
        items: results.map((item) => {
          if (!item.ok) return { pattern: item.pattern, label: item.label, summary: item.summary, ok: false, reason: item.reason, rendered: null, kind: item.kind };
          try {
            const rendered = this.renderInspectResult(item.result, formatId);
            return {
              pattern: item.pattern, label: item.label, summary: item.summary, ok: true, reason: item.reason,
              rendered,
              kind: rendered.kind || item.kind,
            };
          } catch (e) {
            return { pattern: item.pattern, label: item.label, summary: item.summary, ok: false, reason: e.message, rendered: null };
          }
        }),
      };
    },
    formats: () => Object.entries(L.formats).map(([id, f]) => ({ id, label: f.label })),
  };
})();
