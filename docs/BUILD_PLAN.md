# Lasso — Build and Launch Plan

> **Direction update — 2026-10-26 (Milestone A implemented):** the target UX is inspect-first (point → pick a pattern → configure/save → one-click replay). Milestone A (per-tab inspect, tree, scoped patterns, Output preview) is built and covered by `npm test`; the real-browser gate is next. See `docs/VISION.md`; milestone re-sequencing is in §14 there. The phase table below is the old auto-detect-first plan and remains the record of what was built, not the committed schedule for the pivot.

Estimates assume one builder working with a coding agent. They are planning aids, not promises; re-estimate at each gate.

## 1. Phase overview

| Phase | Weeks (cumulative) | Outcome | Release |
|---|---|---|---|
| 0 Foundation MVP | done (this zip) → smoke test 2–3 days | Detect/extract/export, overlays, map, site profile | internal |
| 1 Schemas & replay *(now Milestone B)* | 2–3 | Save, replay, health | internal alpha |
| 2 Edit mode & teaching *(now Milestone C; click-to-pick/DOM map shipped in A)* | 5–6 | Sibling inference, field mapping, transforms | **private beta (20–30 users)** |
| 3 Robustness & coverage | 7–9 | Healing, more detectors, pagination | **public beta / Web Store launch** |
| 4 Agents & batch | 10–13 | CLI/MCP bridge, batch lists, Pro gating | v1.0 + Pro |
| 5 Assist & sharing | 14–17 | BYOK assist, schema packs | v1.x |
| 6 Scale | later | Edge/Firefox, i18n, teams | |

Rule: **no phase starts until the previous gate is green.** Each phase ends with a short report (built, passed, deferred, next).

## 1.1 Milestone A — Inspect (implemented 2026-10-26; revised 2026-10-27)

**Delivered:** per-tab Inspect toggle; `35-inspect.js` session/tree/scoped pattern registry; lazy DOM tree with breadcrumb and hover/selection sync; custom closed-shadow-root checkbox picker with Text checked by default and an explicit Detect selected gate; built-in Article/Table/List/Text + preview Chat/Contact patterns; single-result description + Send to Output; multi-result collapsed Output cards; Output preview (Markdown/JSON/CSV); per-tab session stats; navigation/reload/tab-close cleanup; required all-site `http(s)` host access; panel smoke test.

**Gate (next):** run `npm install && npm test && npm run test:inspect`, then the manual inspect checklist below on 10 fixture selections + 5 real sites. Chosen patterns must produce usable results; first visit must not scan; no pattern may be probed until the user clicks Detect selected; checking another pattern must uncheck Text, and rechecking Text must allow a multi-selection; one result must not reach Output until Send to Output, while multiple results must open collapsed cards; page DOM must be unchanged outside the overlay; tab switch must preserve each tab's session, while navigation/reload/tab close ends it. Any defect becomes a fixture or panel-smoke assertion before the fix.

`npm run test:inspect` builds `dist/` and runs 15 headless-Chromium scenarios against the unpacked extension: inspect start/stop, default-Text picker, overlay auto-uncheck and single Send gate, multi-result cards, scoped Article/Table/List/Text, previews, JSON/CSV/download, tree lazy expansion, breadcrumb, selection/event isolation, context menu + keyboard, per-tab restore, navigation/close cleanup (including SPA pushState), restricted pages, and uncaught errors. It does not exercise the native side panel, toolbar icon, install warning, or extension reload; those stay manual.

