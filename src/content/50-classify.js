/* Page classification: probability distribution (uncalibrated) from regions, JSON-LD, URL rules, forms. */
(() => {
  const L = globalThis.Lasso, u = L.util;
  const CLASSES = ['article', 'listing', 'product_detail', 'table_page', 'docs', 'chat', 'landing', 'login', 'other'];
  /** Central URL rule table (unit-tested: every rule must match its own sample). */
  const URL_RULES = [
    { cls: 'article', re: /\/(blog|post|posts|article|articles|news|story|stories|p)\//i, w: 1.0, sample: '/blog/hello' },
    { cls: 'article', re: /\/(19|20)\d{2}\/\d{1,2}\//, w: 1.0, sample: '/2026/10/my-post' },
    { cls: 'article', re: /\/@[\w.-]+\/[\w-]+-[0-9a-f]{8,}/i, w: 1.2, sample: '/@user/my-title-1a2b3c4d5e6f' },
    { cls: 'listing', re: /\/(search|results|collections?|category|categories|tag|tags|shop|catalog|list|archive)(\/|$|\?)/i, w: 1.0, sample: '/collections/shoes' },
    { cls: 'product_detail', re: /\/(product|products|dp|item|items|sku)\//i, w: 1.2, sample: '/products/red-shoe' },
    { cls: 'docs', re: /\/(docs?|documentation|reference|api|guide|guides|manual)(\/|$)/i, w: 1.5, sample: '/docs/getting-started' },
    { cls: 'login', re: /\/(login|signin|sign-in|log-in|auth|register|signup|sign-up)(\/|$|\?)/i, w: 1.5, sample: '/login' },
    { cls: 'chat', re: /\/(chat|c|conversation|conversations|thread)\/[\w-]{6,}/i, w: 1.2, sample: '/c/abc123def' },
    { cls: 'landing', re: /^\/?$/, w: .8, sample: '/' },
  ];
  const CHAT_HOSTS = /(^|\.)(chatgpt\.com|chat\.openai\.com|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|perplexity\.ai)$/i;

  function classify(snap, regions, light) {
    const sc = Object.fromEntries(CLASSES.map((c) => [c, 0])), why = Object.fromEntries(CLASSES.map((c) => [c, []]));
    const add = (c, v, note) => { sc[c] += v; why[c].push(note); };
    const top = (k) => regions.filter((r) => r.kind === k).sort((a, b) => b.score - a.score)[0];
    const a = top('article'), t = top('table'), r = top('record_list');
    if (a) add('article', a.score * 2.2, `article region ${a.score}`);
    if (r) add('listing', r.score * (r.hints.flavor === 'product' ? 1.8 : 1.6), `record list (${r.hints.flavor}, ${r.hints.count} items) ${r.score}`);
    if (t) add('table_page', t.score * 1.6, `table region ${t.score}`);
    const path = light.path || '/';
    for (const rule of URL_RULES) if (rule.re.test(path)) add(rule.cls, rule.w, `url ${rule.re}`);
    const lt = snap.meta.jsonldTypes.join(' ');
    if (/Article|BlogPosting|NewsArticle/i.test(lt)) add('article', 1.2, 'JSON-LD article');
    if (/Product/i.test(lt)) add('product_detail', 2, 'JSON-LD Product');
    if (/ItemList|CollectionPage/i.test(lt)) add('listing', 1, 'JSON-LD list');
    if (light.counts.password > 0) add('login', 3, 'password field');
    if (CHAT_HOSTS.test(light.hostname)) add('chat', 2.5, 'known chat host');
    const codeBlocks = snap.nodes.filter((n) => n.tag === 'PRE').length;
    if (codeBlocks >= 3) add('docs', 1, `${codeBlocks} code blocks`);
    if (!a && !r && !t && !light.counts.password && snap.nodes.length && snap.root.stats.textLength < 4000) add('landing', .6, 'little text, no data regions');
    if (r && r.hints.flavor === 'product' && snap.root.stats.linkCount < 5) add('product_detail', .5, 'price signal on sparse page');
    add('other', .5, 'prior');
    const exps = CLASSES.map((c) => Math.exp(sc[c])), sum = exps.reduce((x, y) => x + y, 0);
    const dist = CLASSES.map((c, i) => ({ cls: c, p: u.round2(exps[i] / sum), why: why[c] })).sort((x, y) => y.p - x.p);
    return { top: dist[0].cls, distribution: dist, calibrated: false };
  }
  L.classify = Object.assign(classify, { URL_RULES, CLASSES });
})();
