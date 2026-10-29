# Lasso — Master Specification

Version 0.2 · Milestone A · Status: living document (update it in the same commit as any behaviour change)

> **Direction update — 2026-10-27 (Milestone A revised):** the target UX is **inspect-first**. The user points at any part of a page, chooses checked patterns (Text default; Article / Table / List / Text, plus preview Chat/Contact), runs only those patterns on that selection, then sends a single result or reviews collapsed multi-result cards. Configure/save/replay is Milestone B. See `docs/VISION.md`. Milestone A (per-tab inspect, lazy DOM tree, scoped patterns, Output preview) is built; save/replay is Milestone B. Sections §5–§7 below describe the old Phase 0 auto-detect baseline, which is retained for fixtures but is no longer the default UI. The inspect message protocol is in §9.

## 1. Vision and positioning

**Lasso is a local-first Chrome extension that turns any web page region into clean JSON, CSV or LLM-ready Markdown, and remembers how it did it.**

You point at a page once. Lasso detects the article, table or listing, lets you correct it, and saves a *schema* for that site. Every later visit is one click, offline, free, and deterministic. When a site changes, Lasso proposes a repair instead of silently breaking.

**One-line pitch:** *Teach a page once. Extract it forever. Nothing leaves your browser.*

**Why it can win (assessment, not verified for every product):** one-shot scrapers do not remember; AI scrapers pay an LLM or a cloud service on every page; selector recipes are brittle and unrepaired. The unoccupied position is *local + deterministic replay + healing + agent-callable output*. We do not compete on crawling infrastructure or anti-bot handling.

## 2. Users and jobs to be done

| Segment | Job | Success looks like |
|---|---|---|
| **Beachhead: builders feeding LLMs/agents** | "Give me this page as clean Markdown/JSON I can paste into a prompt or pipeline." | One click, correct body, no nav/cookie junk, token count shown. |
| Data pullers (analysts, researchers, ops) | "Turn this table/listing into a spreadsheet." | CSV opens correctly in Excel, columns are right, repeat visits are one click. |
| Agent developers (Phase 4+) | "Let my agent call a saved extraction instead of re-prompting a model." | A schema is callable by name from a local CLI/MCP bridge. |

Non-goals: crawling at scale, bypassing logins/paywalls/bot protection, proxies, cloud scheduling, general browser automation.

## 3. Charter (non-negotiable rules)

1. **Never mutate the page** except our own closed shadow-root overlay host (`data-lasso-overlay`). Overlay is removed on `DESTROY` and on re-injection.
2. Detectors emit **scored candidates with evidence**. Scores rank; they are not probabilities. No fixed confidences.
3. Node ids are **per run only**. Persistence (Phase 1+) uses locator sets, never ids.
4. **One locator module** builds and resolves selectors (Phase 1). No other file generates selectors.
5. Anything uncalibrated is labelled `calibrated:false` in data and "estimate" in UI.
6. Every extraction returns **diagnostics**. Repairs are **proposed, never applied silently**.
7. **No network.** No `fetch`, XHR, WebSocket, `eval` or `new Function` in shipped code (enforced by a test and by CSP `connect-src 'none'`). Any future network feature is opt-in, user-keyed and documented here first.
8. Imports are untrusted: validate shape, cap size, never execute.
9. The engine (`src/content/*`) uses `chrome.*` only in the overlay and bridge files.
10. Page-derived strings reach the UI only via `textContent` (see `src/sidepanel/dom.js`). Never `innerHTML`.
11. **Storage only in the background worker.** The panel and the page never touch `chrome.storage`.
12. Record non-trivial decisions in `docs/DECISIONS.md` with the alternatives considered.

## 4. Scope by phase