**Manual inspect checklist (native Chrome UI; the headless smoke above does not replace it):**
1. `npm test` → 41 unit checks, 1 panel smoke, 11/11 automated fixtures. `npm run test:inspect` → 15/15; `npm run build` → `dist/` (currently 31 files). Load `dist/` via `chrome://extensions` → Developer mode → Load unpacked.
2. Reload the extension while a panel is open on a normal `http(s)` page. Inspect should continue without any site prompt (required host access). Confirm Chrome’s extension details show access for all sites. If you manually restricted site access, restore it and Retry; a restricted page should show a clear message, not a blank panel.
3. Open a new article without invoking Lasso: Page shows site info, no overlay and no snapshot. Click **Inspect** → tree appears only then.
4. In Map: expand a deep branch twice (lazy children), select page elements, confirm tree→page and page→tree highlighted selection, breadcrumb, and session counters. Selecting must show the pattern checkboxes with **Text** checked and **Detect selected**, not run detection. `Escape` exits and removes the overlay.
5. Right-click an element in inspect mode: the custom picker appears at the pointer with checkboxes and **Text** checked. Check Article → Text unchecks. Re-check Text → both stay selected. Click **Detect selected**: one pattern shows a result description with **Send to Output**; two or more open Output as collapsed cards. Test keyboard `Shift+F10`/context-menu key, Tab/arrow keys, Enter and Escape. Confirm a link/page does not react to `mousedown`, `pointerdown`, `touchstart` or `submit` while inspecting, and its own context menu is not hijacked outside inspect mode.
6. Serve the corpus: `python3 -m http.server 8000 --directory test/fixtures`. Check Article, Table, List and Text on at least 10 fixture selections across the corpus (not necessarily one per page). Confirm a single result needs **Send to Output**, and a multi-selection opens collapsed cards that expand, copy and download independently. Output Markdown/JSON/CSV must match the content; no navigational/footer text leaks.
7. Chat preview: open `chat-thread.html`, select the thread, check Chat, Detect selected, then Send to Output. Expect 3 messages with user/assistant roles and the footer text absent. Contact preview: open `contact-footer.html`, select the footer, check Contact, Detect selected, then Send to Output. Expect the name, `hello@northwind.test`, the phone number, address and links; no `FOOTERTEXT`-style page chrome.
8. Per-tab: Inspect on tab A, switch to tab B (Inspect off there), return to A. A's tree, selection, result and counters are restored. Navigate A → session ends; reload A → ends; close A → its state is discarded.
9. Compare page DOM before/after (DevTools): the only added node is `[data-lasso-overlay]`; no page styles/classes/attributes change. Exit inspect → host gone.
10. Restricted pages (`chrome://…`, Web Store, `view-source:`) show a clear message, never a blank panel or a broken toggle.
11. Repeat the checkbox-picker flow on **5 real sites** you care about (news/article, data table, listing, chat, footer/contact), including at least one multi-pattern selection. Record site, patterns, single/multi path, result quality, and any selector/role misses.
12. Turn every failure into a fixture or panel-smoke assertion **before** the fix; then re-run `npm test` and `npm run build`.

**Milestone B** (fields/scope/save/replay/health) supersedes old Phase 1 and the teaching parts of Phase 2; do not start it until the Milestone A gate is confirmed.

## 2. Phase 0 — Foundation MVP (delivered)

**Delivered:** manifest and shell, engine (snapshot, repetition mining, 3 detectors, arbitration, classification, outputs, overlay, bridge), side panel (Page/Map/Output), site profile store, 11-page fixture corpus, 17 unit checks at the time (suite now 41 + 1 panel smoke), docs.

**Exit gate — run once in real Chrome (manual smoke checklist):**
1. `chrome://extensions` → Developer mode → Load unpacked → select the folder. No errors on the extension card.
2. Open a news/blog article → click the toolbar icon → panel shows site name and "First visit".
3. *(Historical Phase 0 path; now use the Milestone A checklist.)* **Quick extract** → Output shows clean Markdown (no nav, cookie text or footer); Copy works; Download saves `.md`.
4. Open a page with a data table → Quick extract → CSV opens correctly in a spreadsheet; JSON is valid.
5. Open a listing/product grid → Quick extract → count looks right; Map shows `record list` with sensible fields.
6. Toggle **Edit mode** → coloured boxes appear and follow scrolling; click a chip → panel selects it; toggle off → boxes gone; page DOM otherwise unchanged.
7. Reload the page, switch tabs, open `chrome://extensions` → graceful messages, no blank panel.
8. Repeat steps 3–6 on **10 real sites** you care about. For each: right/wrong region, notes. Log failures as new fixtures.
9. `npm install && npm test` green.

Any defect found becomes a fixture first, then a fix.

