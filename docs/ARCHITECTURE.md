# Lasso — Architecture

> **Direction update — 2026-10-26 (Milestone A implemented):** the target is inspect-first. Milestone A adds a picker, a live DOM-tree view and scoped patterns, and retires page-wide auto-analysis from the default UI; locators/schema store/save/replay are Milestone B. See `docs/VISION.md` §10. The legacy Phase 0 pipeline remains below for fixtures and the paused e2e harness.

A standard Chrome MV3 extension: **no bundler, no framework, no runtime dependencies.** Load the folder unpacked and it runs. Structure is progressive: each phase adds files in well-defined slots instead of reshaping what exists.

## 1. System context

```
┌──────────────────────────── Chrome ─────────────────────────────┐
│                                                                   │
│  Side panel (extension page, ES modules)        Service worker    │
│  src/sidepanel/*                                src/background/*  │
│  ├─ views: page | map | output                  ├─ site profile   │
│  ├─ state.js (observable store)                 └─ (Phase 1+)     │
│  └─ api.js ──────────────┐                         schema store   │
│        ▲                 │ chrome.tabs.sendMessage       ▲        │
│        │ runtime msgs    ▼                               │        │
│        │          ┌─────────────────────────┐   chrome.runtime    │
│        │          │ Web page (isolated world)│   .sendMessage     │
│        └──────────┤ src/content/* (engine)  ├───────────┘        │
│ NODE_SELECTED etc │ classic scripts, injected│                    │
│                   │ on demand via scripting  │                    │
│                   └─────────────────────────┘                    │
└───────────────────────────────────────────────────────────────────┘
```

**Why classic scripts for the engine, not ES modules:** `chrome.scripting.executeScript` injects classic scripts. Loading modules into a page would need `web_accessible_resources`, which exposes extension files to every site. Classic scripts + a numbered file order give modularity with zero exposure and zero build. Trade-off: files communicate through one namespace (`globalThis.Lasso`), so naming and layering discipline matter (§3).

**Why on-demand injection:** Lasso declares required `http(s)` host access (D-018), so it can inject into any regular tab without a per-site prompt. It still declares **no content scripts** and injects the engine only when the user opens Lasso and starts Inspect. This trades the strongest minimal-permission story for a smooth post-reload flow; the no-network and storage boundaries are unchanged.

## 2. Repository layout

```
lasso/
├─ manifest.json
├─ README.md · LICENSE · AGENTS.md
├─ assets/icons/                   16/32/48/128 px
├─ docs/                           MASTER_SPEC · ARCHITECTURE · BUILD_PLAN · DECISIONS · PRIVACY
├─ src/
│  ├─ background/service-worker.js     panel behaviour, ALL storage
│  ├─ shared/content-files.js          ordered injection list (single source of truth)
│  ├─ sidepanel/
│  │  ├─ index.html · panel.css · panel.js   bootstrap + actions
│  │  ├─ api.js  state.js  dom.js            messaging · store · safe DOM builder
│  │  └─ views/{page,map,output}.js          one file per tab
│  └─ content/                          ENGINE (classic scripts, load order = filename order)
│     ├─ 00-namespace.js   registries (detectors, formats) + utilities
│     ├─ 10-snapshot.js    live read-only model, stats, metadata, light()
│     ├─ 20-segment.js     repetition mining, field vectors
│     ├─ 30-detect-article.js · 31-detect-table.js · 32-detect-records.js
│     ├─ 35-inspect.js     per-tab inspect session, tree, pattern registry
│     ├─ 36-pattern-chat.js · 37-pattern-contact.js  registered preview patterns
│     ├─ 40-arbitrate.js   candidates → region tree
│     ├─ 50-classify.js    page-type distribution, URL rule table
│     ├─ 60-output.js      json/csv/markdown, token estimate
│     ├─ 70-overlay.js     closed shadow-root overlay (only page mutation)
│     ├─ 80-pipeline.js    analyze(): orchestrates, stores L.last
│     └─ 90-bridge.js      message API (the only other file that uses chrome.*)
├─ scripts/  build.mjs (assemble dist/) · perf.mjs (real-Chromium timings)
├─ test/  unit.mjs · panel.mjs · run-fixtures.mjs · inspect-smoke.mjs · make-fixtures.py · fixtures/*.html + expected.json
└─ package.json                      dev-only (jsdom, playwright). Not needed to run the extension.
```

## 3. Layering rules (enforced by review and tests)

Numeric prefixes are layers. **A file may use only lower-numbered layers.**

| Layer | Files | May depend on | May use `chrome.*` |
|---|---|---|---|
| 0 | 00 | nothing | no |
| 1 | 10 | 0 | no |
| 2 | 20 | 0–1 | no |
| 3 | 30–32 | 0–2 | no |
| 3.5 | 35 | 0–3 | no |
| 3.6 | 36–37 | 0–35 | no |
| 4 | 40, 50 | 0–37 | no |
| 5 | 60 | 0–4 | no |
| 6 | 70 (overlay) | 0–5 | **messaging only** |
| 7 | 80 | 0–6 | no |
| 8 | 90 (bridge) | all | **yes** |