| Phase | Theme | Headline capability | Status |
|---|---|---|---|
| **0** | Foundation MVP | Detect + extract article / table / listing → JSON, CSV, Markdown; overlays; region map; site profile | Retained baseline |
| **0.5** | Inspect-first A | Per-tab inspect, lazy DOM tree, breadcrumb, checkbox picker (Text default), selected-only scoped Article/Table/List/Text + preview Chat/Contact, single Send and multi-result Output cards | **Implemented** (jsdom/panel smoke; real-browser gate pending) |
| 1 (Milestone B) | Fields, save & replay | Field/scope config, save a region as a per-site schema, replay it, health status | Planned |
| 2 (Milestone C) | Teaching polish | Field-level pick, transforms, sibling inference polish, onboarding | Planned |
| 3 | Robustness & coverage | Healing proposals, more detectors, pagination/infinite scroll | Planned |
| 4 | Agents & batch | Local CLI/MCP bridge, batch URL lists | Planned |
| 5 | Assist & sharing | Optional BYOK LLM assist (authoring time only), schema packs | Planned |
| 6 | Scale | Edge/Firefox, i18n, teams | Later |

Details, tasks and exit gates: `docs/BUILD_PLAN.md`.

## 5. Functional requirements

### Phase 0 (implemented)

| ID | Requirement |
|---|---|
| F0-1 | Clicking the toolbar icon opens a side panel for the active tab. |
| F0-2 | **Stage 0 (light pass):** show site name, hostname, title, favicon, quick counts (article/table/h1/form) with no overlays and no full scan. Look up the site profile in the background store; show "first visit" or "visit #N". |
| F0-3 | **Quick extract:** run the full pipeline (snapshot → segment → detect → arbitrate → classify), pick the highest-scoring region, show it in Output. Works on a first visit with no setup. |
| F0-4 | **Edit mode toggle:** run the scan with overlays (kind-coloured boxes with `kind · score%` chips) and open the Map tab. Turning it off removes all overlays. |
| F0-5 | **Map tab:** region tree (nested regions indented), score, preview, "why this score" evidence table, alternatives count, Extract button; selecting a region highlights and scrolls to it on the page; clicking a chip on the page selects it in the panel. |
| F0-6 | **Output tab:** choose region and format (Markdown, JSON, CSV), preview, character count and token estimate, Copy, Download. CSV offers an Excel-friendly UTF-8 BOM and neutralizes spreadsheet formulas by default. |
| F0-7 | **Page-type distribution** (top 4 shown) with the reasons on hover; labelled as estimates. |
| F0-8 | **Graceful failure:** restricted pages (chrome://, Web Store), missing tab permission, navigation during scan and detector exceptions each produce a clear message, never a blank panel. |
| F0-9 | **Site profile store:** `{name, firstSeen, lastSeen, visits, lastKind}` per hostname, capped at 500 sites, written only by the background worker; the Page view offers **Clear all site history**. |

### Phase 1 (specified, not built)

| ID | Requirement |
|---|---|
| F1-1 | "Save as schema" on any region: name, site/path scope, kind, container locator, item locator (lists), fields with locator sets and transforms. |
| F1-2 | Matching on the current URL ranks schemas: exact path pattern > domain > page kind; shows "why matched". |
| F1-3 | Schema runner returns data **and** diagnostics: per-field match counts, health `healthy | degraded | broken`. |
| F1-4 | Schemas list: run, rename, delete, export/import as validated JSON. |
| F1-5 | All-site host access is already declared; add an auto-suggest badge on revisit only if the owner wants it (no extra permission). |

## 6. UX specification

### 6.1 Stages
- **Stage 0 — light pass** (panel open, tab change, page load complete). Cheap, no overlays. Shows what is known about the site. On a first visit it offers **Inspect**; Quick extract is legacy and not in the default UI.
- **Inspect (Milestone A)** — the active tab enters picker mode; Map shows a lazy DOM tree; hover/selection sync; right-click or Map shows inline pattern checkboxes with Text checked by default; **Detect selected** runs only checked patterns on the selection. One result shows a description with **Send to Output**; multiple results open Output as collapsed cards. Markdown/JSON/CSV preview, copy/download. Per-tab; navigation/reload/tab close ends the session.
- **Stage 1 — match** (Phase 1) saved schemas for this URL, ranked, one-click Run.
- **Stage 2 — Edit mode** aggressive scan, overlays, region map.
- **Stage 3 — teach** (Phase 2) pick a region on the page or in the map, infer fields, save.

### 6.2 Panel states and messages
| Situation | Behaviour |
|---|---|
| No tab / restricted URL | Banner: Lasso can't run on browser pages or the Web Store. |
| No access to this tab | Banner: check Chrome’s site access setting for Lasso, or open a regular web page. Restricted browser pages cannot be inspected. |
| Page navigated mid-scan | "The page changed or is still loading. Re-scan to continue." |
| No regions found (legacy) | Message + suggestion to use Edit mode; inspect mode is the default path now. |
| No element selected (inspect) | Map prompt to click an element on the page or in the tree. |
| Inspect active on another tab | That tab keeps its session; the new tab shows Inspect off; returning restores tree/selection/result/stats. |
| Navigation/reload/tab close | Session ends; overlay host and listeners are removed. |
| Detector threw | Scan continues; panel notes which detector failed. |
| Truncated (node cap) | Shown in the scan line. |

### 6.3 Accessibility and appearance
Light/dark via `prefers-color-scheme`; all controls are real `button`/`select`/`label` elements; colour is never the only signal (chips carry text). RTL page content must round-trip in output (see §12). The tree uses `role=tree/treeitem`, roving focus, arrow keys and Enter/Space; the overlay picker is an ARIA dialog with native checkboxes and a Detect button; the Map checkboxes are the touch/keyboard alternative to right-click.

### 6.4 Inspect-first (Milestone A)
- Header toggle: `aria-pressed`, per active tab, disabled on restricted URLs.
- Map: lazy tree (`400` children per node), breadcrumb, selected preview, inline pattern checkboxes with Text default, a **Detect selected** action, session stats. Selecting a node never probes patterns.
- Page: site info + Inspect call to action; no snapshot until Inspect.
- Output: inspect result preview; Markdown/JSON/CSV, chars/token estimate, Copy/Download, CSV BOM. Fields/scope/save are Milestone B.
- Overlay: closed shadow root, `data-lasso-overlay`; hover/selection boxes, badge, custom menu; `destroy()` removes host/listeners. No page mutation outside the host.
- Patterns: `L.inspect.registerPattern({id,label,order,detect,build})`; built-ins in `35-inspect.js`, Chat in `36-pattern-chat.js`, Contact in `37-pattern-contact.js`. Chat reads common role attributes/classes and falls back to repeated message blocks; Contact reads only the visible footer/imprint snapshot for name, emails, phones, addresses and links; hidden and `aria-hidden` details are ignored. Both are heuristic previews and must not be described as site-specific integrations.
- Access: required `http://*/*` + `https://*/*` host permissions provide all-site web access, so the panel can inject after an extension reload without a per-site prompt. The engine is still injected on demand; there are no content scripts. `activeTab` remains as a fallback on restricted/site-limited tabs.

## 7. Detection specification (as implemented in Phase 0)

### 7.1 Snapshot (`10-snapshot.js`)
- One pre-order pass from `document.body` over **live** elements; ids are array indices, so **id order = document order**.
- Skipped during traversal: `script, style, noscript, template, head/meta/link/title`, `hidden`/`inert`, computed `display:none`, `opacity:0`, `content-visibility:hidden`. `visibility:hidden` elements keep a transparent wrapper so a deliberately visible descendant is not lost; their own text is skipped. Counted in `hiddenSkipped`.
- Visibility is decided by the native `Element.checkVisibility({checkOpacity, checkVisibilityCSS, contentVisibilityAuto})` where it exists (Chromium), with `getComputedStyle` as the fallback (jsdom) and as the disambiguator for hidden cases. This keeps the snapshot off its per-element computed-style hot spot (D-024, §12).
- Opaque (counted, not entered): `iframe, object, embed, canvas, video, audio, svg`. Open shadow roots are traversed (via `<slot>` assignment where present).
- Caps: 25,000 nodes, depth 80 → `truncated:true`, never an exception.
- Text nodes keep their original whitespace in a parallel `rawParts` list for `<pre>` subtrees. `L.textOf` still collapses for prose and stats; `L.rawTextOf` feeds code fences so indentation and line breaks survive.
- Stats are computed from **full** subtree text bottom-up: `textLength, wordCount, linkTextLength, linkCount, linkDensity, imageCount, headingCount, h1Count, paragraphCount, tableCount, listCount, codeCount`.
- **Boilerplate score `bp` (0..1)**, inherited down the tree, never used to delete: landmarks/roles (nav .85, aside .7, footer .8 / .5 inside article, header .7 / 0 inside article, dialog .85) and class/id **whole-token pieces** (`cookie`, `consent`, `newsletter`, `sidebar`, `ad`, `popup`, `modal`, `share`, `related`, …). `sponsored-by-author` and `headline` do not match `ad`. State classes on `BODY`/`HTML` (for example `modal-open`) are ignored so they cannot poison the whole document.
- Metadata: title, canonical, OG, meta, JSON-LD (defensively parsed, flattened `@graph`).

### 7.2 Segmentation (`20-segment.js`) — repetition mining
For each parent with ≥3 element children (callers may pass a lower `minItems`; Chat uses 2), cluster children by fingerprint: first try *class+shape* (depth-2 tag shape + stable class tokens, hashed/CSS-in-JS tokens removed, digits normalised), then *shape only*. A group needs ≥3 members and a dominant-cluster ratio ≥0.6. Each group records field-presence fractions (link, image, heading, price, date), average item text and link density. Parents `TABLE/TBODY/THEAD/TFOOT/TR/SELECT/DL` are excluded.

### 7.3 Detectors (all scores = clamp(Σ weight × value), threshold per kind)
**Article** — container found by Readability-style scoring (each paragraph-like node adds `1+min(len/100,3)` to its parent and half to its grandparent; the best link-density-adjusted container with ≥300 chars of prose wins), then refined (climb to a semantic `<article>` that adds little prose; climb ≤4 levels to include the `h1`; absorb ≤3 wrappers that add <8% prose and have no boilerplate children).
Weights: prose .30 (chars/2500) · paragraph-like blocks .15 (n/6) · semantic .12 (`article` 1, `main` .5) · h1 .08 · JSON-LD article type .08 · byline/time .07 · base .10 · link density −.25 · **repetition −.40** (container is mostly a repeated item list: listing pages are not articles) · boilerplate −.40. **Threshold .45.**
Hints: title (JSON-LD → h1 → OG → `<title>`), author (JSON-LD → `rel/itemprop=author` → byline/author class → meta), published date (JSON-LD → `<time datetime>` → meta), headings outline, lead image, word count. Extra `<article>` elements with ≥1,200 chars of prose become additional candidates. **Inspect selections pass `{scoped:true}`**: title, author, date and image are resolved only inside the selected subtree, never from a page-wide H1/byline/metadata fallback, so selecting a comments block cannot inherit the article's headline. Page-wide detection keeps the metadata fallbacks.

**Table** — semantic `<table>` and ARIA `grid/table`; `role=presentation|none`, <2 rows or <2 columns rejected. Header from `thead` → all-`th` first row → inferred (first row non-numeric while columns below are numeric) → generated `Column N`. `colspan` expands; `rowspan` is ignored (limitation).
Weights: base .10 · header .25 (thead/th 1, inferred .5) · row-length consistency .20 · size .15 (rows/8) · filled cells .10 · numeric share .10 · caption .05 · semantic .05 · nested tables −.30 · boilerplate −.40. **Threshold .45.**

**Record list** — scores repetition groups. Gates: at least one of link/image/heading in ≥60% of items; items avg ≥15 chars or mostly images; groups of 3 need link/image ≥60% **and** avg text ≥40 (avoids feature-card strips); navigation-like groups (link density >.85, short text, no images) dropped. Flavor: `product` (price in ≥50%) · `post` (date + heading) · `result` (link + heading + long text) · `generic`.
Weights: base .05 · count .25 ((n−2)/8) · consistency .20 · richness .25 · item text length .10 · stable classes .10 · nav-like −.30 · boilerplate −.40. **Threshold .50.**
Item fields: title (heading → link text → strong), url, image (`currentSrc` → `src` → `data-src`/`srcset`; skips `data:` placeholders; resolved absolute), price, date (`<time>` or pattern), snippet (first paragraph, else leftover text ≥25 chars).

### 7.4 Arbitration (`40-arbitrate.js`)
Below-threshold candidates are dropped. **Same-kind** candidates on the same or nested elements compete (higher score primary, the rest listed as alternatives); tables are exempt (nested tables are legitimate). **Different kinds nest**: a table inside an article is a child region. Output is a tree in document order with ids `r1…`.

### 7.5 Classification (`50-classify.js`)
Softmax over additive evidence for `article, listing, product_detail, table_page, docs, chat, landing, login, other` using region scores, a central **URL rule table** (each rule carries a sample and a unit test), JSON-LD types, password fields, known chat hosts, code-block count and a sparse-page prior. Output is a distribution with reasons and `calibrated:false`.

### 7.6 Output (`60-output.js`)
JSON (stable shape per kind), CSV (RFC 4180, CRLF, optional BOM added by the panel, formula-prefixed cells starting with `=`, `@`, dangerous `+`/`-`, tab or CR), Markdown (headings, paragraphs, lists, links, images with alt text, language-tagged code fences, inline code safe for backticks, blockquotes, GFM tables; navigation/aside/forms/buttons and boilerplate descendants omitted; underscores are not escaped). Preformatted text keeps its original whitespace inside the fence; nested lists keep their indentation; adjacent anchor pieces are separated by a space; and a user-selected dialog root renders while descendants whose own boilerplate score is high are still omitted. Token estimate = ceil(chars/4), labelled as an estimate.

## 8. Schema and locator specification (Phase 1 design)

```jsonc
{
  "schemaVersion": 1,
  "id": "uuid", "name": "Medium article", "origin": "auto|manual",
  "match": { "domain": "medium.com", "pathPattern": "/@:user/:slug", "pageKind": "article" },
  "kind": "article|table|record_list",
  "container": { "strategies": [ /* ordered */ ], "signature": { "tag": "article", "textHash": "…" } },
  "item": { /* record_list only: locator relative to container */ },
  "fields": [ { "name": "title", "locators": { /* relative */ }, "transforms": ["trim"], "required": true } ],
  "output": { "default": "markdown" },
  "lastRun": { "at": 0, "health": "healthy|degraded|broken", "matched": { "title": 1 } }
}
```
**Locator strategies, tried in order, each verified against the signature:** semantic/ARIA → stable attribute (`data-*`, `itemprop`, `id`) → CSS built from *stable* tokens → structural path → text signature. Attribute and selector values are escaped with `CSS.escape`. Candidates are verified against `locatorSet.signature` (checking tag + text hash/prefix, whitespace/case tolerant) to prevent matching wrong regions on pages with duplicate semantic structures. **Replay:** `L.schema.run` resolves saved `container`, `item`, and `fields` locators directly without re-running pattern auto-detection. **Health:** healthy = container and all required fields resolved with the primary strategy and item drift ≤20%; degraded = resolved via fallback strategy or item count drift >20%; broken = required container or field missing/unresolvable. **Healing:** re-run detection in the schema's container neighbourhood, propose a new locator set with a diff, apply only on user acceptance.

## 9. Message protocol

All messages carry `{lasso:true, type, …}`; replies are `{ok:true,data}` or `{ok:false,error}`.

| Direction | Type | Payload → reply |
|---|---|---|
| panel → page | `PING` | → `{ok, version}` |
| panel → page | `LIGHT` | → stage-0 info |
| panel → page | `INSPECT_START`, `INSPECT_STATE`, `INSPECT_STOP` | inspect session info / stop result |
| panel → page | `INSPECT_TREE {nodeId}` | `{nodeId, children[], total, truncated}` |
| panel → page | `INSPECT_SELECT {nodeId, scroll}` | `{selectedId, selected, breadcrumb, patterns: [], patternsReady: false, stats}` |
| panel → page | `INSPECT_PATTERNS {nodeId, patterns}` | explicit selected-only Detect: `{selectedId, selected, breadcrumb, patterns[], results[], patternsReady: true, catalog, stats}` |
| panel → page | `INSPECT_RENDER_ALL {format}` | `{items: [{pattern,label,summary,ok,reason,rendered}]}` |
| panel → page | `INSPECT_RENDER {format}` | `{text, mime, filename, chars, tokenEstimate}` |
| page → panel | `NODE_SELECTED`, `NODE_HOVERED {id}` | inspect selection / hover sync; selection includes cached results/catalog when ready |
| page → panel | `PATTERNS_DETECTED {results, catalog, ...}` | selected-only detection finished; panel opens Output for multiple results |
| page → panel | `SHOW_OUTPUT` | user clicked Send to Output for a single result |
| page → panel | `PATTERN_ERROR {error}` | a pattern failed to build |
| page → panel | `INSPECT_EXITED` | Escape or overlay exit |
| panel → background | `SITE_GET {hostname}`, `SITE_TOUCH {hostname,name,kind}`, `SITES_CLEAR` | site profile |

The Phase 0 pipeline has **no message entry point**: `L.analyze()` and `L.output.render()` are called directly by the fixture harness (`test/run-fixtures.mjs`), their only consumer. `ANALYZE`, `RENDER`, `FORMATS`, `SELECT`, `OVERLAY`, `DESTROY`, `INSPECT_APPLY` and `REGION_CLICKED` were retired with the region overlay in D-023.

## 10. Storage

`chrome.storage.local`, background worker only. Phase 0 key `sites` (see F0-9). Phase 1 adds `schemas:<id>` and an index; large data later moves to IndexedDB. Everything is local; there is no sync.

## 11. Permissions, privacy, security

- Permissions: required `activeTab`, `scripting`, `sidePanel`, `storage`, and host access to `http://*/*` + `https://*/*`. **No content scripts declared, no web-accessible resources, no network.** Chrome shows the all-sites install warning; the engine is injected on demand and reads a page only after the user starts Inspect.
- Privacy statement (store-ready draft in `docs/PRIVACY.md`): page content is processed locally and never transmitted; the only persisted data is the per-site profile (and, from Phase 1, the user's schemas).
- Threats and mitigations: malicious page content → engine reads only, UI uses `textContent`; malicious imports (Phase 1) → validate + size caps; overlay clickjacking → overlay is pointer-events:none except our own chips; page script interference → engine runs in the isolated world.
- Inspect mode is a hard capture: pointer/mouse press and release (`pointerdown/up`, `mousedown/up`, `auxclick`, `pointercancel`), touch press/release, `click`, `contextmenu`, `dblclick`, `dragstart` and `submit` are `preventDefault()`ed on every target outside the overlay host — including targets missing from the snapshot (truncated documents) — so a page can never navigate or run its own gesture handlers under the picker. Events are untouched whenever inspect mode is off.

## 12. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | Budget: p95 ≤150 ms for the full pipeline at 5,000 elements and no main-thread task >50 ms at 25,000. **Measured** 2026-10-27 with `npm run perf` (headless Chromium, linux x64, 4 CPUs, 7 runs; machine-dependent and not a CI gate):<br>· 1k nodes — snapshot p50/p95 16/27 ms, detect (6 patterns) 16/33 ms<br>· 5k nodes — snapshot p50/p95 77/86 ms ✅ (budget met; p95 ranged 77–100 ms across runs), detect 48/78 ms<br>· 25k nodes — snapshot p50/p95 383/433 ms, detect 299/616 ms ❌ (**longest unbroken main-thread block ~433–616 ms vs the 50 ms budget**)<br>`Element.checkVisibility()` replaced the per-element `getComputedStyle` in the snapshot (§7.1, D-024). The repeatable win is the largest page: 25k snapshot p50 fell from ~467 to ~383 ms (two runs each, tight ranges). At 5k the before/after p95 ranges overlap (99–106 → 77–100 ms), so on this noisy 4-CPU container treat the small-page gain as suggestive, not proven. The snapshot is still one unsliced task, so the 25k budget cannot be met until the walk is chunked — Milestone B, D-024. |
| Footprint | No runtime dependencies; zero build step; unpacked size under 200 KB. |
| Determinism | Same page → same output (tested). |
| Compatibility | Chrome ≥116 (side panel + `openPanelOnActionClick`). Edge likely works; Firefox is Phase 6. |
| i18n/RTL | Output preserves text direction content; UI strings are English in Phase 0 and centralised for translation later. |
| Reliability | A detector exception never fails a scan. |

## 13. Quality and acceptance

- **Fixture corpus** (`test/fixtures`, generated by `test/make-fixtures.py`, self-authored): Phase 0 has 11 pages with `expected.json` (page kind, expected regions, must-contain / must-not-contain, forbidden kinds, hidden-text leak check, body state-class regression). Target 30 by end of Phase 1.
- **Unit tests** cover URL rules, CSV escaping and formula neutralization, hashed-class detection, boilerplate token matching, hidden/visibility text, link density, shadow DOM, caps, non-mutation, determinism, no-network source scan, required all-site host permissions, lazy images, inspect event isolation, and the inspect session/tree/pattern registry including selected-only detection, Chat/Contact and multi-result rendering. A jsdom panel smoke covers the inspect toggle and message-driven UI; the real-browser inspect gate is still required.
- **Phase gates** are listed in `docs/BUILD_PLAN.md`. Product KPIs: install → first successful extract ≤60 s; install → first saved schema ≤3 min (Phase 2); 7-day schema health ≥85%; week-4 retention tracked in the beta.

## 14. Known limitations (Milestone A, honest list)

On a 25,000-node page the snapshot blocks the main thread for ~0.4–0.6 s (measured, `npm run perf`), so very large pages briefly freeze while Inspect maps them; there is no intra-snapshot slicing yet. No field/scope configuration or schema persistence yet; no field-level picking; Chat/Contact are heuristic previews, not per-site adapters; no div-grid tables without ARIA roles; `rowspan` ignored; same-origin iframes and closed shadow roots are not entered; no pagination/infinite scroll; infinite-scroll pages only see what is loaded. An inspect article selection without its own `<h1>` reports no title; Lasso does not borrow the page headline from outside the selection. Milestone A container picking, the checkbox picker, single Send gate and multi-result cards are covered by unit/panel-smoke tests, but **the inspect overlay and picker have not yet been exercised manually in a real Chrome window** (next gate: `docs/BUILD_PLAN.md` §1.1).

## 15. Risks

| Risk | Mitigation |
|---|---|
| Web Store review friction | Clear single purpose, no network, written permission justifications for all-site access (BUILD_PLAN). |
| Sites change often | Locator sets + health + proposed repairs (Phase 1/3). |
| Detection quality on the long tail | Fixture corpus growth, evidence-based scoring, user override in Phase 2. |
| ToS / legal concerns about scraping | User-initiated, local, no bypass, stated plainly in onboarding. |
| Solo bandwidth | Phased scope, no build tooling, agent-friendly docs. |
| Fast followers | Open-core engine, community schema packs, benchmark transparency. |

## 16. Glossary

**Region** a detected area of a page (article, table, record list). **Candidate** a detector's scored proposal. **Evidence** the weighted signals behind a score. **Schema** a saved per-site recipe. **Locator set** ordered strategies to re-find an element. **Health** result of replaying a schema. **Stage 0–3** the progressive detection flow in §6.1. **Boilerplate score** a 0..1 flag for nav/ads/consent/sidebars that is scored, never deleted.
