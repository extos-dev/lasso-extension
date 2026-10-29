/* Lasso engine — Replayable extraction runner on live DOM.
 * Classic-script layer 80.
 * Executes serializable extraction specifications against the live DOM using locators
 * without requiring ephemeral snapshot node IDs. */
(() => {
  const L = globalThis.Lasso, u = L.util;

  function runRecords(extraction, scopeEl, t0) {
    let itemEls = [];
    let itemConf = 1.0;

    if (extraction.item) {
      const resolvedItem = L.resolveLocator(extraction.item, scopeEl);
      itemEls = resolvedItem.elements || [];
      if (resolvedItem.confidence) itemConf = resolvedItem.confidence;
    }

    if (!itemEls.length && extraction.itemCss) {
      try {
        itemEls = Array.from(scopeEl.querySelectorAll(extraction.itemCss));
      } catch (_) {}
    }

    const rows = [];
    const fields = extraction.fields || {};
    const fieldKeys = Object.keys(fields);

    for (const itemEl of itemEls) {
      const row = {};
      for (const key of fieldKeys) {
        const fieldDef = fields[key];
        if (!fieldDef) continue;

        let val = '';
        if (fieldDef.locator) {
          const res = L.resolveLocator(fieldDef.locator, itemEl);
          if (res.el) {
            if (fieldDef.type === 'attribute' && fieldDef.attribute) {
              if (fieldDef.attribute === 'src' && res.el.tagName === 'IMG') {
                val = u.imageSrc ? u.imageSrc(res.el) : res.el.getAttribute('src') || '';
              } else {
                val = res.el.getAttribute(fieldDef.attribute) || '';
              }
              if ((fieldDef.attribute === 'href' || fieldDef.attribute === 'src') && val) {
                try { val = new URL(val, document.baseURI).href; } catch (_) {}
              }
            } else {
              val = u.collapse(res.el.textContent || '').trim();
            }
          }
        }
        row[key] = val;
      }
      rows.push(row);
    }

    const elapsedMs = u.round2((u.now ? u.now() : Date.now()) - t0);
    return {
      ok: true,
      kind: 'record_list',
      rows,
      items: rows,
      count: rows.length,
      confidence: itemConf,
      stats: { elapsedMs, itemsExtracted: rows.length },
    };
  }

  function runArticle(extraction, scopeEl, t0) {
    const h1 = scopeEl.querySelector('h1, h2, .title');
    const title = h1 ? u.collapse(h1.textContent || '').trim() : (extraction.title || '');

    // Extract text content directly without requiring snapshot
    const text = u.collapse(scopeEl.textContent || '').trim();
    const words = text ? text.split(/\s+/).length : 0;

    const elapsedMs = u.round2((u.now ? u.now() : Date.now()) - t0);
    return {
      ok: true,
      kind: 'article',
      doc: {
        title,
        text,
        wordCount: words,
      },
      title,
      text,
      wordCount: words,
      stats: { elapsedMs, wordCount: words },
    };
  }

  function runTable(extraction, scopeEl, t0) {
    let tableEl = scopeEl;
    if (tableEl.tagName !== 'TABLE') {
      tableEl = scopeEl.querySelector('table') || scopeEl;
    }

    const headers = [];
    const headerEls = tableEl.querySelectorAll('th');
    if (headerEls.length > 0) {
      for (const th of headerEls) {
        headers.push(u.collapse(th.textContent || '').trim());
      }
    }

    const rows = [];
    const rowEls = tableEl.querySelectorAll('tr');
    for (const tr of rowEls) {
      const tdEls = tr.querySelectorAll('td');
      if (!tdEls.length) {
        // Might be header row if headers array was empty
        if (!headers.length) {
          for (const th of tr.querySelectorAll('th')) {
            headers.push(u.collapse(th.textContent || '').trim());
          }
        }
        continue;
      }
      const row = [];
      for (const td of tdEls) {
        row.push(u.collapse(td.textContent || '').trim());
      }
      rows.push(row);
    }

    const elapsedMs = u.round2((u.now ? u.now() : Date.now()) - t0);
    return {
      ok: true,
      kind: 'table',
      headers,
      rows,
      cols: headers.length || (rows[0] ? rows[0].length : 0),
      stats: { elapsedMs, rowsCount: rows.length },
    };
  }

  function runChat(extraction, scopeEl, t0) {
    let itemEls = [];
    if (extraction.item) {
      itemEls = L.resolveLocator(extraction.item, scopeEl).elements || [];
    }
    if (!itemEls.length && extraction.itemCss) {
      try { itemEls = Array.from(scopeEl.querySelectorAll(extraction.itemCss)); } catch (_) {}
    }
    if (!itemEls.length) {
      itemEls = Array.from(scopeEl.querySelectorAll('[data-message-author-role], .message, .msg, div[class*="message"]'));
    }

    const messages = [];
    for (const el of itemEls) {
      const role = el.getAttribute('data-message-author-role') ||
        (el.className && el.className.includes('user') ? 'user' : 'assistant');
      const text = u.collapse(el.textContent || '').trim();
      messages.push({ role, text });
    }

    const elapsedMs = u.round2((u.now ? u.now() : Date.now()) - t0);
    return {
      ok: true,
      kind: 'chat',
      messages,
      count: messages.length,
      stats: { elapsedMs, count: messages.length },
    };
  }

  function runContact(extraction, scopeEl, t0) {
    const emails = new Set();
    const phones = new Set();
    const addresses = [];
    const links = [];

    const mailLinks = scopeEl.querySelectorAll('a[href^="mailto:"]');
    for (const a of mailLinks) {
      const mail = a.getAttribute('href').replace(/^mailto:/i, '').split('?')[0].trim();
      if (mail) emails.add(mail);
    }

    const telLinks = scopeEl.querySelectorAll('a[href^="tel:"]');
    for (const a of telLinks) {
      const tel = a.getAttribute('href').replace(/^tel:/i, '').trim();
      if (tel) phones.add(tel);
    }

    const addrEls = scopeEl.querySelectorAll('address');
    for (const addr of addrEls) {
      const txt = u.collapse(addr.textContent || '').trim();
      if (txt) addresses.push(txt);
    }

    const h = scopeEl.querySelector('h1, h2, h3, h4, .name');
    const name = h ? u.collapse(h.textContent || '').trim() : '';

    const elapsedMs = u.round2((u.now ? u.now() : Date.now()) - t0);
    return {
      ok: true,
      kind: 'contact',
      name,
      emails: Array.from(emails),
      phones: Array.from(phones),
      addresses,
      links,
      stats: { elapsedMs },
    };
  }

  function runText(extraction, scopeEl, t0) {
    const text = u.collapse(scopeEl.textContent || '').trim();
    const elapsedMs = u.round2((u.now ? u.now() : Date.now()) - t0);
    return {
      ok: true,
      kind: 'text',
      text,
      chars: text.length,
      stats: { elapsedMs, chars: text.length },
    };
  }

  function runExtraction(extraction, rootEl = document) {
    if (!extraction) throw new Error('Extraction specification is required');
    const t0 = u.now ? u.now() : Date.now();

    let scopeEl = rootEl;
    let scopeConfidence = 1.0;

    if (extraction.scope) {
      const scopeRes = L.resolveLocator(extraction.scope, rootEl);
      if (scopeRes.el) {
        scopeEl = scopeRes.el;
        scopeConfidence = scopeRes.confidence;
      }
    }

    const pattern = extraction.pattern || extraction.kind || 'text';
    let res;

    switch (pattern) {
      case 'records':
      case 'record_list':
      case 'list':
        res = runRecords(extraction, scopeEl, t0);
        break;
      case 'article':
        res = runArticle(extraction, scopeEl, t0);
        break;
      case 'table':
        res = runTable(extraction, scopeEl, t0);
        break;
      case 'chat':
        res = runChat(extraction, scopeEl, t0);
        break;
      case 'contact':
        res = runContact(extraction, scopeEl, t0);
        break;
      case 'text':
      default:
        res = runText(extraction, scopeEl, t0);
        break;
    }

    res.scopeConfidence = scopeConfidence;
    return res;
  }

  L.runExtraction = runExtraction;
  L.run = {
    runExtraction,
  };
})();