Gaps are intentional (e.g. 45, 55) so later phases can slot files in without renaming. Panel rule: views never call `chrome.*` directly; they receive `actions` from `panel.js`, which uses `api.js`. Background rule: it is the only storage writer.

## 4. Data flow: the Phase 0 pipeline (fixture-only)

`80-pipeline#analyze` and `60-output#render` have **no message entry point**; `test/run-fixtures.mjs` is their only caller. They stay in the engine because the inspect patterns share their parts (`L.articleHints`, `L.extractTable`, `L.segment`, `L.textOf`, `L.walk`).

1. The harness injects the engine into a jsdom document (`load()`), then calls `Lasso.analyze()` directly.
2. Engine (`80-pipeline`): `snapshot` → yield → `segment.mineRepetition` → yield → each registered detector (try/catch) → `arbitrate` → `classify` → store `L.last` (live elements stay in the page; only a serialisable summary is returned).
3. The harness calls `Lasso.output.render(regionId, format)` and asserts the rendered text/JSON against `expected.json`.

Re-injection is idempotent: `00-namespace` rebuilds the namespace and destroys any old overlay; `90-bridge` removes the previous listener.

## 4.1 Data flow: inspect-first (Milestone A)

1. Panel opens/tab switches → `stage0()`: `ensureEngine` → `LIGHT` → `SITE_GET` → `INSPECT_STATE` (per-tab session restore). No snapshot is taken.
2. User clicks **Inspect** → `INSPECT_START`. `35-inspect` snapshots the visible document, stores a live `el` reference per node, returns root + first-level serialisable children, and records session stats. `70-overlay` enters inspect mode (hover box, selection, context menu).
3. Panel renders a **lazy tree**: `INSPECT_TREE {nodeId}` serialises up to 400 children on expansion. Tree and page stay in sync via `INSPECT_SELECT` (panel→page) and `NODE_SELECTED`/`NODE_HOVERED` (page→panel).
4. Right-click or the Map checkboxes → `INSPECT_PATTERNS {nodeId, patterns}`. `35-inspect` runs **only the checked patterns** against that selection (`detect()` is scoped to the selection or its nearest matching ancestor), builds each result and returns them with stats. Built-ins are Article/Table/List/Text; Chat and Contact register from layers 36/37. Selecting a node never probes a pattern.
5. One successful result shows a description with **Send to Output** → `INSPECT_RENDER {format}`. Several results → Output renders one collapsed card each via `INSPECT_RENDER_ALL {format}`. `60-output` reuses the existing JSON/CSV/Markdown formatters.
6. Toggle off/Escape/navigation/tab close → `INSPECT_STOP`; `70-overlay.destroy()` removes the host, boxes, menu and global listeners. Node ids die with the session.


## 5. Extension points

**Add a detector** (e.g. `33-detect-product.js`; add to `shared/content-files.js`):
```js
(() => {
  const L = globalThis.Lasso, u = L.util;
  L.registerDetector({
    id: 'product', kinds: ['product'],
    detect({ snap, groups, meta }) {
      // return [{ detectorId, kind, nodeId, score, evidence:[u.sig(...)], hints:{…} }]
      return [];
    },
  });
})();
```
Then add the kind's threshold in `40-arbitrate.js`, a data shape in `60-output.js#dataFor`, and a fixture + expectation. D-023: detectors feed the fixture-only Phase 0 pipeline, so there is no overlay colour or panel wiring to update.

**Add an inspect pattern:** create a layer-3 file (or call from an existing one) after `35-inspect.js`:

```js
Lasso.inspect.registerPattern({
  id: 'chat', label: 'Chat', order: 25,
  detect(id) { return { ok: true, nodeId, reason: '12 messages', meta: {…} }; },
  build(r) { return { kind: 'chat', nodeId: r.nodeId, count: 12, messages: […] }; },
});
```
It then appears in the Map buttons and the page menu automatically. Add a data shape in `60-output.js#dataForInspect` and JSON/CSV/Markdown renderers; add a unit fixture. IDs are lowercase and node ids remain per-session.

**Add an output format:** `L.registerFormat('html', { label:'HTML', mime:'text/html', ext:'html', render:(data)=>'…' })`, then use it from `renderInspect`/`renderInspectResults`; the panel's chips are the `FORMATS` list in `views/output.js`.

**Add a panel tab:** create `views/<name>.js` exporting `render<Name>(root, actions)`, add a `<section>` and tab button in `index.html`, one line in `panel.js#paint`.

**Add a background capability:** add a handler in `service-worker.js`; the panel calls it through `bg(type, payload)`.

## 6. Where each phase plugs in