## 3. Phase 1 — Schemas and replay

**Goal:** the saved schema loop works end to end.
Tasks:
1. `45-locator.js`: build ordered locator sets (semantic → attribute → stable CSS → structural → text signature) with a verification signature; resolve with fallbacks; property tests (mutate irrelevant attributes → still resolves).
2. `55-schema.js`: schema validator (hand-written, shape + size caps), matcher/ranker, runner with diagnostics, health rules (spec §8).
3. `schema-store.js` in the background; migrations keyed by `schemaVersion`.
4. Panel: **Save as schema** on a region (name, scope), **Schemas** tab (run, rename, delete, export/import).
5. Host access is already declared; add an auto-badge on revisit only if wanted (no extra permission).
6. **Real-browser harness**: done — `npm run test:inspect` (behaviour, 15 scenarios) and `npm run perf` (timings at 1k/5k/25k). Measured 2026-10-27: snapshot p95 **~77–100 ms at 5k (budget met)** and p50 **~383 ms at 25k** (down from ~467 ms after D-024), but a 25k page is still one **~433–616 ms unbroken block (budget missed ~9–12×)**. D-024 removed the per-element `getComputedStyle`; chunking the snapshot needs an async walk, so it is a Milestone B task.
7. Grow fixtures to 30 (6 more articles, 4 tables, 5 listings, ≥10 hard cases) and add the variant generator.
8. `scripts/pack` for store zips.

**Gate:** a saved schema replays `healthy` on ≥85% of generated fixture variants; browser perf budgets pass (the 25k task budget is currently **missed** — see §3 task 6); fixture pass rate ≥85% on 30 pages; zero hidden-text leaks.

## 4. Phase 2 — Edit mode and teaching

Tasks: click-to-pick mode on the page (hover highlight, breadcrumb of ancestors, "grow/shrink selection"); full DOM node map with two-way sync; sibling inference ("click one item → find the rest", live "18 of 20 matched"); article field editor (title/author/date/body mapped to elements); field renaming and transforms (trim, number, currency, date, absoluteUrl); undo; first-run onboarding (3 steps).
**Gate:** median install → first saved schema ≤3 min with 5 test users; 7-day-old schemas healthy ≥85% on the beta cohort's sites.
**Release:** private beta.

## 5. Phase 3 — Robustness and coverage

Tasks: healing proposals with a diff view (never auto-applied); product-detail detector; div-grid tables via repetition; definition lists; same-origin iframes; `rowspan`; pagination ("next" capture) and infinite-scroll capture (scroll, wait for mutations, merge, dedupe); RTL checks; performance pass; accessibility pass; crash/error report that stays local (copy diagnostics button).
**Gate:** variant replay ≥90% healthy; 20-page head-to-head benchmark published; zero P0/P1 open.
**Release:** public beta and Chrome Web Store listing.

## 6. Phase 4 — Agents and batch (Pro foundation)

Tasks: local bridge (native messaging host or localhost relay, decided by a spike) exposing a CLI and an MCP server: `list_schemas`, `run_schema(name, url?)`; batch URL list runner (background tabs, concurrency and rate limits, resume, per-URL diagnostics, CSV/JSON merge); Pro entitlement design (offline-verifiable licence; no accounts required).
**Gate:** an agent can run a saved schema via MCP and receive validated JSON; batch of 100 URLs completes with correct per-URL health.

## 7. Phase 5 — Assist and sharing

Tasks: **optional** bring-your-own-key assist used only at authoring time (name fields, suggest repairs) behind a separate opt-in permission and clear data-flow disclosure; schema packs (curated, importable bundles for popular site types); community gallery decision.
**Gate:** assist never runs during replay (tested); packs validate and import safely.

## 8. Launch plan

### 8.1 Positioning and messaging
- **Headline:** *Teach a page once. Extract it forever.*
- **Pillars:** local-first and private · deterministic (no per-page AI cost) · self-healing recipes · LLM-ready output (Markdown, JSON, token counts) · agent-callable (Phase 4).
- **Proof points to earn before launch:** the head-to-head benchmark vs Instant Data Scraper and Thunderbit on 20 pages; the "site changed, schema healed" demo; a no-network audit anyone can reproduce.
- **Be honest in copy:** Lasso is for pages you open and use, not bulk crawling or bypassing protections.

