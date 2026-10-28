# Lasso — Implementation and Vision Review (Round 3)

Date: 2026-10-26. Inputs: `lasso-claude.md` (source dump), `VISION.md` v0.2.

## 0. What I could and could not review

- **Reviewed:** the Phase 0 source in `lasso-claude.md` (manifest, AGENTS, DECISIONS, snapshot, segmentation, article/record detectors, arbitration, output, pipeline, bridge, service worker, namespace utilities) and all of `VISION.md`.
- **Not in the dump, so not verified:** all Milestone A code (`72-picker.js`, tree, scoped patterns, per-tab inspect state), `test/unit.mjs`, `test/e2e.mjs`, the table detector and the panel views in their current form. `VISION.md` says Milestone A is implemented and green in jsdom; I cannot confirm that. Send those files for a second pass.
- **Not run:** I executed nothing from the project. Two engine bugs below were reproduced by running the exact regexes in Node.

## 1. Project state versus my earlier decisions

The project has moved to a single plain-JavaScript MV3 extension with no build step, no TypeScript, no monorepo, jsdom tests and a 10-fixture corpus (D-001…D-004, `AGENTS.md`). `AGENTS.md` outranks my R1/R2 files, so these R1/R2 items are **superseded**: the monorepo, WXT/Vite, the contracts PR, the 30-fixture Sprint 1 gate and the Sprint 1A/1B/1C split. I accept that direction. What still stands from R1/R2, and where the project falls short of it:

| Item | Status |
|---|---|
| Zero network, minimal permissions, CSP `connect-src 'none'` | Met (manifest, rule 5 scan). |
| Hidden text never leaks | Partly met. See §2.3. |
| Real-browser perf (p95 ≤150 ms at 5k nodes) | **Not measured.** Jsdom only; timings use `Date.now()`. |
| ≥30 fixtures, ≥10 hard, variant generator | **Not met.** 10 fixtures, no variant generator. Milestone B's replay gate depends on one. |
| No score floors | **Contradicted.** `MIN_SCORE` .45/.45/.5 in `40-arbitrate.js`, `MIN_PROSE=300` in the article detector. Fine for the legacy path; must not leak into scoped patterns. |
| Licence | **Conflict.** `package.json` and README say MIT for the whole extension. R2 §5.4 kept the extension source closed until you decide. This needs your decision, not an agent default. |
| Name check (D-010) | Still open. |

## 2. Engine findings (priority order)

### 2.1 Bug: `modal-open` on `<body>` marks the whole page as boilerplate — P0
`bpOwn()` applies class/id token scores to every element including `BODY`, and `bp` is inherited with `Math.max(parentBp, …)`. Tokens `modal` (.80) and `popup` (.85) are in `BP_TOKENS`, and detectors skip nodes at `bp ≥ .8`. Bootstrap and many consent tools add `modal-open`, `no-scroll cookie-consent-open` and similar to `<body>` while a dialog is showing. Confirmed: `pieces('modal-open')` yields `modal`, `pieces('popup-open')` yields `popup`, `pieces('no-scroll cookie-consent-open')` yields `cookie`. On such a page every descendant is excluded and detection returns nothing.
**Fix:** never apply class/id token scores to `BODY`, `HTML`, `MAIN` or `ARTICLE`. Ignore state-modifier tokens (`open`, `active`, `visible`, `show`, `lock`, `no-scroll`) when matching. Add a named fixture (cookie modal open on body).

### 2.2 Bug: `isHashy` drops real words — P1
`/[0-9a-f]{6,}/i` matches any 6+ run of letters a–f. Confirmed hashy: `feedback`, `decade`, `defaced`; also `col12md` and any class starting with `_`. These tokens are removed from fingerprints, so unrelated siblings can merge and real classes vanish.
**Fix:** require at least two digits in a hex run, or a run of ≥8 mixing digits and letters. Keep the CSS-in-JS prefix rule. Add a unit test listing real words that must not be hashy.

### 2.3 Visibility is narrower than the charter claims — P1
The snapshot skips `hidden`, `inert`, `display:none` and `visibility:hidden` only. Missing: effective `opacity:0`, `content-visibility:hidden`, `visibility:collapse`, and a `visibility:hidden` parent whose child sets `visibility:visible` (the whole subtree is dropped). Use `el.checkVisibility({checkOpacity:true, checkVisibilityCSS:true})` with the current check as fallback, and put the rule in one shared module used by snapshot, extraction and formatters. Needs a real-browser test; jsdom cannot show it.

