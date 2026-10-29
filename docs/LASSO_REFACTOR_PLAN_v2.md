# Lasso — Refactoring Plan v2 (review-revised)

Version 2.0 · 2026-10-29 · Audience: a coding agent working in the Lasso repository (Chrome MV3, no build step). **Supersedes `LASSO_REFACTOR_PLAN.md` v1.0.**

---

## 0. Review of v1 (read this first)

### 0.1 Verdict

v1 is a good plan: the one-model idea (Scan and Build both emit an **Extraction**; replay consumes only that) is right, the phase gates are right, and the findings F-01…F-15 are accurate. Checked against the source dump, **all fifteen hold** (F-05, F-06, F-07, F-08, F-09, F-10, F-11, F-12, F-13 are visible directly in code).

v1 has **eight design problems** that would have surfaced mid-implementation, mostly in Phases 2–3. The most serious:

1. **Replay through `build()` cannot work as specified.** `37-pattern-contact.js#build` only copies `r.meta` that `detect()` computed; `36-pattern-chat.js#build` uses `r.itemIds`/`r.roles` that `detect()` computed. A `fields:"auto"` extraction therefore cannot be replayed from "scope + item ids" without re-running detection. A pure `rebuild()` entry point is needed (§5.3).
2. **Scan by looping `detect()` over up to 500 container nodes is the wrong engine.** Existing `detect()` functions already climb and walk (`articleFor` climbs to an ancestor `<article>`, `listFor` climbs 4 parents, chat 7, contact 6), so the scope is not contained; `Text` is "ok" for every container (noise); there is no ranking and no evidence. The repo **already has** ranked, evidence-bearing detectors (`30/31/32` + `40-arbitrate`) that pass the fixture corpus; Scan should be those detectors restricted to the scope (§5.4).
3. **`u.stableTokens()` cannot build selectors.** It lowercases, replaces digits with `#` and sorts (`col-6` → `col-#`). v1's locator/item-selector generation relied on it. A raw-class helper is required (§5.5.1).
4. **`withSnapshot()` is a workaround for a design flaw** (patterns close over `state.snap`) and would borrow a possibly stale inspect snapshot. Make patterns take the snapshot explicitly; scan then never touches the inspect session at all.
5. **`stage0()` still injects the engine into every tab you switch to** (`ensureEngine` → `LIGHT`). This contradicts v1's own "no idle cost" principle and the README/PRIVACY promise ("injected only when you start Inspect").
6. **Locator risks:** numeric `quality` scores conflict with charter rule 2; `ids` like `thread-98231` are not stable; open shadow DOM is traversed by the snapshot but not by `querySelector`; chat items found via `fromRoles` are *not* direct children, so `:scope > …` item selectors cannot express them.
7. **Privacy/safety of persisted recipes:** v1 stored sample values and a free `regex` field. Samples are page content; regex is a ReDoS vector once recipes can be imported.
8. **Churn and size:** v1 added `RESULT_RENDER` in P1 and deleted it in P2; P1 had eleven tasks and broke the panel mid-phase.

### 0.2 What I could and could not check

- **Checked (read in the dump):** all `src/content/*`, `src/sidepanel/*`, `service-worker.js`, manifest, docs, fixtures.
- **Not provided, so not reviewed:** `SCAN_VISION.md` (v1 calls it normative for the Scan tab; the UI in §5.9 follows v1 §4.7.1 and **must be reconciled with that file**), and `test/unit.mjs`, `test/panel.mjs`, `test/inspect-smoke.mjs`, `scripts/*`. Test counts quoted in docs are unverified.
- Nothing was executed. Statements marked **VERIFY** need the agent to confirm by running code.

### 0.3 Change log vs v1

| # | Change | Why |
|---|---|---|
| C-01 | Scan = **scoped Phase-0 detectors** (article/table/record_list, ranked, with evidence) + each pattern's own `find()` (chat/contact/text) | Reuses tested code, gives ranking/alternatives, contained scope, keeps charter rule 2 |
| C-02 | Pattern contract v2: **`find(ctx)` / `build(hit, ctx)` / `rebuild(ctx, …)`**, snapshot passed explicitly | Makes replay possible; removes `withSnapshot` hack; scan never touches inspect state |
| C-03 | `snapshot({root})` moved from P2 to **P1** | Scoped scans become cheap; de-risks replay; equality test is the riskiest piece |
| C-04 | **Containment is guaranteed and tested** (no hit outside scope) | Existing `detect()` climbs ancestors |
| C-05 | **`stage0()` never injects**; site card from `tab` metadata | Fulfils "no idle cost" and the privacy statement |
| C-06 | Locator v1 revised: raw stable classes, anchor-path tier, id stability filter, ordered **tiers instead of numbers**, shadow-DOM guard | N-03, N-06, charter rule 2 |
| C-07 | Item selector grammar allows descendant selectors; `exact` flag | Chat items need not be direct children |
| C-08 | Recipes persist **structure only** (no sample values); delete UI; PRIVACY update | Privacy |
| C-09 | Closed **transform set** instead of `regex` (regex deferred to P5 with caps) | ReDoS / imports |
| C-10 | Scan results kept page-side **as data**; `RESULT_RENDER` stays for scan cards, `EXTRACTION_RENDER` is for saved/built extractions | No add-then-delete churn; instant expand/copy; snapshot can be released |
| C-11 | **P1 split**: P1 engine (additive messages, panel keeps working) and P2 panel/UI (+ deletions) | Gates stay green; smaller phases |
| C-12 | Panel keeps focus/scroll across repaints; per-kind formats; coverage line; empty-state explanations | UX defects of `replaceChildren` repaint |
| C-13 | Recipe match by **host** (not origin), wait-for-scope on SPA replay | `www.`/http→https; async rendering |
| C-14 | Pick mode has **ancestor stepping (↑/↓) and block snapping from P1** | A click lands on a leaf `span`; scope must be a container |
| C-15 | Structure tree reads the **live DOM lazily** in P4, deleting the full-page inspect snapshot | Last idle-time snapshot |
| C-16 | Open questions answered with recommended defaults (§10) | Agent should not stall |

---

## 1. How to use this document

1. Read, in order: `AGENTS.md`, `docs/MASTER_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/BUILD_PLAN.md`, `docs/DECISIONS.md`, this file, then `SCAN_VISION.md` (copy to `docs/SCAN_VISION.md` in P2; normative for Scan-tab UX; **if it conflicts with §5.9, stop and ask**).
2. Work **one phase at a time**. Every phase ends at a **gate**: run the gate commands, write the report (§11), **stop and wait for "next"**.
3. **Fixtures/tests first** (AGENTS.md).
4. **VERIFY** items: confirm by running; if reality differs, add a `docs/DECISIONS.md` entry, adapt minimally, flag it in the report.
5. This plan supersedes the inspect-first direction for the Page/Scan tab. Update `README.md`, `AGENTS.md`, `docs/VISION.md` at the end of P2.
6. Charter (AGENTS.md "Hard rules") holds in full. Most relevant: never mutate the page except the closed shadow-root overlay; **node ids are per-run only, persisted data uses locators**; one locator module; no `fetch`/XHR/WebSocket/`eval`/`new Function` in `src/`; `chrome.*` only in overlay (messaging), bridge, panel, background; storage only in background; page strings reach the DOM via `textContent` only; zero runtime deps, no build step; **no invented confidences** (UI shows `reason` text, never high/medium/low or percentages from scores); behaviour changes update `docs/MASTER_SPEC.md` in the same change.

