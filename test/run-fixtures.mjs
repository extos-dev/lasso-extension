// Fixture harness (jsdom). Layout-dependent checks (overlay geometry, perf budgets) belong in a real browser: see docs/BUILD_PLAN.md Phase 1.
import { JSDOM } from 'jsdom';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
export const ENGINE = fs.readdirSync(path.join(here, '../src/content')).filter((f) => f.endsWith('.js')).sort();

export async function load(html, url = 'https://example.test/') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  for (const f of ENGINE) dom.window.eval(fs.readFileSync(path.join(here, '../src/content', f), 'utf8') + `\n//# sourceURL=${f}`);
  return dom.window;
}
const flatten = (rs, out = [], parent = null) => { for (const r of rs) { out.push({ ...r, parent }); flatten(r.children, out, r.kind); } return out; };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = path.join(here, 'fixtures'), exp = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
  let pass = 0, fail = 0; const failures = [];
  for (const name of Object.keys(exp)) {
    const e = exp[name], errs = [];
    const w = await load(fs.readFileSync(path.join(dir, name + '.html'), 'utf8'), `https://example.test/${name === 'landing' ? '' : name}`);
    const res = await w.Lasso.analyze(); const flat = flatten(res.regions);
    if (e.pageKind && res.classification.top !== e.pageKind) errs.push(`pageKind ${res.classification.top} != ${e.pageKind} (${res.classification.distribution.slice(0, 3).map((d) => d.cls + ':' + d.p)})`);
    for (const k of e.forbidKinds || []) if (flat.some((r) => r.kind === k)) errs.push(`forbidden kind present: ${k}`);
    if (res.stats.errors.length) errs.push('detector errors ' + JSON.stringify(res.stats.errors));
    let allText = '';
    for (const er of e.regions) {
      const r = flat.find((x) => x.kind === er.kind);
      if (!r) { errs.push(`missing region ${er.kind} (have: ${flat.map((x) => x.kind + ':' + x.score)})`); continue; }
      const md = w.Lasso.output.render(r.id, 'markdown').text, json = JSON.parse(w.Lasso.output.render(r.id, 'json').text);
      allText += md + JSON.stringify(json);
      for (const s of er.mustContain || []) if (!md.includes(s) && !JSON.stringify(json).includes(s)) errs.push(`${er.kind}: missing "${s}"`);
      for (const s of er.mustNotContain || []) if (md.includes(s) || JSON.stringify(json).includes(s)) errs.push(`${er.kind}: leaked "${s}"`);
      if (er.rows != null && json.rows.length !== er.rows) errs.push(`rows ${json.rows.length} != ${er.rows}`);
      if (er.cols != null && json.headers.length !== er.cols) errs.push(`cols ${json.headers.length} != ${er.cols}`);
      if (er.count != null && json.count !== er.count) errs.push(`count ${json.count} != ${er.count}`);
      if (er.flavor && json.flavor !== er.flavor) errs.push(`flavor ${json.flavor} != ${er.flavor}`);
      if (er.title && json.title !== er.title) errs.push(`title "${json.title}" != "${er.title}"`);
      if (er.author && json.author !== er.author) errs.push(`author "${json.author}" != "${er.author}"`);
      if (er.nestedIn && r.parent !== er.nestedIn) errs.push(`${er.kind} parent ${r.parent} != ${er.nestedIn}`);
    }
    if (/HIDDENDUP/.test(allText)) errs.push('hidden text leak');
    if (errs.length) { fail++; failures.push([name, errs]); } else pass++;
  }
  console.log(`fixtures: ${pass}/${pass + fail} passed`);
  for (const [n, errs] of failures) { console.log('  ✗ ' + n); errs.forEach((x) => console.log('     - ' + x)); }
  process.exit(fail ? 1 : 0);
}