### 2.4 Repetition mining is exact-key, not similarity-based — P1
`mineRepetition` buckets children by an identical shape-plus-class string, first two levels, first 8 children. One optional badge or extra node in a card splits the cluster and the group is lost. Under inspect-first this matters less for List (the user points at one item), so: build **sibling inference** from the selected item (same parent, same tag, similarity ≥ ~0.7 on shape and field-presence), and keep global mining only as a hint. Record the cluster key and ratio as evidence.

### 2.5 Output quality issues — P1
- **CSV formula injection:** cells starting with `=`, `+`, `-`, `@` open as formulas in Excel/Sheets. Prefix with `'` (or a tab) on a CSV-for-spreadsheets option. This is the audience you named.
- **Excel UTF-8:** no BOM option; Arabic/French text opens garbled. Add a flag.
- **Markdown over-escaping:** `esc()` escapes `_ * [ ] { } \ \`` in all text, so `snake_case` becomes `snake\_case`, which hurts the "LLM-ready" promise. Escape only where it changes parsing (line-start `#`, `-`, `>`, `1.`; `*`/`_` around words; inside link text brackets).
- **Code blocks:** no language on fences. Read `language-*`, `lang-*`, `data-lang`. Inline `CODE` with a backtick inside breaks.
- **Lazy images:** the `data:` check misses placeholder URLs; prefer `data-src`/`srcset` when `src` looks like a 1×1 or placeholder.
- Dead entry `FIGCAPTION_X` in the `DROP` set.

### 2.6 Smaller items
- `Date.now()` timings are whole milliseconds. Use `performance.now()`; budgets of 50 ms need sub-ms resolution.
- `SITE_TOUCH` in the service worker is read-modify-write on one key; two quick messages can drop an update. Serialize writes through a promise queue.
- The per-hostname visit log is a small browsing history. It is disclosed in the privacy doc, but add a visible "Clear" in the panel and keep it hostnames-only.
- `L.textOf`/`L.walk` are recomputed per item and per detector. Fine at 5k nodes in scoped mode, wasteful in global mode; memoise per node if profiling shows it.
- `emptyStats` has leftover no-op code (`linkCount: tag==='A'?0:0`, `+= 1 - 0`); harmless, but a clean-up makes the single-pass claim honest.
- Not reviewed: table detector, classifier, panel views.

## 3. Vision review

### What is strong
Intent over inference; per-tab sessions with explicit navigation rules; the custom overlay menu (no `contextMenus` permission); keyboard and touch parity; an honest baseline section; Output becoming the teaching surface; locator/schema moved onto the critical path.

### Improvements, in order of product impact