---

## 2. Product objective

Lasso is a local-first **data extraction engine** with two producers and one consumer sharing one data model:

```
Locate ──► Scan  (auto, scoped detectors) ─┐
                                           ├─► Extraction ──► Run ──► Data ──► Render (md/json/csv)
Induce (from sample elements, Build) ──────┘   (JSON, saved)  (live DOM)
```

- **Scan:** input = a *scope element* (default whole page) and a set of patterns; output = ranked results per pattern, each convertible to an Extraction.
- **Build:** the user picks one or two sample elements (e.g. two chat bubbles); the engine infers parent, item selector and fields; the user loosens/tightens, previews live, saves.
- **Run** consumes only an Extraction. Built-in patterns replay through their own `rebuild()` (`fields:"auto"`), so scan results and replay results are identical.

Principles: one model · stateless scan (no hidden state the panel must mirror) · **no idle cost** (no injection, no snapshot until the user acts; one snapshot per scan; replay snapshots only the scope subtree) · inspect is an instrument, not a destination · honest results (failures show *why*, coverage gaps are visible).

---

## 3. Glossary

| Term | Meaning |
|---|---|
| **Pattern** | Registered extractable kind: `article`, `table`, `list` (kind `record_list`), `text`, `chat`, `contact`, plus `custom`. |
| **Scope** | Element a scan/extraction looks inside; whole page = `document.body`. |
| **Hit** | One candidate returned by a pattern's `find()` (contains snapshot node ids; run-local). |
| **Result** | A built Hit (`{kind, nodeId, itemIds?, …}`; run-local). |
| **Extraction** | Serialisable JSON: pattern + scope Locator + optional item selector + fields. §5.5.2. |
| **Recipe** | Saved bundle of Extractions for a site. §5.5.3. |
| **Locator** | Serialisable multi-strategy description of one element. §5.5.1. |
| **Data** | Output of a run, in the existing `dataForInspect` shapes. |
| **Tier** | Which locator strategy matched (`anchor`/`css`/`anchorPath`/`path`/`fingerprint`). Replaces numeric "quality". |

---

## 4. Findings

### 4.1 From v1 (all confirmed from source; the agent re-verifies in P0)

| # | Finding | Where | Fixed in |
|---|---|---|---|
| F-01 | Page view does not implement `SCAN_VISION.md` (no split button, inline groups; "View in Output"; always shows empty recipes card) | `views/page.js` | P2 |
| F-02 | `actions.viewScanResultInOutput`/`actions.runRecipe` do not exist; `state.pageRecipes` never loaded | `views/page.js`, `panel.js` | P2 / P3 |
| F-03 | `structuralKey()` omits `scanScope`, `scanScopeLabel`, `scanPatterns`, `pageScanFormat` → stale UI | `panel.js` | P2 |
| F-04 | CSS uses undefined `--border`, `--code` (real token `--line`); `.scan-btn` invisible; centred checkbox list; light fallback in dark mode; duplicated blocks | `panel.css` | P2 |
| F-05 | `listFor()` reads `f.image` but `f` is undefined there → `ReferenceError` on any non-scoped (whole-page) list hit | `35-inspect.js` | P1 |
| F-06 | `L.scan.run` calls `L.inspect.start()`; `active` becomes true with no overlay; next `stage0()` switches to Map | `39-scan.js`, `panel.js` | P1 (engine) / P2 |
| F-07 | Two scan implementations (`L.scan.run` root-only; `L.inspect.scanAll` ignores scope) + three bridge entry points | `39-scan.js`, `35-inspect.js`, `90-bridge.js` | P1 / P2 |
| F-08 | Scope stored as a snapshot node id | `state.js`, `39-scan.js` | P1 |
| F-09 | Overlay "Set as scan parent" updates engine only; panel `scanScope` updated only from Map | `70-overlay.js`, `views/map.js` | P2 |
| F-10 | `copyPageScanResult` sends `INSPECT_SELECT` as a side effect; `renderPageScanAll` never called | `panel.js` | P2 |
| F-11 | `paint()` rebuilds all three views; `structuralKey()` JSON-stringifies the tree every paint | `panel.js` | P2 |
| F-12 | `groupForParent` keeps only the single largest bucket; tag-fallback is a side effect of `minItems<3`; no "all children" level | `20-segment.js` | P4 |
| F-13 | Results hold node ids; `saveSchema` stores `container:{nodeId}` | `35-inspect.js`, `60-output.js`, `panel.js` | P3 |
| F-14 | Docs contradict the new direction | `README.md`, `AGENTS.md`, `docs/VISION.md` | P2 |
| F-15 | `test/e2e.mjs` stale and unwired | `test/e2e.mjs` | P2 |

### 4.2 New in this review

| # | Finding | Evidence | Fixed in |
|---|---|---|---|
| N-01 | `build()` depends on `detect()` state (contact `r.meta`; chat `r.itemIds`/`r.roles`) → no replay from scope alone | `36`, `37` | P1 (`rebuild`) |
| N-02 | `detect()` functions climb above the selection (article → ancestor `<article>`; list 4 parents; chat 7; contact 6) → "scoped" is not contained | `35`, `36`, `37` | P1 |
| N-03 | `u.stableTokens` normalises class names (lowercase, `\d+`→`#`, sorted) → unusable in selectors | `00-namespace.js` | P1 (`u.stableClasses`) |
| N-04 | Whole-page scan via per-container `detect()`: `Text` is always ok; duplicates; no ranking; evidence lost; relies on climbing | `35` `scanAll`, `39-scan.js` | P1 |
| N-05 | `stage0()` runs `ensureEngine` on every tab activation/complete | `panel.js` | P2 |
| N-06 | Snapshot enters open shadow roots and uses `<slot>` assigned nodes; `querySelector` does neither | `10-snapshot.js` | P3 (guard) |
| N-07 | Chat `fromRoles` items are non-direct descendants | `36-pattern-chat.js` | P3 |
| N-08 | Layering: built-in adapters over detectors need `40-arbitrate`, which is a higher layer than `35` | `35` vs `40` | P1 (new file `44`) |
| N-09 | Hard gates reject legitimate explicit scopes (record list: avgText ≥15, link/image/heading ≥60%, nav-like drop; chat history is short, link-heavy) | `32-detect-records.js` | P1 (`relaxed`) |
| N-10 | Service worker dispatches `handlers[msg.type]` on a plain object (`'constructor'`) | `service-worker.js` | P2 (one-liner `Object.hasOwn`) |

---

## 5. Target architecture

### 5.1 Layout changes

Layering rule unchanged: a file may use only lower-numbered files; add every new file to `src/shared/content-files.js` (unit test checks).

