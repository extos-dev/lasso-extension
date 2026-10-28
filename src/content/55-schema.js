/* 55-schema.js — Schema Validation, URL Matcher & Replay Runner
 * Hand-written shape validator, size capper, URL pattern matcher/ranker,
 * and execution engine that runs saved extraction schemas and computes health diagnostics.
 * Classic-script layer 3: depends on 00-namespace, 45-locator, and inspect/output modules.
 */
(() => {
  const L = globalThis.Lasso;

  /** Hand-written schema validator with strict shape and size caps. */
  function validateSchema(s) {
    if (!s || typeof s !== 'object') return { valid: false, reason: 'Schema must be an object' };
    if (s.schemaVersion !== 1) return { valid: false, reason: 'Unsupported schemaVersion: ' + s.schemaVersion };
    if (typeof s.id !== 'string' || !s.id) return { valid: false, reason: 'Schema missing string id' };
    if (typeof s.name !== 'string' || !s.name || s.name.length > 120) return { valid: false, reason: 'Schema name must be a string <= 120 chars' };
    if (!s.match || typeof s.match !== 'object') return { valid: false, reason: 'Schema missing match object' };
    if (s.match.domain && typeof s.match.domain !== 'string') return { valid: false, reason: 'Match domain must be a string' };
    if (s.match.pathPattern && (typeof s.match.pathPattern !== 'string' || s.match.pathPattern.length > 200)) return { valid: false, reason: 'Match pathPattern must be a string <= 200 chars' };
    if (typeof s.kind !== 'string' || !['article', 'table', 'record_list', 'chat', 'contact', 'text'].includes(s.kind)) return { valid: false, reason: 'Invalid or missing kind: ' + s.kind };
    if (!s.container || typeof s.container !== 'object') return { valid: false, reason: 'Schema missing container locator' };
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
      const pat = schema.match.pathPattern.replace(/\*/g, '.*').replace(/:[^/]+/g, '[^/]+');
      try {
        const re = new RegExp('^' + pat + '$');
        if (!re.test(u.pathname)) return { matches: false, score: 0 };
        score = schema.match.pathPattern.includes('*') || schema.match.pathPattern.includes(':') ? 2 : 3;
      } catch {
        if (schema.match.pathPattern !== u.pathname) return { matches: false, score: 0 };
        score = 3;
      }
    }

    return { matches: true, score };
  }

  /**
   * Replays a saved schema against a page snapshot.
   * Returns { ok, health, data, diagnostics, reason }
   */
  function runSchema(snap, schema) {
    const val = validateSchema(schema);
    if (!val.valid) return { ok: false, health: 'broken', reason: 'Invalid schema: ' + val.reason };

    // Resolve container node
    const resolved = L.locator ? L.locator.resolve(snap, schema.container) : { matched: false };
    if (!resolved.matched || resolved.nodeId === null) {
      return { ok: false, health: 'broken', reason: 'Container element not found by locator strategies' };
    }

    const patternDef = L.inspect ? L.inspect.getPattern(schema.kind) : null;
    if (!patternDef) return { ok: false, health: 'broken', reason: 'Pattern detector not registered: ' + schema.kind };

    let detectRes;
    try {
      detectRes = patternDef.detect(resolved.nodeId, { scoped: true });
    } catch (e) {
      return { ok: false, health: 'broken', reason: 'Pattern detection exception: ' + String(e.message || e) };
    }

    if (!detectRes || !detectRes.ok) {
      return { ok: false, health: 'degraded', reason: 'Pattern detection failed on container: ' + (detectRes ? detectRes.reason : 'unknown') };
    }

    let buildRes;
    try {
      buildRes = patternDef.build(detectRes, resolved.nodeId);
    } catch (e) {
      return { ok: false, health: 'broken', reason: 'Pattern result build failed: ' + String(e.message || e) };
    }

    const health = resolved.health || 'healthy';
    const diagnostics = {
      containerResolved: resolved,
      kind: schema.kind,
      detectReason: detectRes.reason,
    };

    return {
      ok: true,
      health,
      data: buildRes,
      diagnostics,
      reason: health === 'healthy' ? 'Schema executed cleanly' : 'Schema executed with degraded fallbacks',
    };
  }

  L.schema = {
    validate: validateSchema,
    matchUrl: matchSchemaUrl,
    run: runSchema,
  };
})();