1. **The beachhead promise got slower.** My brief's wedge was "article to Markdown in one click, token count shown, 3 clicks or fewer." The vision's first-use path is Inspect → point → right-click → Article → Output (then name and save for a recipe). That is five or more steps for the headline use case, and it loses to Instant Data Scraper-style tools on speed. Do not remove user control; add a **user-invoked "Clean page → Markdown"** button on Page. It runs the Article pattern on the best-fit container, only when clicked, with no overlay and no scan on open. This keeps V0-1 intact and answers vision Q2 differently: remove the *automatic* scan, keep a *one-click shortcut*. The vision's optional "Auto / best fit" menu entry is the same idea inside Inspect.
2. **Selection must fully isolate the page.** The vision says click "prevents the page's default action." Many sites act on `pointerdown`, `mousedown` or `touchstart`. In inspect mode, register capture-phase listeners and call `preventDefault()` plus `stopImmediatePropagation()` on `pointerdown/up`, `mousedown/up`, `click`, `dblclick`, `auxclick`, `contextmenu`, `touchstart/end`, `submit`. Use `event.composedPath()[0]` so open shadow roots resolve to the real target. Add an e2e test on a fixture with a mousedown-navigating link and a custom context menu.
3. **SPA navigation breaks "navigation ends the session."** `pushState` navigation neither reloads the page nor destroys the content script, and `chrome.tabs.onUpdated` does not give the panel a URL under `activeTab` alone. Detect in the content script (the Navigation API's `navigate` event where available, otherwise a cheap `location.href` check on a timer and on `popstate`) and report `INSPECT_EXITED {reason:'navigated'}`. Also re-run URL matching for recipes on that event. Verify the Navigation API behaviour in the isolated world in a real Chrome test before relying on it.
4. **Staleness is wider than `isConnected`.** Add a read-only `MutationObserver` that counts mutations in the inspected subtree and marks the selection "page changed" with a one-click re-snapshot. Consider snapshotting lazily around the selection instead of the whole document on Inspect; it keeps big SPAs instant and shrinks the stale window.
5. **Define the locator design now; Milestone B depends on it.** Proposal: a locator set per target with tiers, resolved by voting. Tier 1 semantic anchors (`id`, `data-testid`, `itemprop`, `aria-label`, role); tier 2 stable-class path; tier 3 bounded structural path; tier 4 normalised heading/text anchor; plus a **container fingerprint** (tag shape, field-presence vector, size bucket) used to validate the match before extracting. Rules: no match means "broken", never a best guess; ≥2 tiers must agree for "healthy"; one agreeing tier means "degraded". Field locators are relative to the item root. At Save, run each tier independently and warn "brittle" if only one resolves. Health thresholds from R1 F11 still apply.
6. **Split Milestone B.** B1: locator builder, schema store, URL matcher, runner and health, with a name field and nothing else, proven on fixture variants. B2: configuration UI (fields, scope, format). Same reasoning as my original sprint order: prove the replay loop before building UI on it. The B gate needs a defined variant set (R1 F11/Q26): renamed classes, extra wrappers, injected banner, hidden duplicate text, on at least 15 fixtures.
7. **Minimal field picking should move into B2.** List recipes are the main long-term value and their quality is limited by inferred fields. A cheap version: in Output, show the first item's mini-tree and let the user bind or unbind a field to a clicked node. Full point-and-pick can stay in C.
8. **URL scope needs a precise rule.** Derive the path pattern by replacing numeric, UUID and slug-like segments with wildcards, show "matches `/blog/*`" in plain language, define precedence (exact path > pattern > domain), and treat query strings as ignored unless the user adds them.
9. **Add two MVP patterns, or justify excluding them.** *Section* (a heading plus content up to the next heading) and *Code block*. Docs and LLM-context users want heading-delimited chunks more than "Links" or "Images". Keep the "fixture and a use case first" rule.
10. **Specify the pattern API as a contract.** `probe(node) → {applicable, reason, climbTo?, hint:{score, calibrated:false}, preview}` and `extract(node, options) → ExtractedRegion {kind, fields, items, provenance, diagnostics}`. Without TypeScript, use JSDoc typedefs checked by `tsc --noEmit --checkJs` as a dev-only step. That respects rule 9 (no build step, no runtime dependency) and catches message-shape drift between panel, bridge and engine.
11. **Retire the legacy path on a date.** `ANALYZE`, `RENDER`, region overlays, `REGION_CLICKED` and Quick extract stay "for fixtures". Keep detectors as probes, but delete the legacy UI and overlay-regions code once the e2e harness is rewritten, or it will rot and widen the surface. Also rewrite `MASTER_SPEC.md` §5–7 in the same change (rule 10).
12. **Make beta measurable without telemetry.** Add the R1 F5 local event log and "Export diagnostics" (counts, timings, health, no page content). Without it, the 3-minute-to-first-recipe metric cannot be checked.
13. **Repair is cheaper than healing.** For C: "re-inspect to repair" opens Inspect pre-seeded with the old schema, shows old versus new locators, and lets the user accept. That delivers the "site changed" story without healing proposals.
14. **Accessibility priority.** Make the panel (tree + Patterns button) the primary keyboard path and the in-page menu the fast path. Focus handling across a closed shadow root and a hostile page is the fragile part.
15. **One-click revisit.** Agree with option (a). Make "Run" the focused primary button when exactly one recipe matches, so Enter runs it.

## 4. Gate and sequencing recommendation

1. **Fix 2.1, 2.2 and 2.5 now** (small, high value, each with a named fixture).
2. **Rewrite `test/e2e.mjs` for the inspect flow and pass it.** Milestone A is not done until the real-browser gate passes; jsdom green does not cover layout, focus, event isolation or visibility. Carry forward the four harness findings in vision §17 (panel state resets on spurious tab events, restricted-page banner, clipboard/CRLF test limits).
3. **Add the one-click "Clean page → Markdown" shortcut** (item 1) before Milestone A is called done.
4. **Run a real-browser perf pass** at 1k, 5k and 25k nodes and record p50/p95.
5. Then B1, then B2.

## 5. Decisions for you

- **Licence scope:** MIT for the whole extension (as `package.json`/README say now), or MIT for the engine only (D-010, R2)?
- **Quick action:** accept the user-invoked "Clean page → Markdown" button, or keep the vision's stricter "Inspect only"?
- **Milestone B split:** accept B1/B2?
- **Send me** `72-picker.js`, the tree code, `test/unit.mjs`, `test/e2e.mjs` and the panel files if you want Milestone A reviewed rather than assumed.