| File | Status | Responsibility |
|---|---|---|
| `00-namespace.js` | change (P1) | add `u.stableClasses(el)`, `u.isStableId(id)`, `u.cssEscape` |
| `10-snapshot.js` | change (P1) | `opts.root` with **seeded** inherited context (§5.6.1) |
| `32-detect-records.js`, `30/31` | change (P1) | accept `ctx.relaxed` (bypass hard gates, keep scoring) |
| `35-inspect.js` | change (P1/P2/P4) | registry gains `find/rebuild` + optional `ctx` in `build`; patterns stop closing over `state.snap`; remove `scanAll` (P2); legacy `detect` + session removed per phase |
| `36-pattern-chat.js`, `37-pattern-contact.js` | change (P1) | add contained `find`, pure `rebuild`; use `ctx.snap` |
| `39-scan.js` | **delete (P2)** | replaced by `64-scan.js` |
| `40-arbitrate.js` | change (P1) | optional `opts.relaxed` (lower per-kind thresholds, mark `weak`) |
| `44-pattern-core.js` | **new (P1)** | `find`/`rebuild` for `article`, `table`, `list`, `text` via detectors + arbitrate (needs layer 4) |
| `45-locator.js` | **new (P3)** | make / resolve / relative / describe |
| `46-induce.js` | **new (P4)** | induction from sample elements |
| `47-extraction.js` | **new (P3)** | compile / validate |
| `60-output.js` | change (P1) | `dataForInspect(result, snap)`; `previewText`; `renderData`; `availableFormats(kind)`; record-list Markdown fallback to all columns |
| `62-run.js` | **new (P3)** | `L.run`, `L.runRecipe` (after `60`, needs formatters; record in DECISIONS why not `55-schema.js`) |
| `64-scan.js` | **new (P1)** | `L.scanner` + `L.scanCtx` (page-side context) |
| `70-overlay.js` | change (P1/P4) | pick modes without an inspect session; `highlight(els)` |
| `90-bridge.js` | change (P1 add, P2 remove) | §5.7 |
| `service-worker.js` | change (P3) | recipe v2 + v1 migration; `PREFS_*` |
| `sidepanel/*` | change (P2) | §5.8–5.9 |
| `views/output.js` | **delete (P2)** | formats/download helpers move to `views/scan-results.js` |
| `views/build.js` | **new (P4)** | Build workbench |
| `test/e2e.mjs` | **delete (P2)** | stale |

### 5.2 Principles for code changes

- Everything new is **pure over an explicit snapshot** (`ctx.snap`), never over module state.
- Scan and replay take **private snapshots** and release them; they never read or change `L.inspect` state.
- Rank values are internal. The UI shows `reason` strings and a rule-based `weak` flag ("below the usual threshold"), never numbers.

### 5.3 Pattern contract v2

```js
L.inspect.registerPattern({
  id: 'chat', label: 'Chat', order: 25,
  find(ctx),                  // ctx = { snap, scope /*Node*/, groups?, relaxed, limit /*5*/ }
                              // -> Hit[] best-first. Every hit.nodeId is scope or a DESCENDANT of scope.
                              //    Hit = { nodeId, itemIds?: number[], reason: string, meta?: object, weak?: boolean, rank: number }
  build(hit, ctx),            // -> Result { kind, nodeId, ... } pure over ctx.snap (ctx optional: falls back to the inspect snapshot for legacy callers)
  rebuild(ctx, { itemIds, options }),
                              // -> Result for ctx.scope EXACTLY: no search, no climbing. Replay entry point.
  detect(id, opts),           // LEGACY point-selection semantics; kept until P2, then deleted
});
```

- `Hit` is deliberately compatible with the old `detect()` return (`{nodeId, itemIds, reason, meta}`), so one `build()` serves both.
- `registerPattern` for an id that already exists **merges** (`find`, `rebuild`, `build`) rather than replacing, so `44-pattern-core.js` can extend the legacy `article/table/list/text` entries in `35-inspect.js` during P1.
- Built-ins:
  - **article / table / list (`44-pattern-core.js`)**: `find` runs the registered Phase-0 detectors (`L.detectors` ids `article`, `table`, `record_list`) on `ctx.snap` with `ctx.groups`, then `L.arbitrate`, then maps regions → Hits (`record_list` → `{nodeId, itemIds, meta:{count, flavor}}`; `reason` = top two evidence notes). `rebuild`: article → `L.articleHints(snap, node, {scoped:true})` + `L.toMarkdown`; table → `L.extractTable`; list → `L.extractRecordItem` over `itemIds`.
  - **text**: one Hit = scope. (Never loop it over containers.)
  - **chat / contact**: existing detection logic moved into `find`, restricted to the scope subtree; `rebuild` recomputes roles / contact target from the scope node only. Chat `itemIds` may be non-direct descendants (N-07).
- `relaxed` (set when the scope is user-picked): detectors skip hard gates (min text, link/image/heading richness, nav-like drop, min 3 items → 2) and per-kind thresholds drop by 0.25 (floor 0.15). Hits under the normal threshold carry `weak:true`. The constants are heuristics documented in MASTER_SPEC.

### 5.4 Scan algorithm (`64-scan.js`)

```js
L.scanCtx = { scopeEl, samples:[], results:new Map(), setScope(el), clearScope(), addSample(el), clearSamples(), describe() }
L.scanner = { async run({ patterns }) }
```
1. Scope element = `scanCtx.scopeEl` or `document.body`. If set and `!isConnected` → clear it, return `{ scopeLost:true, groups:[] }`.
2. `snap = L.snapshot(document, { root: scopeEl })` (private; hidden/not-in-snapshot scope → `scopeLost`).
3. `ctx = { snap, scope: snap.root, relaxed: scopeWasPicked, limit: 5, groups: L.segment.mineRepetition(snap, { relaxed }) }` (mine once, share).
4. For each requested pattern in catalog order: `hits = def.find(ctx)` (try/catch → `ok:false` + message); `await u.yieldToMain()` between patterns (`L.util.yieldToMain` exists).
5. For each hit: `result = def.build(hit, ctx)`; `data = L.output.dataForInspect(result, snap)`; `preview = L.output.previewText(data)`; store `{result, data}` in `scanCtx.results` under `key = ${scanId}:${pattern}:${i}`. Replace the Map on every scan (stale keys are rejected).
6. P3: `extraction = L.extraction.compile(result, snap)` per item (needs the snapshot, so compile **during** the scan, before releasing it).
7. No hit → `ok:false`, `reason` = the pattern's first failure reason or "nothing found in scope".
8. Response (§5.5.6) includes `coverage`. Release the snapshot. **Must not** call `L.inspect.start()` or change `L.inspect.info().active`.

### 5.5 Data model (normative; plain JSON, size-capped, shape-validated, never evaluated, no node ids)

#### 5.5.1 Locator (`v:1`)

```jsonc
{
  "v": 1,
  "anchors": { "id": "thread", "testid": "conversation", "aria": "Chat log", "role": "log", "itemprop": null },
  "css": [ "main > section#thread", "section.thread" ],            // [strict, loose]; each verified unique at make-time; may be []
  "anchorPath": { "anchor": "#chat-root", "steps": ["div:nth-of-type(2)", "ol"] },  // relative to nearest uniquely-anchored ancestor; optional
  "path": "body>div:nth-of-type(2)>main>section:nth-of-type(1)",    // full chain, depth cap 40
  "fp": { "tag": "SECTION", "cls": ["thread"], "kids": 24, "domDepth": 6, "h": "a1b2c3d4" }
}
```

- `anchors`: only attributes that exist **and are unique in the document** at make-time **and look stable**: `id` must pass `u.isStableId` (not hashy, no run of ≥4 digits, not `react-*|:r*|ember*|radix-*|headlessui-*`); `aria-label` ≤ 40 chars without a digit run ≥4; first of `data-testid|data-test|data-qa|data-cy`; `role`; `itemprop`.
- `css`: built from **raw** stable classes (`u.stableClasses(el)` = real class tokens not rejected by `u.isHashy`; escaped with `CSS.escape`). Strict = child-combinator chain from nearest anchor/body; loose = stable classes with descendant combinators (survives an inserted wrapper).
- `fp.cls` may use `u.stableTokens` (similarity only). `fp.domDepth` is the **DOM** depth (snapshot `depth` is relative to the snapshot root). `fp.h` = FNV-1a 32-bit of the first 80 normalised text characters (no crypto API).
- No absolute URLs, no page text beyond the 8-hex hash and the short anchor strings above.
- `make(el)` returns `{ok:true, locator}` or `{ok:false, reason}`; **`reason:'inside shadow DOM'` when `el.getRootNode() !== document`** (N-06). Shadow-DOM scopes are unsupported for save/replay in v1 (decision §8-D7); Scan itself still works there.