| Milestone | New engine files | New background files | New panel files |
|---|---|---|---|
| A Inspect (done) | `35-inspect.js` (session/tree/scoped patterns) | — | `views/{page,map,output}.js`, `state.js` |
| B Schemas/replay | `45-locator.js`, `55-schema.js` (runner, matcher, health) | `schema-store.js` | `views/schemas.js`, Output field/scope editor |
| C Teach polish | `35-infer.js` (field inference/transforms) | — | field-level picker, onboarding |
| 3 Robustness | `56-heal.js`, `33-detect-product.js`, `34-detect-grid.js`, `65-paginate.js` | — | diff/repair view |
| 4 Agents/batch | — | `batch.js`, `bridge-host.js` (native messaging or local relay) | `views/batch.js` |
| 5 Assist | — | `assist.js` (opt-in network, separate permission) | settings view |

Anything that needs the network lives **outside** the engine and behind an optional permission, so the charter's no-network rule stays true for the core.

## 7. Error handling and performance

- Detectors are isolated: an exception becomes an entry in `stats.errors`; the scan continues.
- The pipeline yields to the event loop between phases (`scheduler.yield()` when available). **Measured** (`npm run perf`, 2026-10-27): snapshot p95 ~77–100 ms at 5k nodes (budget met) but a 383–433 ms block at 25k (p50 467 → 383 ms after D-024), and `detectPatterns` adds 299–616 ms in one block. `Element.checkVisibility()` removed the per-element `getComputedStyle` (D-024); chunking the snapshot and yielding inside inspect detection is still required to meet the 50 ms task budget.
- Caps (25k nodes, depth 80) bound worst-case time and memory; `truncated` is surfaced in the UI.
- The panel paints from a **structural key** (everything the three views read, minus `hoverId`): a paint whose key is unchanged only re-applies hover classes to the rows already in the DOM. Hover is coalesced to one paint per frame; every other state change paints immediately. Without the key, each hover event rebuilt the whole panel (the tree included).
- Geometry (`getBoundingClientRect`) is read only by the overlay, only for the selected/hovered inspect node or kept legacy regions, only on paint.
- Computed style is read once per element during the snapshot; the engine never writes to the page, so no layout thrash.

## 8. Testing strategy

| Layer | Tool | Scope |
|---|---|---|
| Unit | Node + jsdom (`test/unit.mjs`) | Pure logic, invariants, source scans, manifest checks, inspect registry/patterns |
| Panel smoke | Node + jsdom + mocked `chrome.*` (`test/panel.mjs`) | Side-panel wiring: start, select, apply, render, stop |
| Fixtures | Node + jsdom (`test/run-fixtures.mjs`) | Detection quality against `expected.json` |
| Browser smoke (`npm run test:inspect`) | Playwright with the unpacked extension | Inspect flows, overlay geometry, keyboard parity, per-tab sessions, downloads, restricted pages, SPA pushState navigation (15 scenarios). Does not cover the native side panel, toolbar click, install warning or extension reload |
| Browser e2e (`test/e2e.mjs`) | Playwright with the unpacked extension | **Stale and unwired**: still assumes the Phase 0 auto-detect UI, is not in `npm test` and cannot pass as written. Delete or rewrite it for inspect-first before using it as a gate |
| Variant robustness (Phase 3) | Generated variants of fixtures | Schema replay after class renames, wrappers, banners |

jsdom has no layout, so anything depending on visibility geometry or timing budgets is **not** claimed by these tests.

## 8.1 Real-browser timing harness

`npm run perf` (`scripts/perf.mjs`) loads synthetic 1k/5k/25k-node pages in headless Chromium, injects the shipped engine files in `CONTENT_FILES` order, and reports p50/p95 for `L.snapshot()`, `childrenOf()` on the widest container, and a six-pattern `detectPatterns()`, plus the longest unbroken main-thread block. It is a measurement tool, not a gate: it is not part of `npm test`, the numbers are machine-dependent, and the longtask observer is reported but not trusted (it counts 0 in some headless builds, so the longest measured synchronous call is used as the lower bound).

## 9. Build and packaging

No build step. To ship: zip the folder without `node_modules`, `test/` and dev files (a `scripts/pack` helper arrives with Phase 1). If a bundler is ever needed (TypeScript, UI framework), it must emit the same `src/` layout so load-unpacked keeps working; this is recorded as a decision in `DECISIONS.md` before it happens.

## 10. Security boundaries

- Page → extension: the page can never message the engine (isolated world, extension-id-scoped runtime).
- Extension → page: only the overlay host (closed shadow root, `pointer-events:none` except chips). In inspect mode the overlay capture-blocks click, context-menu, pointer/mouse press **and** release (`pointerdown/up`, `mousedown/up`, `auxclick`, `pointercancel`), touch press/release, drag and submit on any target outside the host — including targets that are not in the snapshot — so the page can never navigate or react under the picker.
- Untrusted strings: page text reaches the panel only through `textContent`. Labels and result summaries have exactly one implementation (`L.inspect.nodeLabel`, `L.inspect.summary`), so the tree, the overlay badge and the panel can never word the same element or result differently.
- Imports (Phase 1): size-capped, shape-validated, never evaluated.
