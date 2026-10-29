/* 55-schema.js — Schema Validation, URL Matcher & Replay Runner
 * Hand-written shape validator, size capper, URL pattern matcher/ranker,
 * and execution engine that runs saved extraction schemas and computes health diagnostics.
 * Classic-script layer 3: depends on 00-namespace, 45-locator, and inspect/output modules.
 */
(() => {
  const L = globalThis.Lasso;

  /** Escape metacharacters for glob path pattern matching safely without arbitrary regex evaluation. */
  function globToRegExp(pattern) {
    if (typeof pattern !== 'string') return null;
    const capped = pattern.slice(0, 200);
    // Escape all special regex characters, converting glob '*' to '.*' and ':param' to '[^/]+'
    let escaped = '';
    for (let i = 0; i < capped.length; i++) {
      const c = capped[i];
      if (c === '*') {
        escaped += '.*';
      } else if (c === ':' && /[a-zA-Z0-9_-]/.test(capped[i + 1] || '')) {
        escaped += '[^/]+';
        while (i + 1 < capped.length && /[a-zA-Z0-9_-]/.test(capped[i + 1])) i++;
      } else if ('[].+?^${}()|\\'.includes(c)) {
        escaped += '\\' + c;
      } else {
        escaped += c;
      }
    }
    try {
      return new RegExp('^' + escaped + '$');
    } catch {
      return null;
    }
  }

  /** Hand-written schema validator with strict shape and size caps. */
  function validateSchema(s) {
    if (!s || typeof s !== 'object') return { valid: false, reason: 'Schema must be an object' };
    if (s.schemaVersion !== 1) return { valid: false, reason: 'Unsupported schemaVersion: ' + s.schemaVersion };
    if (typeof s.id !== 'string' || !s.id || s.id.length > 100) return { valid: false, reason: 'Schema missing string id <= 100 chars' };
    if (typeof s.name !== 'string' || !s.name || s.name.length > 120) return { valid: false, reason: 'Schema name must be a string <= 120 chars' };
    if (!s.match || typeof s.match !== 'object') return { valid: false, reason: 'Schema missing match object' };
    if (s.match.domain && (typeof s.match.domain !== 'string' || s.match.domain.length > 120)) return { valid: false, reason: 'Match domain must be a string <= 120 chars' };
    if (s.match.pathPattern && (typeof s.match.pathPattern !== 'string' || s.match.pathPattern.length > 200)) return { valid: false, reason: 'Match pathPattern must be a string <= 200 chars' };
    if (typeof s.kind !== 'string' || !['article', 'table', 'record_list', 'chat', 'contact', 'text'].includes(s.kind)) return { valid: false, reason: 'Invalid or missing kind: ' + s.kind };
    if (!s.container || typeof s.container !== 'object') return { valid: false, reason: 'Schema missing container locator' };
    if (s.fields && (!Array.isArray(s.fields) || s.fields.some((f) => !f || typeof f.name !== 'string' || f.name.length > 60))) {
      return { valid: false, reason: 'Fields must be an array of objects with string names <= 60 chars' };
    }
    return { valid: true };
  }

  /**
   * Matches and ranks schemas against a target URL.
   * Ranking score: exact path pattern > wildcard path > domain match.
   */
  function matchSchemaUrl(schema, targetUrl) {
    if (!schema || !schema.match || !targetUrl) return { matches: false, score: 0 };
    let u;
    try { u = new URL(targetUrl); } catch { return { matches: false, score: 0 }; }

    if (schema.match.domain && schema.match.domain !== u.hostname) {
      return { matches: false, score: 0 };
    }

    let score = 1; // domain match
    if (schema.match.pathPattern) {
      const re = globToRegExp(schema.match.pathPattern);
      if (!re || !re.test(u.pathname)) return { matches: false, score: 0 };
      score = schema.match.pathPattern.includes('*') || schema.match.pathPattern.includes(':') ? 2 : 3;
    }

    return { matches: true, score };
  }

  /**
   * Replays a saved schema against a page snapshot by resolving locators directly.
   * Does NOT call detector re-detection.
   * Calculates spec §8 health: required-field coverage, primary vs fallback resolution, item-count drift >20%.
   */
  function runSchema(snap, schema) {
    const val = validateSchema(schema);
    if (!val.valid) return { ok: false, health: 'broken', reason: 'Invalid schema: ' + val.reason };

    // Resolve container element directly
    const resolvedContainer = L.locator ? L.locator.resolve(snap, schema.container) : { matched: false };
    if (!resolvedContainer.matched || resolvedContainer.nodeId === null) {
      return { ok: false, health: 'broken', reason: 'Container element not found by locator strategies' };
    }

    const containerNode = snap.nodes[resolvedContainer.nodeId];
    let health = resolvedContainer.health || 'healthy';
    let data = null;
    const fieldDiagnostics = {};

    if (schema.kind === 'article') {
      const hints = L.articleHints ? L.articleHints(snap, containerNode, { scoped: true }) : {};
      const markdown = L.toMarkdown ? L.toMarkdown(snap, containerNode.id) : '';
      data = {
        kind: 'article',
        url: snap.url,
        title: hints.title || '',
        author: hints.author || '',
        publishedAt: hints.publishedAt || '',
        image: hints.image || '',
        headings: hints.headings || [],
        wordCount: containerNode.stats.wordCount,
        markdown,
      };
    } else if (schema.kind === 'table') {
      const t = L.extractTable ? L.extractTable(snap, containerNode) : { headers: [], rows: [] };
      data = { kind: 'table', url: snap.url, headers: t.headers, rows: t.rows };
    } else if (schema.kind === 'record_list') {
      let itemNodes = [];
      if (schema.item && schema.item.strategies) {
        // Resolve item container or candidates
        const resolvedItem = L.locator.resolve(snap, schema.item);
        if (resolvedItem.matched && resolvedItem.nodeId !== null) {
          itemNodes = [resolvedItem.nodeId];
        }
      }
      if (!itemNodes.length) {
        // Fall back to mining immediate element children of resolved container
        itemNodes = containerNode.children.filter((cid) => snap.nodes[cid].stats.textLength > 5);
      }

      const items = itemNodes.map((cid) => L.extractRecordItem(snap, cid));
      data = { kind: 'record_list', url: snap.url, flavor: schema.flavor || 'generic', count: items.length, items };

      // Check item count drift if baseline was saved
      if (typeof schema.baselineCount === 'number' && schema.baselineCount > 0) {
        const drift = Math.abs(items.length - schema.baselineCount) / schema.baselineCount;
        if (drift > 0.20 && health === 'healthy') {
          health = 'degraded';
        }
      }
    } else if (schema.kind === 'text') {
      const text = L.textOf ? L.textOf(snap, containerNode.id) : '';
      data = { kind: 'text', url: snap.url, label: schema.name, text };
    } else if (schema.kind === 'chat') {
      const res = L.inspect.getPattern('chat').detect(containerNode.id);
      data = res.ok ? L.inspect.getPattern('chat').build(res, containerNode.id) : { kind: 'chat', count: 0, messages: [] };
    } else if (schema.kind === 'contact') {
      const res = L.inspect.getPattern('contact').detect(containerNode.id);
      data = res.ok ? L.inspect.getPattern('contact').build(res, containerNode.id) : { kind: 'contact', name: '', emails: [], phones: [], addresses: [], links: [] };
    }

    // Apply saved fields & transforms
    if (schema.fields && Array.isArray(schema.fields) && schema.fields.length && data) {
      let requiredMissing = false;
      for (const fieldDef of schema.fields) {
        let rawVal = data[fieldDef.name];
        let fieldHealth = 'healthy';

        if (rawVal === undefined && fieldDef.locators) {
          const resolvedField = L.locator.resolve(snap, fieldDef.locators);
          if (resolvedField.matched) {
            rawVal = L.textOf(snap, resolvedField.nodeId);
            if (resolvedField.health === 'degraded') fieldHealth = 'degraded';
          }
        }

        if (rawVal !== undefined && fieldDef.transforms) {
          rawVal = L.applyFieldTransforms(rawVal, fieldDef.transforms);
          data[fieldDef.name] = rawVal;
        }

        const isMissing = rawVal === undefined || rawVal === null || rawVal === '';
        if (isMissing && fieldDef.required) {
          requiredMissing = true;
          fieldHealth = 'broken';
        }

        fieldDiagnostics[fieldDef.name] = {
          resolved: !isMissing,
          required: !!fieldDef.required,
          health: fieldHealth,
        };
      }

      if (requiredMissing) {
        health = 'broken';
      }
    }

    return {
      ok: health !== 'broken',
      health,
      data,
      diagnostics: {
        containerResolved: resolvedContainer,
        fields: fieldDiagnostics,
        kind: schema.kind,
      },
      reason: health === 'healthy' ? 'Schema executed cleanly' : health === 'degraded' ? 'Schema executed with degraded locator fallbacks or item drift' : 'Schema execution broken: required fields or container missing',
    };
  }

  /** Build a complete schema object directly from an inspect extraction result. */
  function buildSchemaFromResult(snap, nodeId, result, meta = {}) {
    const node = snap.nodes[nodeId];
    if (!node) throw new Error('Invalid node ID');
    const container = L.locator.build(snap, nodeId);
    const hostname = new URL(snap.url).hostname;
    const pathname = new URL(snap.url).pathname;

    let item = null;
    if (result.kind === 'record_list' && result.itemIds && result.itemIds.length) {
      item = L.locator.build(snap, result.itemIds[0]);
    }

    // Default fields extracted per kind
    const fields = [];
    if (result.kind === 'article') {
      fields.push({ name: 'title', required: true, transforms: ['trim'] });
      fields.push({ name: 'markdown', required: true, transforms: [] });
      fields.push({ name: 'author', required: false, transforms: ['trim'] });
    } else if (result.kind === 'table') {
      fields.push({ name: 'headers', required: true, transforms: [] });
      fields.push({ name: 'rows', required: true, transforms: [] });
    } else if (result.kind === 'record_list') {
      fields.push({ name: 'items', required: true, transforms: [] });
    } else if (result.kind === 'text') {
      fields.push({ name: 'text', required: true, transforms: ['trim'] });
    }

    const id = 'schema_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    return {
      schemaVersion: 1,
      id,
      name: meta.name || ((result.kind ? result.kind.charAt(0).toUpperCase() + result.kind.slice(1) : 'Recipe') + ' (' + hostname + ')'),
      origin: 'manual',
      match: { domain: hostname, pathPattern: pathname },
      kind: result.kind || 'text',
      container,
      item,
      fields,
      baselineCount: result.count || (result.items ? result.items.length : 0),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  L.schema = {
    validate: validateSchema,
    matchUrl: matchSchemaUrl,
    run: runSchema,
    buildSchemaFromResult,
  };
})();