**Resolution (`L.locator.resolve`)** tries tiers in order; every candidate must satisfy `el.tagName === fp.tag`:

| Order | Tier | Accept when |
|---|---|---|
| 1 | `anchor` | unique `id`/`testid`, then unique `aria`/`role`/`itemprop` |
| 2 | `css` | strict then loose selector matches exactly one element |
| 3 | `anchorPath` | anchor resolves uniquely and the steps resolve |
| 4 | `path` | the chain resolves |
| 5 | `fingerprint` | search elements with the same tag (≤5000 checked); weighted similarity (cls Jaccard .3, kids closeness .2, domDepth closeness .1, text hash equal .4) ≥ .5 **and** best exceeds runner-up by > 0.05 |

Returns `{ el, tier, ambiguous }` or `{ el:null, reason }`. `ambiguous` = a tier produced multiple candidates it could not separate. Tiers 1–2 ⇒ "matched" (healthy); tiers 3–5 or `ambiguous` ⇒ "needs repair" warning. The panel shows the **tier name** ("matched by id", "matched by structure"), never a number. The similarity weights are a ranking heuristic, not a probability; keep them in one constant and tune them with the variant fixtures.

`L.locator.relative(fromEl, toEl)` → selector string relative to `fromEl` (`:scope > …` or `:scope …`), preferring a raw-stable-class selector unique within `fromEl`, else an `nth-of-type` chain. Round-trip law: `from.querySelector(relative(from,to)) === to`.

#### 5.5.2 Extraction (`v:1`)

```jsonc
{
  "v": 1, "id": "ex_k3j2f9", "pattern": "list", "origin": "scan", "label": "Search results",
  "scope": { /* Locator */ },
  "item": { "sel": ":scope > li", "match": "tag", "minRepeat": 2, "exact": true },   // list/chat/custom only
  "fields": "auto",
  // or: [ { "name": "role", "sel": "[data-message-author-role]", "attr": "data-message-author-role" },
  //       { "name": "text", "sel": ".markdown", "attr": "text", "multi": false, "transform": ["trim"] } ],
  "options": { "flavor": "result" }
}
```
- `item.sel` is **any selector relative to the scope**: `:scope > li` when items are children, otherwise a descendant selector such as `:scope [data-message-author-role]` (N-07). `compile` verifies that the chosen selector's match set equals the scanned `itemEls` (Jaccard 1.0 ⇒ `exact:true`). If no level reaches 1.0 it keeps the best and sets `exact:false` (UI: "approximate — Refine"); consistency tests apply to `exact` items only.
- `fields[].sel` is relative to the item (`""` = the item). `attr`: `text`, `html`, `href`, `src`, `value`, or `/^[a-z][\w:-]{0,40}$/`. **`transform`** is an ordered subset of the closed set `trim, collapse, number, url, lower`. (`regex` is deferred to P5 with a 2,000-character input cap and a nested-quantifier check.)
- `fields:"auto"` ⇒ replay via the pattern's `rebuild()`.
- Caps (`validate` rejects): 20 extractions/recipe, 50 fields/extraction, selector ≤500 chars, label ≤80, JSON ≤64 KB. Unknown keys dropped. **No sample values are persisted** (C-08).
- Selectors come from storage ⇒ every `querySelector(All)`/`matches` in try/catch; never concatenate page text into a selector without `CSS.escape`.

#### 5.5.3 Recipe (`v:2`, stored by the background worker)

```jsonc
{ "v": 2, "id": "rc_…", "name": "ChatGPT thread",
  "match": { "host": "example.com", "pathPattern": "/c/*" },     // host without leading www.; glob: * one segment, ** rest; query ignored
  "extractions": [ /* Extraction[] */ ],
  "lastRun": { "at": 1767000000000, "status": "ok", "items": 37 },
  "created": 0, "updated": 0 }
```
Reuse `SCHEMA_*` message names. v1 records (shape `container:{nodeId}`) are **migrated one way** to `extractions:[]`, `status:'broken'` with a note; never deleted.

#### 5.5.4 Data

Keep existing shapes (`article`, `table`, `record_list`, `chat`, `contact`, `text`). Custom explicit-field extractions produce `record_list` with `flavor:'custom'`. Markdown for `record_list` falls back to **all columns** when none of `title/price/date/url` exist.

#### 5.5.5 Run result and health

```jsonc
{ "ok": true, "data": { }, "stats": { "items": 37, "ms": 41 },
  "health": { "status": "ok", "scope": { "tier": "anchor", "ambiguous": false },
              "fields": [ { "name": "text", "fill": 0.97 } ], "reasons": [] } }
// failure: { "ok": false, "reason": "scope not found", "health": { "status": "broken", … } }
```
Rules (deterministic; document in MASTER_SPEC): `broken` if scope unresolved or an expected item list is empty/below `minRepeat`; `degraded` if tier ∈ {anchorPath, path, fingerprint}, `ambiguous`, any explicit field `fill < 0.5`, or item count < 50% of `lastRun.items`; else `ok`.

#### 5.5.6 Scan response

```jsonc
{ "scanId": "s7", "scope": { "whole": false, "label": "main › section#thread" }, "ms": 120,
  "coverage": { "nodes": 812, "truncated": false, "hiddenSkipped": 14, "opaque": 2 },
  "groups": [
    { "pattern": "table", "label": "Table", "ok": true, "reason": null,
      "items": [ { "key": "s7:table:0", "label": "Table", "summary": "12 rows × 5 cols",
                   "reason": "header: thead · 12 rows", "weak": false, "preview": "Name | Qty | …",
                   "formats": ["markdown","json","csv"], "extraction": null /* P3+ */ } ] },
    { "pattern": "chat", "label": "Chat", "ok": false, "items": [], "reason": "no repeated messages in scope" } ] }
```
`preview` ≤ 400 plain-text chars. Full data stays page-side; the panel requests rendering by `key` (`RESULT_RENDER`). Per-pattern cap 5. Default patterns: Article, Table, List, Text; Chat/Contact opt-in. `coverage` drives the empty-state text (e.g. "Nothing found. 2 iframes on this page can't be read.").

### 5.6 Engine APIs

#### 5.6.1 `10-snapshot.js` — `opts.root`
`L.snapshot(doc, { root: Element })` snapshots only that subtree, **seeding** `parentBp` and `inContent` by walking the root's ancestors with the same `bpOwn` logic, and seeding inherited `ariaHidden`. `depth` is relative to the root (do not persist it). Root hidden ⇒ `root:null`. **Required equality test:** for every fixture × built-in pattern, data from `rebuild` on a full snapshot equals data on a `{root}` snapshot of the same node. (VERIFY how `visit` propagates `bp`/`inContent`.)