### 8.2 Web Store readiness checklist
- Single purpose statement: "Extract structured data from the current page."
- Permission justifications (paste into the dashboard): `activeTab` — fallback access for the tab the user invokes Lasso on; `scripting` — inject the extraction engine on demand; `sidePanel` — show results; `storage` — save the user's per-site settings and schemas locally; host `http://*/*` + `https://*/*` — inject the inspect engine into regular web pages, including after an extension reload, without per-site prompts. No content scripts, no remote code, no network.
- Privacy policy (`docs/PRIVACY.md`) hosted at a stable URL; data-usage disclosure: no collection, no transmission.
- Assets: icon 128, 3–5 screenshots 1280×800 (article → Markdown, table → CSV, edit mode overlays, schema replay, healing), small promo tile 440×280, 30–60 s demo video.
- Listing copy: ≤132-char summary; first paragraph carries the headline and three bullets; keywords naturally include "web scraper", "table to CSV", "page to Markdown", "data extractor".
- Support: a public issue tracker and a one-page FAQ (permissions, privacy, limits).

### 8.3 Pricing hypotheses (test, do not assume)
- **Free forever:** all one-click extraction, universal extractors, exports, a limited number of saved schemas (start at 5).
- **Pro (~$5–9/month or a founder lifetime offer):** unlimited schemas, healing proposals, batch runs, CLI/MCP bridge, schema packs.
- Validate with the beta waitlist: ask "would you pay, and for which feature?" before fixing prices. Thunderbit's entry price is a useful reference point for willingness to pay.

### 8.4 Timeline
| When | Activity |
|---|---|
| Phase 0–1 | Build in public: weekly devlog on DevDiary; collect a waitlist (simple form, no tracking). |
| Phase 2 | Private beta with 20–30 users: your audience, r/webscraping, agent-builder communities. Weekly feedback call or form. |
| Phase 3 (T-2 weeks) | Benchmark post; demo video; store assets; privacy page; submit to the Web Store (allow review time). |
| Launch week | Show HN, Product Hunt, GitHub release of the open-core engine, X/LinkedIn threads, DevDiary launch post, community posts with *use-case* framing (not ads). |
| T+1 to T+8 | Weekly release notes, one deep-dive post per detector or healing, schema-pack drops, answer every issue within 48 h. |

### 8.5 Content backlog (first 10)
1. Why "teach once" beats "prompt every time" (cost and determinism).
2. The benchmark: methodology and results, including where we lose.
3. How Lasso detects articles (the Readability-style scoring, evidence view).
4. Repetition mining explained with a product grid.
5. Healing selectors: locator sets vs a single CSS path.
6. Zero-network extraction: how to verify it yourself.
7. Page → Markdown for LLM context: token counts and what to strip.
8. Table → CSV pitfalls (colspan, headers, Excel BOM).
9. Using saved schemas from an agent (Phase 4).
10. Roadmap and what we will *not* build.

### 8.6 KPIs
| Stage | KPI | Target |
|---|---|---|
| Activation | install → first successful extract | ≤60 s median |
| Habit | extractions per active user per week; saved schemas per user | track from beta |
| Quality | 7-day schema health | ≥85% |
| Retention | week-4 retention | ≥25% in beta (hypothesis) |
| Conversion | waitlist/beta users who would pay | ≥10% (hypothesis) |
| Support | median first response | ≤48 h |

### 8.7 Launch risks
Store rejection (mitigate: precise all-site justification, no content scripts, no network); a weak first-run (mitigate: universal extractors work with zero setup); benchmark disputes (publish pages and method); scope creep (the phase gates); privacy concerns (the no-network audit and open engine).

## 9. Working agreement for agents (opencode, Claude Code, etc.)

Read `AGENTS.md` first. Work one phase at a time, stop at its gate, report, and wait. Keep `npm test` green, add fixtures before fixes, and log decisions in `docs/DECISIONS.md`.