#### 5.6.2 `60-output.js`
`dataForInspect(result, snap)` (snapshot is a parameter); `L.output.previewText(data)`; `L.output.renderData(data, formatId)` → `{text, mime, filename, chars, tokenEstimate, tokenEstimateNote}`; `L.output.availableFormats(kind)` (article/text/contact → markdown, json; table/record_list/chat → markdown, json, csv). `L.toMarkdown` already exists. Keep legacy `render*` for the fixture harness.

#### 5.6.3 `45-locator.js`, `47-extraction.js`, `62-run.js` (P3)
```js
L.locator.make(el) -> {ok, locator|reason};   L.locator.resolve(locator) -> {el,tier,ambiguous}|{el:null,reason};  L.locator.relative(from,to);  L.locator.describe(el)
L.extraction.compile(result, snap, ctx) -> Extraction;   L.extraction.validate(obj) -> {ok, errors[]}
L.run(extraction, { prevItems? }) -> run result;    L.runRecipe(recipe) -> { results[], status }
```
`run`: (1) `resolve(scope)`; if it fails once, wait up to 1.5 s for the element (MutationObserver, user-initiated runs only) before declaring `broken`; (2) private `L.snapshot(document,{root})`; (3) if `item`: `els = scope.querySelectorAll(item.sel)` (try/catch), drop invisible, map to ids via `snap.byEl`, `< minRepeat` ⇒ broken; (4) `fields:"auto"` ⇒ `def.rebuild(ctx,{itemIds, options})` → `dataForInspect`; explicit fields ⇒ evaluate per item, compute `fill`; (5) health; never mutate the page; release the snapshot.

#### 5.6.4 `46-induce.js` (P4)
```js
L.induce.fromSamples(sampleEls, { level? }) -> { ok, reason?, scopeEl, itemEls[],
  levels: [{match, sel, count}], ladder: [{up, label, counts:{class,tag,children}}],
  fields: [{name, sel, attr, fill, samples:[≤3 values, truncated 80 chars — UI only, never persisted]}], extraction }
L.induce.withScope(scopeEl, { up?, level? })
```
1. Dedupe samples; if one contains another keep the deepest.
2. **≥2 distinct items:** scope = lowest common ancestor; `item_i` = ancestor-or-self of `sample_i` whose parent is the scope. Items need not be direct children when a shared attribute selector (e.g. role attribute) matches exactly the sampled set.
3. **One item (ladder):** for `up = 0..12` (stop at `body`) compute counts of `parent(A)`'s children matching A at levels class/tag/children; default = smallest `up` with `counts.class ≥ 3`, else tag ≥3, else ≥2; skip parents with > 2000 children. Return the ladder for the UI.
4. **Level:** the most specific level whose selector matches **all** samples; expose the rest.
5. **Fields:** leaf descriptors from the items plus ≤20 sibling items as implicit samples (own text, `img[src]`, `a[href]`, `time[datetime]`, role-like `data-*`). Key = `L.locator.relative(item, leaf)`; align `nth-of-type` across items. Keep keys present in ≥50% of items **and** (varying value, or attr ∈ `href|src|datetime`); constants are dropped. Names: `h1–h6`→`title`; `a`→`link` (+`text` if differing); `img`→`image`; `time`→`date`; `PRICE_RE`/`.price`→`price`; role-like attr→`role`; else `text`, `text_2`, …
6. Build `extraction` (`pattern:'custom'`, `origin:'manual'`, explicit fields).

#### 5.6.5 `20-segment.js` ladder (P4)
`groupForParent(snap, parent, minItems=3, opts={})` gains `opts.match: 'strict'|'class'|'tag'|'children'` (`children` = all element children except BR/HR/script/style/hidden). Default behaviour unchanged. `L.segment.ladder(snap, parent)` → `[{match, count, ids}]`. `mineRepetition(snap, { relaxed })` passes `minItems:2`, threshold .4.

### 5.7 Message protocol

`api.js` is the only panel module that touches `chrome.*`. All messages `{lasso:true, type, …}`; replies `{ok,data}`/`{ok:false,error}`. Use `Object.hasOwn(handlers, type)` in bridge and service worker (N-10).

| Message | Dir | Payload → response | Phase |
|---|---|---|---|
| `SCAN` | panel→page | `{patterns}` → §5.5.6 (async) | P1 (replaces `SCAN_RUN`) |
| `SCAN_CTX_GET` | panel→page | → `{scope:{label}\|null, samples:n}` | P1 |
| `SCOPE_PICK` | panel→page | `{mode:'scope'\|'sample'\|'field', multi}` → `{ok}` | P1 |
| `PICKED` / `PICK_CANCELLED` | page→panel | `{mode, items:[{label, path}]}` / `{}` | P1 |
| `SCOPE_FROM_NODE` | panel→page | `{nodeId}` → `{label}` (Structure tab) | P1 |
| `SCOPE_CLEAR` / `SAMPLES_CLEAR` | panel→page | → `describe()` | P1 |
| `RESULT_RENDER` | panel→page | `{scanId, key, format}` → rendered `{text,mime,filename,chars,tokenEstimate,tokenEstimateNote}` | P1 (permanent) |
| `EXTRACTION_RENDER` | panel→page | `{extraction, format}` → rendered + `health` | P3 |
| `RECIPE_RUN` | panel→page | `{recipe}` → `{results[]}` | P3 |
| `INDUCE`, `EXTRACTION_PREVIEW`, `HIGHLIGHT` | panel→page | see §5.6.4, preview `{rows,count,health}`, `{count}` (cap 300) | P4 |
| `SCHEMA_*`, `SCHEMA_MATCH`, `PREFS_GET/SET` | panel→bg | recipe v2 | P2/P3 |

**Removed in P2:** `SCAN_RUN`, `INSPECT_SCAN_ALL`, `SCAN_SET_SCOPE`/`SCAN_GET_SCOPE`/`SCAN_CLEAR_SCOPE`, `SHOW_OUTPUT`, `INSPECT_PATTERNS`, `INSPECT_RENDER`, `INSPECT_RENDER_ALL`, `NODE_SELECTED`'s pattern payload (the Structure tab keeps `INSPECT_START/STATE/STOP/TREE/SELECT`, `NODE_SELECTED`, `NODE_HOVERED`, `INSPECT_EXITED` until P4).

### 5.8 Panel architecture

State (`state.js`): one `initial()` factory and a `scan` slice.

```js
export const initial = () => ({
  rev: 0, view: 'scan',                     // 'scan' | 'structure'  (→ 'build' in P4)
  tab: null, site: null, inspect: null, tree: null, selectedId: null, selected: null, hoverId: null, breadcrumb: [],
  scan: { open: false, scope: null, picking: null, patterns: ['article','table','list','text'],
          busy: false, error: null, result: null, format: 'markdown', expanded: {}, rendered: {} },
  recipes: [],                              // P3
});
export const set = (patch) => { Object.assign(state, patch); state.rev++; notify(); };
```
- **Replace `structuralKey()`** with `rev`. Hover updates bypass `set()` (existing fast path) and never bump `rev`.
- Paint **only the visible view**. Repaints preserve UI state: before `replaceChildren()` record `scrollTop` of scrollable regions and the focused element's `data-key`; restore after (C-12). Never rebuild an element you want to animate (config block toggles by class, mirrored into `state.scan.open` without `set()`).
- **`stage0()` never injects** (C-05): site card from `tab.url/title/favIconUrl`; `PING` **without** `ensureEngine` — if the engine is already present, `SCAN_CTX_GET` restores scope; recipes via `SCHEMA_MATCH {url}` (P3). `ensureEngine` runs only in actions that need the page (Scan, Pick, Run, Structure). `stage0` must never switch the view because inspect is `active`.
- Replace the three hand-copied reset lists (`stage0`, `onUpdated`, `resetInspect`) with `set({...initial(), tab})`.
- `Scan` ignores clicks while `busy`; results carry `scanId` and are dropped if stale.

### 5.9 UI specification

#### 5.9.1 Scan tab (reconcile with `SCAN_VISION.md`)

```
┌ Site card: favicon · hostname · title (· "First visit" only if the owner keeps the visit profile — §10 Q7)
┌ Saved recipes (only if any)                    Chat · ChatGPT thread        [Run]
┌ [        Scan        ][▾]                                              ← split button
│ (expanded) Parent node: [Select parent node]  Scanning within: main › section#thread  [Clear scope]
│            Patterns: ☑ Article ☑ Table ☑ List ☑ Text ☐ Chat ☐ Contact
│            [ Go ]  (disabled if no pattern checked)
├ Results ────────────────────────── Format: [Markdown][JSON][CSV] ┐   (formats not valid for a card's kind are hidden for that card)
│ ▾ Table (2)
│    ┌ Table · 12 rows × 5 cols ── header: thead · 12 rows ─────────┐
│    │ preview … [Expand] [Copy] [Download] [Save recipe]* [Refine ▸]* │
│ ▸ Article (1)   ┌ weak: "below the usual threshold" label where applicable
│ ▸ Chat — not applicable: no repeated messages in scope    [Build manually ▸]*
│ Coverage: 812 nodes · 14 hidden skipped · 2 iframes not readable
```
`*` rendered only when that phase exists; **never render dead buttons**.

- **Split button:** main segment "Scan" runs `SCAN` immediately with current patterns/scope; chevron toggles the config block only (CSS grid-row transition `0fr→1fr`, `inert` when closed).
- **Select parent node:** `SCOPE_PICK {mode:'scope'}`; label "Picking… (Esc to cancel)"; on `PICKED` set `scan.scope`; Scan disabled while picking. In the page: hover box + badge; **↑/↓ (or scroll wheel with Alt) steps to parent/child**, click confirms, Esc cancels; picks snap from inline elements (`span`, `a`, `b`, `em`, …) to the nearest block ancestor. The Structure tree "Use as scan scope" is the keyboard/touch alternative.
- **Results:** `<details>` per pattern, open when it has items; not-ok groups are non-expandable rows with `reason`. **Expand** → `RESULT_RENDER` (cached by key+format) in a scrollable `<pre>` (`textContent`). Changing the global format re-renders open cards lazily. Download = Blob helper. **No "Output" wording anywhere.**
- `scopeLost` ⇒ clear scope, inline notice "The selected area is no longer on the page". Errors render inline in the card.
- Accessibility: chevron `aria-expanded/aria-controls`; focus returns to the Scan button after a scan; keyboard path for every action.

#### 5.9.2 Styling
Use only defined tokens (read `panel.css`; add a **unit check** that parses `panel.css` and asserts every `var(--x)` is declared). Left-aligned content. Primary Scan button: solid `--pri`, white text, visible focus ring. `<pre>` uses `--bg`/theme tokens, no hard-coded light fallback. Delete duplicate rule blocks.

#### 5.9.3 Build tab (P4) — one workbench, not a wizard

```
Scope     main › section#thread › ol      [⬆][⬇] [Pick parent…] [Pick samples…]
          37 items · item match: class ◂──●──▸ children
Pattern   (•) Custom ( ) List ( ) Chat ( ) Table …                          [Scan this node]
Fields    name | from | attr | fill | sample (UI only)
          role | [data-…author] | attr | 100% | user
          [+ Add field (click on page)]            [Convert auto fields → explicit]
Preview   first 5 rows · 37 rows · matched by id   (page items outlined)
Save      name [        ]  applies to [this path ▾]                          [Save recipe]
▸ Structure (DOM tree)   ← collapsed fallback for precise picking
```

---

## 6. Phases

General rules: tests first; `npm test` green at every commit; small commits; no new runtime deps; update MASTER_SPEC and DECISIONS in the same change; stop at the gate. Gate commands: `npm test`, `npm run test:inspect` (+ `npm run fixtures` if fixtures changed). Report before/after counts.

### Phase 0 — Baseline (tests only)

| Task | Detail |
|---|---|
| T-0.1 | Read the docs; summarise scope in ≤10 lines; list conflicts with this plan (including any conflict with `SCAN_VISION.md`). |
| T-0.2 | `npm install && npm test && npm run test:inspect`; record exact counts (docs claim 47 unit + 1 panel + 11/11 fixtures + 15/15 inspect). |
| T-0.3 | Verify F-01…F-15 and N-01…N-10 (confirmed / not / differs, with file+line). Check specifically: F-05; that `L.arbitrate`'s signature/thresholds (`40-arbitrate.js`, not reviewed) can take `opts.relaxed`; how `visit` propagates `bp`/`inContent`; whether Phase-0 detectors behave with `snapshot({root})`. |
| T-0.4 | Add **failing** tests: (a) whole-page List scan returns ok on a list fixture; (b) scanning leaves `L.inspect.info().active` false; (c) panel: Clear scope updates the label immediately; (d) CSS-token check; (e) **containment property test** (every Hit.nodeId inside the scope subtree) for each built-in pattern; (f) panel smoke: tab activation does **not** call `scripting.executeScript`. |

**Gate P0:** verified-findings table + list of intentionally red tests. Stop.

### Phase 1 — Engine core (additive; the existing panel keeps working)

| Task | Files | Detail / acceptance |
|---|---|---|
| T-1.1 | `35-inspect.js` | Fix F-05 (`g.fields.image`). Fixture first. |
| T-1.2 | `00-namespace.js` | `u.stableClasses`, `u.isStableId`, `u.cssEscape`; unit tests (real words, `col-6` kept raw, hashed dropped, ids like `thread-98231` rejected). |
| T-1.3 | `10-snapshot.js` | `opts.root` with seeding (§5.6.1). **Equality test** across all fixtures × patterns. |
| T-1.4 | `30/31/32`, `40`, `20` | `ctx.relaxed` support; `arbitrate(snap, cands, {relaxed})` marks `weak`; `mineRepetition(snap,{relaxed})`. Default behaviour unchanged ⇒ the 11 fixtures stay green. |
| T-1.5 | `35/36/37`, `44-pattern-core.js` (new), `content-files.js` | Pattern contract v2 (§5.3): patterns take `ctx.snap`; merge-on-register; `find/build/rebuild` for article/table/list/text/chat/contact; legacy `detect` retained. Tests: containment property (T-0.4e) green; **`rebuild(ctx, find(ctx)[0]) ≡ build(find(ctx)[0], ctx)`** data for every fixture × pattern; legacy `detectPatterns` tests still pass. |
| T-1.6 | `60-output.js` | §5.6.2; unit for `previewText` (≤400 chars, no HTML), `renderData`, `availableFormats`, record-list Markdown fallback. |
| T-1.7 | `64-scan.js` (new) | §5.4 `L.scanner` + `L.scanCtx`; **no** `L.inspect.start()`. Tests: groups for article/table/list/text on fixtures; scope restricts and contains; `scopeLost` on removed element; `active` unchanged; stale `scanId` rejected. |
| T-1.8 | `70-overlay.js`, `90-bridge.js` | Pick mode `scope` **without an inspect session** (hit-test from `event.composedPath()[0]`, label from raw Element via the shared label function), ↑/↓ stepping, block snapping, Esc, badge; reuse the existing capture-blocking list. Add messages `SCAN`, `SCAN_CTX_GET`, `SCOPE_PICK`, `PICKED`, `PICK_CANCELLED`, `SCOPE_FROM_NODE`, `SCOPE_CLEAR`, `RESULT_RENDER`. **Legacy messages stay** until P2. `inspect-smoke`: pick scope → no click-through, Esc cancels, overlay removed. |
| T-1.9 | `scripts/perf.mjs` | Add whole-page vs scoped scan timings at 1k/5k/25k; report (a 25k whole-page scan is still one long task through the snapshot — record it, do not claim to fix it). |

**Gate P1:** unit/fixtures/browser smoke green; new tests green; the old panel still works; containment, equivalence and snapshot-equality tests green; perf numbers in the report. Stop.

### Phase 2 — Scan tab UI, deletions, docs

| Task | Files | Detail / acceptance |
|---|---|---|
| T-2.1 | `panel.css`, `index.html` | Fix F-04 per §5.9.2; new classes `scan-split scan-go scan-chev scan-config grp res-card res-pre`; CSS-token unit check green. |
| T-2.2 | `state.js`, `panel.js`, `api.js` | §5.8: `initial()`, `rev`, visible-view paint with focus/scroll preservation, `stage0` without injection (T-0.4f green), remove `pageScan*`/`scanScope*`. Tests: any `scan.*` change repaints; hover does not bump `rev`; hidden views not rendered; focus survives a repaint. |
| T-2.3 | `views/page.js`, `views/scan-results.js` (new), `panel.js` actions | §5.9.1. Actions: `scanToggle` (class toggle, no `set`), `scanRun`, `scanPick`, `scanClearScope`, `scanTogglePattern`, `scanSetFormat`, `scanExpand`, `scanCopy`, `scanDownload`. Panel smoke: one click → grouped results; expand → text; copy; scope pick/clear; no tab change; no "Output" string in the DOM; coverage line; empty-state text. |
| T-2.4 | `views/map.js`, `index.html` | Tab renamed **Structure**: lazy tree + selection sync + "Use as scan scope" (`SCOPE_FROM_NODE`). Remove pattern checkboxes, Apply, Send to Output, the Inspect header toggle. Entering Structure starts the inspect session; leaving stops it. Tabs: Scan / Structure. |
| T-2.5 | deletions | Delete `39-scan.js`, `views/output.js`, `test/e2e.mjs`, legacy `detect` adapters, `L.inspect.scanAll`, `L.inspect.detectPatterns`, all messages in §5.7 "Removed", dead panel state/actions (F-02, F-10); migrate tests to `find`. `Object.hasOwn` dispatch (N-10). |
| T-2.6 | background | Optional `PREFS_GET/SET` for default patterns. |
| T-2.7 | docs | Copy `SCAN_VISION.md` → `docs/SCAN_VISION.md`; update README, AGENTS (Current state + Direction), VISION (mark Page-tab superseded), ARCHITECTURE (§2, §4.1, §6), MASTER_SPEC, DECISIONS. |

**Gate P2 (= `SCAN_VISION.md` success criteria):** (1) Page tab shows only site info, recipes (if any), Scan; (2) one-click scan from collapsed state; (3) full configuration in expanded state (pick parent, patterns, Go; Go disabled with none checked); (4) inline results grouped by pattern with per-pattern reasons; (5) no Output tab or text; (6) scanning never changes inspect `active`, exactly one scan implementation in `src/`; (7) panel open/tab switch injects nothing; (8) all test suites green, counts reported. Stop.

### Phase 3 — Locator, Extraction, Run, Recipes

| Task | Files | Detail / acceptance |
|---|---|---|
| T-3.1 | fixtures | `make-fixtures.py` variants for article/table/list/chat: (a) classes renamed, (b) extra wrapper, (c) banner inserted before target, (d) siblings reordered, (e) target removed, (f) scope inside open shadow DOM, (g) dynamic-looking ids (`thread-98231`). Expectations: (a)–(d) resolve (tier may differ), (e) `broken`, (f) `make` reports unsupported, (g) id not used as an anchor. |
| T-3.2 | `45-locator.js` | §5.5.1. Unit: make→resolve over every variant; ambiguity case (two identical siblings) sets `ambiguous`; `relative()` round-trips; locator ≤1 KB typical; no node ids. |
| T-3.3 | `47-extraction.js` | `compile` + `validate`. Unit: every built-in result compiles; JSON has no `nodeId`/`itemIds`; validate rejects oversize/ill-shaped; item `sel` match set equals the scanned items (`exact:true`) on fixtures; non-direct chat items use a descendant selector. |
| T-3.4 | `64-scan.js` | Items now carry `extraction` (compiled during the scan, before the snapshot is released). |
| T-3.5 | `62-run.js`, bridge | §5.6.3; `EXTRACTION_RENDER`, `RECIPE_RUN`. **Consistency test (required):** for every fixture × pattern `run(compile(result))` data deep-equals data from `result`. Variants (a)–(d) ⇒ `ok`/`degraded` with baseline data; (e) ⇒ `broken`. Run never mutates the page (DOM serialisation unchanged). `validate()` is applied again in the content script to any received extraction. |
| T-3.6 | `service-worker.js` | Recipe v2 + v1 migration; `SCHEMA_MATCH` by `match.host` + glob; `lastRun`; delete handler. Stubbed-storage unit tests (save/list/match/delete; v1 preserved and flagged). |
| T-3.7 | panel | **Save recipe** on result cards (name `hostname — label`; applies to: this path / whole site). Page-tab recipe list: **Run** (inline cards + health line "Matched by id" / "Needs repair: matched by structure"), **Delete**, `lastRun` update. Hide when empty. Non-destructive "Needs repair" state; **Refine** appears only in P4. |
| T-3.8 | docs | MASTER_SPEC (Extraction/Recipe/health), ARCHITECTURE, DECISIONS, **PRIVACY** (recipes store structural selectors, short anchor strings and class names locally; deletable). |

**Gate P3:** all of the above; `npm run perf` note comparing `{root}` vs full snapshot and scan timing. Stop.

### Phase 4 — Induce + Build (+ Structure v2)

| Task | Files | Detail / acceptance |
|---|---|---|
| T-4.1 | fixtures | `chat-alternating.html` (user/assistant bubbles with different classes), `chat-single-class.html`, `chat-nested-roles.html` (non-direct items), `feed-nested.html`, `history-sidebar.html` (short link-only items under a date header) + variants. Expectation: built-in Chat finds nothing on `chat-alternating` **before** induce (documented gap), `induce` finds it after. |
| T-4.2 | `20-segment.js` | §5.6.5; unit per level and ladder counts. Defaults unchanged. |
| T-4.3 | `46-induce.js` | §5.6.4. Unit: (i) two samples on `chat-alternating` ⇒ scope = container, level `children`, role/text fields; (ii) one sample ⇒ ladder contains the right `up`; (iii) constants dropped; (iv) extraction passes `validate` and `run` reproduces the samples; (v) nested/non-direct items; (vi) history-sidebar works with the date header excluded by `item.sel`. |
| T-4.4 | `70-overlay.js`, bridge, `api.js` | Pick modes `sample` (Shift-click add, Enter confirm, Esc cancel) and `field`; `highlight(extraction)` (cap 300, rAF-throttled, cleared on stop/navigation); `INDUCE`, `EXTRACTION_PREVIEW`, `HIGHLIGHT`, `SAMPLES_CLEAR`. |
| T-4.5 | `views/build.js`, panel | §5.9.3; preview refresh debounced 250 ms; **Convert auto fields → explicit**; shared `scanCtx` scope across tabs. |
| T-4.6 | `views/scan-results.js` | Enable **Refine ▸** (loads the extraction into the Build draft) and **Build manually ▸** on not-ok groups. |
| T-4.7 | Structure v2 | Tree reads the **live DOM lazily** (WeakMap element→session id, visibility via `checkVisibility`), so the full-page inspect snapshot and `35-inspect` session code are deleted; the tree becomes the collapsed Build section. |
| T-4.8 | docs | MASTER_SPEC, ARCHITECTURE, DECISIONS, README (Build workflow with the chat example). |

**Gate P4:** in the browser smoke: scan finds no chat → Build manually → pick two bubbles → preview shows all messages and highlights them → save → reload fixture → recipe Run returns identical data. Stop.

### Phase 5 — Power features (plan only; each needs its own mini-spec and owner decision)

Candidates in priority order: (1) field editor polish and more transforms; (2) **repair UI** for `broken`/`degraded` recipes (re-pick scope, keep fields); (3) **sticky context fields** (date headers like "Today"/"Previous 7 days" applied to following items); (4) virtualised/infinite lists via user-triggered *collect while scrolling* (separate run mode, explicit consent, yields, stop condition — scrolling is page state, so decide against charter rule 1 first); (5) pagination; (6) open shadow DOM locators (path with shadow hops) and same-origin iframes; (7) recipe export/import (size-capped, validated, never evaluated); (8) `regex` transform with caps.

---

## 7. Test plan

| Layer | File | Coverage by phase |
|---|---|---|
| Unit | `test/unit.mjs` | P0 red tests; P1: stable-class/id helpers, snapshot `{root}` equality, `find/rebuild` equivalence, containment, scanner, output helpers; P2: CSS tokens; P3: locator variants, compile/validate, run consistency, stub-storage recipes; P4: segment ladder, induce scenarios. Existing no-network/no-eval source scan stays. |
| Fixtures | `make-fixtures.py` → `npm run fixtures` | whole-page list; locator/run variants (P3); chat/history/feed fixtures (P4). Generate **all** fixtures from the script (`patterns-scope`, `chat-thread`, `contact-footer` currently are not). |
| Panel smoke | `test/panel.mjs` (mock `chrome.*`) | Scan one-click; config toggle; pick/clear; grouped results; expand/copy/download; no "Output"; `rev` repaint; focus/scroll preserved; no injection on tab activation; save/run recipe (P3); Build flows (P4). |
| Browser smoke | `test/inspect-smoke.mjs` | pick scope without click-through; Esc; scan leaves inspect inactive; scan→render; recipe replay after reload (P3); sample pick + highlight + save (P4). |

jsdom has no layout/`checkVisibility`: no geometry or timing claims from it; timings come only from `npm run perf`.

---

## 8. Decisions to log (next free D-numbers)

- **D1** Extraction/Recipe as the single model; Scan and Build are producers, Run the only consumer; built-ins replay via `rebuild()`.
- **D2** Scan = scoped Phase-0 detectors + per-pattern `find()`; supersedes D-023's "legacy pipeline" framing for article/table/record_list (the pipeline is now a Scan dependency; `L.analyze` stays fixture-only).
- **D3** Pattern contract v2 (`find/build/rebuild`, snapshot-explicit, merge-on-register); `withSnapshot` not introduced.
- **D4** File slots: `44-pattern-core`, `45-locator`, `46-induce`, `47-extraction`, `62-run` (not the reserved `55-schema`, which would sit below `60-output`), `64-scan`; delete `39-scan`.
- **D5** Inspect/Structure demoted to a pick/fallback instrument; Output tab and Map-as-destination removed; live-DOM tree in P4.
- **D6** Recipe v2 shape, host matching, v1 migration (preserve, flag, never delete).
- **D7** Shadow-DOM scopes unsupported for save/replay in v1 (Scan works); iframes out.
- **D8** Health statuses and locator tiers are rule-based and uncalibrated; the UI shows tier/reason text only.
- **D9** Persist structure only: no sample values; closed transform set; `regex` deferred.
- **D10** `stage0` never injects.
- **D11** Segment ladder explicit (`opts.match`), defaults unchanged.
- Any deviation found during VERIFY steps.

Docs to update at the end of each phase: `README.md`, `AGENTS.md`, `docs/VISION.md`, `docs/MASTER_SPEC.md`, `docs/ARCHITECTURE.md` (§2, §3 layers incl. `44`, §4, §5 extension points: new patterns implement `find`+`rebuild`, §6), `docs/BUILD_PLAN.md`, `docs/PRIVACY.md` (P3).

---

## 9. Conventions and gotchas

- Do not rebuild a node you want to animate; toggle classes and mirror state without `set()`.
- Use `inert` on the collapsed config block (manifest minimum Chrome 116).
- Check how `h()` treats boolean attributes and `on*` props before relying on them; all page text through `textContent`.
- Selectors from storage are untrusted: try/catch, length caps, `CSS.escape`.
- Locator stability: anchors and test attributes first; never use hashed/utility classes; never persist page text beyond the 8-hex hash and short anchor strings.
- Snapshot `depth` is relative to the snapshot root; use DOM depth for fingerprints.
- SPA: `scanCtx` clears when `scopeEl` disconnects; the panel resets on tab update via `set({...initial(), tab})`.
- Performance: idle = nothing; scan = one snapshot of the scope, yield between patterns; replay = scope subtree; highlight cap 300.
- Layering: keep `chrome.*` to the allowed files; update `content-files.js` for every new file.
- Legacy Phase-0 pipeline pieces `50-classify`, `80-pipeline`, `L.output.render*` remain fixture-only; do not extend them.

---

## 10. Open questions (recommended defaults; the agent proceeds with these unless the owner objects)

| # | Question | Recommended default |
|---|---|---|
| 1 | Recipe URL matching | Host + glob path (`*`, `**`), query ignored; add query matching only on demand |
| 2 | Virtualised lists | P5, user-triggered "collect while scrolling" with explicit consent; until then show a coverage hint when a scope scrolls far beyond its rendered items |
| 3 | iframes / shadow DOM | Out of v1 for save/replay; Scan works inside open shadow DOM; coverage line reports unreadable iframes |
| 4 | Multi-extraction recipes | One **Run** per recipe returning one card per extraction; merged export later |
| 5 | Recipe export/import | P5 |
| 6 | Default patterns | Article, Table, List, Text; Chat/Contact opt-in |
| 7 | Keep the per-site visit profile (`SITE_*`, "visit #N")? | Cut it (it counts inspect sessions, not visits, and is a small browsing-history store); keep only if `SCAN_VISION.md` requires it |
| 8 | Licence scope (MIT vs engine-only) | Owner decision — unresolved in docs; do not default |

---

## 11. Report template (end of every phase, then stop)

```
Phase N report
- Built: …
- Verified findings (P0) / changed behaviour (others): …
- Tests: unit X/Y, panel smoke X/Y, fixtures X/Y, inspect smoke X/Y (before → after)
- Failed / flaky and why: …
- Deviations from the plan (with DECISIONS ids): …
- Deferred: …
- Perf numbers (if measured): …
- Docs updated: …
- Proposed next step: …
```
Do not begin the next phase until the owner replies "next".
