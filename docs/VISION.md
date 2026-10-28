# Lasso — Product Vision: Inspect-first extraction

Version 0.2 · Owner direction confirmed · 2026-10-26
**Status:** Milestone A (inspect + user-triggered scoped Article/Table/List/Text + preview Chat/Contact + Output preview) is implemented and covered by jsdom/panel smoke tests as of 2026-10-26; the default-Text checkbox picker, selected-only detection, single-result Send gate and multi-result Output cards were added 2026-10-27 (D-021). The real-browser gate is pending. Milestone B (fields/scope/save/replay) is not. This document remains the product direction; the old Phase 0 auto-detect UI is the baseline, not the destination.
**Supersedes:** the *default UX* described in `MASTER_SPEC.md` §5–§7. The charter, local-first rule and no-network rule still apply in full; required host access is an explicit owner trade-off for a smooth flow (D-018).

---

## 0. My understanding, in one paragraph

Lasso should stop guessing which part of a page matters. On a first visit the panel is quiet: it shows only live page information (site, title, favicon, counts, visit number) and an obvious **Inspect** affordance — no page-wide detection, no overlays, no automatic “best region”. The user clicks Inspect, the active tab enters a DevTools-like inspect mode, and the **Map** tab fills with a live DOM tree. The user points at any element; left-click selects it, right-click selects it and opens a checkbox pattern picker with **Text** checked by default. The user chooses one or more patterns and clicks **Detect selected**. Only then does Lasso probe that selection. One result shows a short description with **Send to Output**; multiple results open **Output** directly as collapsed cards. On later visits Lasso matches saved recipes by URL locally and the user runs one with a single click. Everything stays local, deterministic and network-free.

If that paragraph is right, the rest of this document is the detailed reading. If it is wrong, the open questions in §16 are where to correct it before any code moves.

---

## 1. The promise

**Draft canonical wording:**

> **Point at any part of a page once. Get clean JSON, CSV or LLM-ready Markdown. Every revisit is one click. Nothing leaves your browser.**

This is more concrete than the current pitch (*“Teach a page once. Extract it forever.”*). It says **how** the user teaches Lasso — by pointing — and what the first payoff is. The exact wording is open for confirmation.

Why this position is stronger than page-wide auto-detection:

- **Intent beats inference.** The user knows what they want; the engine should not spend the first interaction guessing.
- **“Any part” is broader.** It covers an article, a table, one product card, a price, a docs section, a code block — not only the three shapes a global detector happens to recognise.
- **Faster first visit.** No snapshot, no mining, no detector pass until the user asks. The panel opens instantly and the page is untouched.
- **Explainable by construction.** The user chose the pattern and the root, so “why did Lasso pick this?” disappears as a support question.
- **A natural path to saved recipes.** The selection + pattern + configuration is exactly the schema that replay needs; teaching and saving become one flow instead of two features.

---

## 2. The shift

| Area | Phase 0 baseline (legacy) | Inspect-first target |
|---|---|---|
| First visit | Page info + a prominent **Quick extract** button. No scan until clicked. | Page info + an **Inspect** icon toggle. No scan, no detection, no overlays. |
| Entry point | Quick extract, or Edit mode | Inspect toggle → Map tab |
| Map tab | List of automatically detected regions | Live DOM tree of the page |
| Selection | Engine picks the highest-scoring region | User picks any element on the page or in the tree |
| Pattern choice | Automatic arbitration across detectors | User ticks patterns in a checkbox picker (Text default); only checked patterns run on the selection |
| Output tab | Preview / copy / download | Result **plus** field, scope and format configuration, then **Save** |
| Revisit | Not implemented | Matching saved recipe, one-click run, health status |
| Page mutation | Overlay boxes for detected regions | Overlay highlight and menu for the inspect session only |

As of 2026-10-26, Milestone A implements the target first visit, entry point, Map tree, selection, pattern choice and page-mutation rows below. Output configuration/Save and revisit remain Milestone B.

The conceptual change: **detection becomes a tool the user invokes on a selection, not a gatekeeper that decides for the user.** The engine’s scoring and evidence still matter — but as per-pattern evidence inside the checkbox picker and Output cards, and as sibling/container inference after the user points, not as a page-wide verdict.

---

## 3. The experience, step by step

```
First visit                    Inspect                      Point
┌───────────────┐   click   ┌───────────────┐   hover    ┌───────────────┐
│ Page info     │ ────────▶ │ Map: DOM tree │ ─────────▶ │ highlight on  │
│ Inspect [ ]   │           │ Inspect [x]   │            │ page + tree   │
└───────────────┘           └───────────────┘            └───────┬───────┘
                                                                 │ click / right-click
                                                                 ▼
┌───────────────┐   save    ┌───────────────┐   apply    ┌───────────────┐
│ Page: recipe  │ ◀──────── │ Output:       │ ◀───────── │ Pattern menu  │
│ Run (1 click) │           │ configure     │            │ Article/Table │
└───────────────┘           └───────────────┘            │ List/Text     │
                                                          └───────────────┘
```

1. **First visit.** Click the Lasso toolbar icon → the side panel opens on **Page**. It shows site name, hostname, title, favicon, cheap counts (article/table/h1/form), and “first visit” or “visit #N”. It also shows saved recipes for this URL, if any. **No page scan and no overlay.**
2. **Enter inspect mode.** The user clicks the **Inspect** icon button. Lasso switches the active tab into inspect mode, opens the **Map** tab and starts populating the DOM tree. The page itself is not restyled; only Lasso’s closed shadow-root overlay draws.
3. **Point.** Hovering an element draws a highlight with a small badge (`div.card`, dimensions). Left-click selects it. The Map tab scrolls to the same node and shows its breadcrumb. Selecting in the tree highlights the same element on the page.
4. **Choose patterns and Detect.** Right-clicking in inspect mode selects the element under the cursor and opens a checkbox picker; the Map shows the same checkboxes. **Text** is checked by default. Checking another pattern unchecks Text; rechecking Text explicitly selects multiple patterns. **Detect selected** runs only those patterns against the selection — never page-wide. The panel action is the keyboard and touch equivalent of right-click.
5. **Send to Output.** One selected pattern shows a result-description view with **Send to Output**; nothing is sent automatically. Multiple selected patterns open Output directly as one collapsed card per pattern; failed patterns show an error card. Expanding a card reveals the extracted data and Markdown / JSON / CSV preview.
6. **Configure and save.** In Output the user can toggle/rename fields, choose scope (this site / this path pattern), pick the default format and name the recipe. **Save** persists a schema locally; the panel shows a healthy/broken check against the current page.
7. **Revisit.** On the next visit Lasso matches saved schemas against the URL — locally, without reading the page — and lists them on Page. One click on **Run** extracts with the saved recipe. If the recipe is degraded or broken, the panel says so before the user relies on it.
8. **Exit.** Toggling Inspect off (or pressing Escape) removes the highlight, menu and overlay host, and leaves the page DOM otherwise unchanged.

---

## 4. Panel model

The existing three tabs survive, with different jobs:

| Surface | Responsibility |
|---|---|
| **Header** | Page identity + the **Inspect** icon toggle (replaces the Edit-mode switch). Active state is visible and labelled, not colour-only. |
| **Page** | First-visit information, saved recipes for the current URL, run/health, and the Inspect call to action. Never auto-scans the page. |
| **Map** | The live DOM tree, breadcrumb, selected-node preview and the **Patterns** button. Empty state when Inspect is off. |
| **Output** | Extraction result, field/scope/format configuration, validation, **Save**, and the existing copy/download actions. |

Rules:

- **Inspect mode is per-tab state.** Activating it on page A keeps that session on page A. Switching to tab B shows Inspect as **off** there (unless the user activates it on B); switching back to A restores A’s tree, selection, pattern result and session stats. The panel must query the active tab rather than assume a global mode.
- **Navigation ends the session.** Reloading or navigating A destroys A’s content-script session and its overlay; returning to the new page starts inactive. Closing the tab ends it. A page’s session never follows the user to another page.
- **Each tab can have its own session.** Two tabs may both be in inspect mode independently; the panel always reflects the active tab.
- **Session stats are local.** Track `startedAt`, snapshot nodes/ms, selections and patterns applied per tab so the panel can show the session state after a tab switch. No telemetry, no storage, no network.
- Map is only interactive while inspect mode is on. With inspect off it shows a short explanation and the Inspect button.
- Output can show a saved recipe’s result after a Run without entering inspect mode.
- Notices for restricted pages, missing permission, page-changed and no-applicable-pattern remain clear and never leave a blank panel.

---

## 5. Inspect mode

Inspect mode is the browser’s element inspector, scoped to Lasso’s side panel.

### 5.1 Entry and exit

- An icon button in the panel header toggles it (`aria-pressed`), with a text label or tooltip so it is not icon-only for first-time users.
- Only the **active tab** enters inspect mode. It is disabled with the existing banner on `chrome://`, the Web Store and other restricted URLs.
- Exit paths: toggle off, `Escape`, tab close, page navigation, or `DESTROY`. All of them remove listeners, highlight, menu and the overlay host.
- **Tab switch is not an exit.** The previous tab keeps its session and overlay (the page is hidden); the newly active tab is inactive unless it already has its own session. The panel re-queries the active tab on every switch and restores that tab’s tree/selection/result.
- Inspect mode is not persisted across reloads. Re-entering starts a fresh snapshot; node ids are per session, as the charter requires.
- Session stats (`startedAt`, nodes, snapshot ms, selections, patterns applied) live with the content script and are returned on `INSPECT_STATE`; they are never transmitted or stored.

### 5.2 Hover and selection

- `mousemove` → nearest meaningful element under the pointer → highlight in the overlay + badge with tag, stable class and size.
- Left-click in inspect mode selects the element and **prevents the page’s default action** (no link navigation, no form submit, no button click).
- `contextmenu` selects the element and opens the checkbox picker; **Text** is checked by default. Detection runs only after **Detect selected**.
- The overlay draws only; event handling stays in the content script. This keeps the overlay pointer-transparent except for the menu and avoids a full-page blocking layer.
- Breadcrumb in the panel (`body › main › article`) allows growing/shrinking the selection; the tree and page stay in sync.

### 5.3 Keyboard and touch

- `Escape` exits; arrow keys navigate the tree; `Enter` opens the Detect/menu flow for the focused node; the context-menu key / `Shift+F10` does the same.
- A **Patterns** button in the panel is the accessible and touch equivalent of right-click.
- The custom menu is a real ARIA `menu` with focus management and Up/Down/Enter/Escape.

### 5.4 Limits

- Closed shadow roots, cross-origin iframes and browser-internal pages cannot be inspected. Say so plainly; do not pretend.
- Very large pages use the existing node caps; the tree is lazy-loaded and says when it is truncated.
- If the DOM changes under the selection (SPA navigation), the stored node may detach. Re-check `isConnected` before applying and tell the user to re-inspect rather than extracting stale data.

---

## 6. Pattern menu

### 6.1 What it is

A short, contextual menu that answers: *“What do you want to extract from the element I pointed at?”*

**Milestone A pattern set (implemented):**

| Pattern | What it does | Selection behaviour |
|---|---|---|
| **Article** | prose body + title/author/date/headings/image → Markdown/JSON/CSV | use the selected container; climb only to an ancestor/contained `<article>` (never a page-wide `<main>` or a sibling article) |
| **Table** | headers + rows, `colspan` expansion | if a cell/row is selected, climb to the nearest table/grid |
| **List** | repeated items → records (products, posts, results) | if one item is selected, infer its siblings; if a container is selected, mine repetition inside it |
| **Chat** *(preview)* | conversation messages with roles where detectable | use the selected thread/message container; repeated message blocks with role hints, or a role-annotated thread |
| **Contact** *(preview)* | public name, emails, phones, addresses and links from a footer/imprint block | climb to a footer/contentinfo/contact-like ancestor; otherwise read the selected subtree |
| **Text** | clean text/Markdown of the selected subtree | always available as a fallback |

Patterns are registered through `L.inspect.registerPattern`; see `docs/ARCHITECTURE.md` §5. Later candidates: links, images, code blocks, definition lists, div-grids. Do not add them without a fixture and a clear use case.

### 6.2 Applicability, not automatic choice

Detection is explicitly user-triggered: selecting an element only stores the node; the checkbox picker chooses the patterns and **Detect selected** probes only those patterns against that selection and caches the results. Text is the default. One result shows a description and an explicit Send; multiple results become collapsed Output cards. No page-wide scan is performed.

There may be an **Auto / best fit** entry only if the owner wants it; otherwise omit it. The default remains an explicit choice.

### 6.3 Custom overlay menu vs native Chrome context menu

**Recommendation: custom menu inside Lasso’s closed shadow root.**

| | Custom overlay menu (recommended) | Native `chrome.contextMenus` |
|---|---|---|
| Permission | none | adds `contextMenus` |
| Dynamic pattern list | yes, per selected node after Detect, with evidence/preview | fixed items/submenu; no rich per-node content |
| Styling/accessibility | fully controlled | browser-controlled, inconsistent with panel |
| Knows the element | yes, directly | needs the content script to remember the last right-click target |
| Scoped to inspect mode | yes | harder; menu visibility is global-ish |
| Page conflicts | we must handle `contextmenu` carefully | no page conflict |

A native context-menu entry (“Lasso: inspect this element”) can be a later optional entry point, but it is not needed for the first milestone and would weaken the minimal-permission story.

### 6.4 Applying

- Applying runs **locally and deterministically** against the selected node, with `try/catch` isolation and diagnostics.
- The result includes: data, inferred fields, alternatives/counts, applicability evidence, and a proposed schema draft (container, item, fields, match).
- The user can switch pattern without re-pointing if the selection is compatible.
- Applying never writes to the page and never saves automatically.

---

## 7. Output: configure and save

Output is no longer just a preview. It is the teaching surface.

**MVP configuration (proposal):**

- **Result preview** — Markdown / JSON / CSV, token estimate, copy/download (existing formatters).
- **Fields** — a list inferred by the pattern, each with include/exclude, rename, and a required toggle. Field-level point-and-pick comes later.
- **Scope** — this site (domain) or a narrower path pattern; show the proposed match rule in plain language.
- **Format** — default output format for this recipe.
- **Name** — human name, e.g. “Harbor Ledger article”.
- **Save** — validates the schema shape, builds the locator set, and runs it once against the current page. Save only when the required fields resolve; otherwise show exactly which field failed.
- **Export/import** — Phase 1 design already exists; keep it behind validation and size caps.

The schema draft maps directly onto `MASTER_SPEC.md` §8:

| Schema field | Source in the new flow |
|---|---|
| `match` | current URL → domain + optional path pattern + selected page kind |
| `kind` | chosen pattern (`article`, `table`, `record_list`, …) |
| `container` | locator set for the selected root |
| `item` | list-only: sibling/item locator inferred from the selection |
| `fields` | pattern-extracted fields + user configuration |
| `output.default` | chosen format |
| `lastRun` | the validation run performed before save |

This is why the old Phase 1 locator/schema work is no longer “later”: it is the foundation of the save button.

---

## 8. Revisit: one click

On stage 0, before touching page content, the panel can match saved schemas against the URL using local storage only. That is not page auto-detection; it is recipe lookup.

Proposed behaviour:

1. Panel opens → page info + **“2 saved recipes for this site”** (ranked: exact path > domain > page kind).
2. Each recipe shows name, format, last health and last run time.
3. One click **Run** → inject/resolve → extract → Output, with diagnostics.
4. Healthy → results. Degraded → results plus a warning. Broken → no silent wrong data; offer Inspect to repair (healing proposals come later).
5. No matching recipe → Inspect call to action.

**Open interpretation of “one click”:** does the user mean (a) open panel, then click Run, or (b) click the toolbar icon and the only matching recipe runs immediately? Recommendation: (a) for the first release, with an optional per-recipe “run automatically when the panel opens” setting later. Auto-running on open without a visible choice is surprising and harder to debug.

---

## 9. Functional requirements (draft)

| ID | Requirement | Milestone |
|---|---|---|
| V0-1 | First visit shows page information and Inspect only; no snapshot, detector run or overlay. | A |
| V0-2 | Inspect is an icon toggle with a visible active state; it applies to the active tab only and is disabled on restricted pages. | A |
| V0-3 | In inspect mode, hover highlights, click selects without page navigation, and Escape exits cleanly. | A |
| V0-4 | The Map tab shows a lazily populated DOM tree of visible elements, synchronised with page hover/selection, with a breadcrumb. | A |
| V0-5 | Right-click and the Map show inline pattern checkboxes with Text checked by default; checking another unchecks Text. Detect selected runs only checked patterns on the selection. One result shows Send to Output; multiple results open collapsed Output cards. Keyboard operable. | A |
| V0-6 | Article, Table, List and Text can be applied to a selection and return data plus diagnostics. | A |
| V0-7 | Output shows the result and allows fields, scope, format and name to be configured; Save persists a validated schema locally. | B |
| V0-8 | On revisit, matching saved recipes are listed from local storage and run with one click, with health status. | B |
| V0-9 | Exiting inspect removes highlight, menu, listeners and overlay host; the page DOM is otherwise unchanged. | A |
| V0-10 | Tab switch or navigation exits inspect mode and cleans the previous tab. | A |
| V0-11 | Extraction remains local, deterministic and network-free; storage stays in the background worker; required host access is limited to `http(s)` and declared up front. | A+B |
| V0-12 | Restricted page, missing permission, page changed, no applicable pattern and truncated tree each produce a clear message, never a blank panel. | A |

**Milestone A** = inspect + apply + output preview (no persistence).
**Milestone B** = configure + save + replay (the locator/schema work).

---

## 10. Engine and architecture changes

### 10.1 Modules

| Module | Change |
|---|---|
| `10-snapshot.js` | Keep. Add: element→node lookup for the picker, lazy tree serialisation, re-snapshot on detach. |
| `20-segment.js` | Keep; `groupForParent` accepts `minItems` (Chat uses 2), default still 3. |
| `30/31/32` detectors | Kept as the legacy page-wide pipeline and as helpers for Article/Table/List patterns. |
| `35-inspect.js` | **Done:** per-tab session, lazy tree, pattern registry and scoped Article/Table/List/Text. |
| `36-pattern-chat.js`, `37-pattern-contact.js` | **Done:** preview patterns registered through `L.inspect.registerPattern`. |
| `45-locator.js`, `55-schema.js` | Milestone B: locator sets, schema validation, matcher, runner, health. |
| `70-overlay.js` | **Done:** inspect highlight, badge, custom ARIA menu, keyboard handling and `destroy()` cleanup. |
| `80-pipeline.js` | Keep the legacy global `analyze` for fixtures/benchmarks; inspect does not call it. |
| `90-bridge.js` | **Done:** inspect-only handlers (D-023). The Phase 0 pipeline is called directly by the fixture harness, not over messages. |
| `src/background/schema-store.js` | Milestone B: schema persistence + index; still the only storage writer. |
| Panel views | **Done:** Page/Map/Output rewritten; field/scope configuration remains Milestone B. |

### 10.2 Data flow

```
Panel                 Content engine                    Background
  │  INSPECT on  ─────▶ snapshot + picker + tree
  │  TREE        ◀───── lazy node summaries
  │  SELECT      ─────▶ highlight + selection
  │  PATTERNS    ◀───── applicability + evidence
  │  PATTERNS    ─────▶ scoped pattern extract (checked only)
  │  result      ◀───── data + diagnostics + schema draft
  │  SAVE        ─────────────────────────────────────▶ schema store
  │  MATCH (URL) ◀───────────────────────────────────── schema index
  │  RUN         ─────▶ locator resolve + extract + health
```

### 10.3 Message protocol (Milestone A as implemented)

- Panel → page: `INSPECT_START`, `INSPECT_STATE`, `INSPECT_STOP`, `INSPECT_TREE {nodeId}`, `INSPECT_SELECT {nodeId, scroll}`, `INSPECT_PATTERNS {nodeId, patterns}`, `INSPECT_RENDER {format}`, `INSPECT_RENDER_ALL {format}`.
- Page → panel: `NODE_SELECTED {selectedId, selected, breadcrumb, patterns, results, patternsReady, catalog, stats}`, `NODE_HOVERED {id}`, `PATTERNS_DETECTED {results, catalog, ...}`, `SHOW_OUTPUT`, `PATTERN_ERROR {error}`, `INSPECT_EXITED`.
- Panel → background: `SITE_GET/TOUCH`, `SITES_CLEAR`; Milestone B adds `SCHEMA_GET/LIST/SAVE/DELETE`, `SCHEMA_MATCH {url}`.
- `PING` and `LIGHT` remain. `ANALYZE`, `RENDER`, `FORMATS`, `SELECT`, `OVERLAY`, `DESTROY`, `INSPECT_APPLY` and `REGION_CLICKED` were **retired** in D-023: the fixture harness calls `Lasso.analyze()` and `Lasso.output.render()` directly.
- Node ids remain per session. Everything persisted (Milestone B) uses locator sets.

### 10.4 Charter compliance

- Page mutation remains limited to the closed shadow-root overlay (`data-lasso-overlay`); inspect mode adds highlight/menu there, not page styles.
- Detectors/patterns still return scored evidence; the user now chooses, so the score is a hint, not a verdict.
- No network, no `eval`; required host access is limited to `http(s)` and declared up front (D-018). There are no content scripts and injection remains on demand. The storage boundary and `textContent` rule are unchanged.
- Repairs are proposed, never silently applied.

---

## 11. Permissions, privacy, security

- **No additional permission** for the custom menu. Native `contextMenus` would add one; see §6.3.
- **Required host access** to `http://*/*` and `https://*/*` is declared so Chrome can inject after an extension reload without a per-site prompt. Chrome shows the all-sites warning at install; the engine still runs only on demand. `activeTab` remains as a fallback for restricted or site-limited tabs. There are no content scripts.
- Page content is read locally, never transmitted; saved recipes stay in `chrome.storage.local` behind the background worker.
- Inspect mode increases the amount of DOM read while active (the whole visible tree). Keep the existing caps, read-only guarantees and no-network audit. Do not log page content.
- Untrusted page strings reach the panel only through `textContent`; the tree and menu must be built with the existing safe DOM builder.
- Right-click capture is scoped to inspect mode only; outside it, Lasso must not hijack the page’s context menu.

---

## 12. Performance and accessibility

- **No page-wide pass on open.** The first visit is a light `LIGHT` read, as today.
- Snapshot on Inspect, not before. Tree expansion is lazy; cap serialised nodes and say when truncated.
- Hover work is throttled with `requestAnimationFrame`; highlighting uses geometry from the snapshot only when needed.
- Pattern application is scoped to the selection/siblings, not the whole document.
- Accessibility: real buttons, `aria-pressed` on Inspect, ARIA tree and menu, keyboard paths for every action, visible focus, no colour-only state, and a touch alternative to right-click.
- Respect `prefers-reduced-motion` for highlight transitions.

---

## 13. Testing strategy

The old auto-detect-first UI tests become legacy. The new gates:

- **jsdom unit tests** for scoped patterns: given a fixture + a selection path, Article/Table/List/Text return the expected data; sibling inference; container climbing; applicability reasons.
- **Locator and schema property tests**: mutate irrelevant attributes/classes → locator still resolves; replay health; import validation.
- **Playwright real-browser tests** (the harness infrastructure from the halted run is reusable):
  - first visit is quiet (no snapshot/detector call, no overlay),
  - Inspect toggles and the tree populates,
  - hover/click selection, tree↔page sync, breadcrumb,
  - right-click checkbox picker (Text default) then Detect selected + keyboard menu,
  - apply Article/Table/List/Text,
  - Output configuration + Save + one-click replay,
  - inspect off restores the page DOM,
  - restricted/no-permission/page-changed states.
- **Manual smoke checklist** rewritten for the inspect flow.
- Keep the no-network source scan, minimal-permission manifest check and storage-boundary check.
- Test limitation to keep visible: a real toolbar click/`activeTab` grant cannot be automated; the shipped all-site host permission covers the local fixture server, so no test-only manifest rewrite is needed.

---

## 14. Proposed milestones

Milestone A is implemented. The remaining pivot work is delivered in two gates, then polish:

| Milestone | Deliverable | Gate |
|---|---|---|
| **A — Inspect** | Inspect toggle, checkbox picker (Text default), DOM tree, breadcrumb, scoped Article/Table/List/Text + preview Chat/Contact, single Send gate, multi-result collapsed cards, Output preview, clean exit. No save. | On 10 fixture selections + 5 real sites, the checked patterns produce usable results; one result waits for Send, multiple results become collapsed cards; no page mutation outside the overlay; first visit performs no scan. |
| **B — Teach, save, replay** | Field/scope/format configuration, locator builder, schema store, Save validation, URL matching, one-click Run, health. | A saved recipe replays healthy on the current page and on fixture variants; one-click revisit works; no silent wrong data when broken. |
| **C — Teaching polish** | Field-level point-and-pick, transforms, better sibling inference, keyboard/a11y pass, onboarding, optional native context-menu entry. | Median time to first saved recipe ≤3 minutes with test users; keyboard-only flow complete. |
| **D — Robustness** | Healing proposals, more patterns, div-grids, pagination, iframes, performance budgets. | Variant replay ≥90% healthy; performance targets met. |
| Agents/batch | Old Phase 4. | Unchanged. |

This re-sequences the old plan: Phase 1 (schemas/locators) moves into Milestone B and is no longer optional; Phase 2 (click-to-pick/DOM map) moves into Milestone A; the auto-detect-first Phase 0 UI is not extended.

---

## 15. Acceptance criteria for the pivot

A build is “inspect-first” when all of these are true:

1. Opening the panel on a first visit performs no snapshot, detector run or page mutation; the panel shows page information and Inspect.
2. Inspect can be toggled on the active tab, is visibly active, and is disabled on restricted pages.
3. Hover highlights, click selects, right-click shows the checkbox picker (Text default), and Escape exits; no pattern detection runs until Detect selected; the page does not navigate during selection.
4. The Map tab shows a DOM tree that stays in sync with the page and can be navigated by keyboard.
5. Article, Table, List and Text can be applied to a selection; each returns data + diagnostics and a proposed schema draft.
6. Output allows fields, scope, format and name to be configured; Save persists a validated schema locally and shows the validation result.
7. A later visit lists matching recipes from local storage and runs one with a single Run click; health is shown.
8. Turning Inspect off removes every trace of Lasso except the page’s original DOM.
9. No network request is made; host access stays limited to `http(s)`; storage is written only by the background worker.
10. Restricted, missing-permission and page-changed cases produce clear messages.
11. Inspect state is per-tab: switching away leaves the previous tab’s session intact, the new tab starts inactive, and switching back restores the tree, selection and session stats. Navigation/reload/tab close ends the session and removes the overlay.

---

## 16. Open questions (decisions needed)

| # | Question | Recommendation |
|---|---|---|
| 1 | Right-click menu: custom overlay menu or native Chrome context menu? | Custom overlay menu; no new permission, dynamic pattern list, consistent accessibility. Native entry later if wanted. |
| 2 | Does “no page auto detection” mean remove Quick extract entirely? | Remove it from the default UI. Keep the internal detector logic for pattern applicability and benchmarks; do not ship a one-click auto-region button in the first pivot. |
| 3 | Selection gesture: left-click selects, right-click selects + opens menu? Or right-click only? | Both: left-click selects (DevTools-like), right-click selects + opens the checkbox picker (fast path). |
| 4 | MVP pattern set? | Article, Table, List, Text are the Milestone A core; Chat and Contact are preview extensions registered through the same API, with fixtures. Add Links/Images/Code only with a fixture and a real use case. |
| 5 | Is field-level picking (select a price, a title, a link) in Milestone A? | Not in A. Container patterns first; field-level picking in Milestone B/C. |
| 6 | What does “configure” include in the first save flow? | Fields (include/rename/required), scope, format, name. Transforms and field-level locators later. |
| 7 | “Every revisit is one click”: open panel + Run, or click toolbar and auto-run the only match? | Open panel + Run for the first release; optional auto-run setting later. |
| 8 | DOM tree detail: elements only, or text nodes/attributes? | Elements with a text preview and key attributes in a details pane; do not render text nodes in the tree. |
| 9 | Does Inspect survive tab switch/navigation? | **Confirmed 2026-10-26:** per-tab. Switching tabs does not exit the previous tab’s session; the new tab is inactive until the user activates it. Navigation/reload and tab close end the session and remove the overlay. |
| 10 | Keep the cheap page counts and site visit profile on first visit? | Yes — they are one-pass reads, not detection, and help orientation. |
| 11 | Keep page-type classification? | Not as a first-visit feature. Keep URL rules for schema matching; show classification only as diagnostics if useful. |
| 12 | Canonical slogan? | Confirm the draft in §1; do not use two competing headlines in the store and README. |

---

## 17. Baseline at the time of the pivot

For honesty, this is what exists today and what the halted smoke run found. None of it blocks the pivot; some of it will be retired.

**Built and green (jsdom):**
- Phase 0 engine: snapshot, repetition mining, Article/Table/Record-list detectors, arbitration, classification, Markdown/JSON/CSV, overlay, bridge.
- Side panel: inspect-first Page/Map/Output, per-tab Inspect toggle, lazy DOM tree, pattern buttons, hover/selection sync, session stats, Output preview; built-in Article/Table/List/Text plus preview Chat/Contact patterns; required all-site host access. Legacy Quick extract/Edit mode code retained for fixtures.
- `npm test`: 41 unit checks + 1 side-panel smoke + 11/11 fixture pages.

**Real-browser smoke harness (Playwright) added, then halted:**
- Infrastructure: unpacked build with the shipped `http(s)` host access (no test-only manifest rewrite needed), local fixture server, real Chrome, panel-as-tab bound to a fixture window, engine-state inspection via `chrome.scripting`.
- Before the halt: 9/14 scenarios passed. Findings worth carrying into the pivot:
  1. **Overlay cleanup — fixed in Milestone A:** inspect exit calls `L.overlay.destroy()`, which removes the host and listeners. Legacy Edit mode's empty-host quirk is not reachable from the default UI.
  2. **Panel state resets:** a tab event during a flow can re-run `stage0()` and wipe the analysis. The inspect session and selected node must be resilient to spurious stage-0/tab events.
  3. **Restricted-page message:** the harness produced the “permission” message instead of the “can’t run on browser pages” banner in one binding attempt. Verify the path before trusting the graceful-failure claim (may be a harness binding artifact).
  4. **Test limitations:** clipboard permission cannot be granted to a `chrome-extension://` origin by Playwright; a textarea normalises CRLF to LF (the downloaded file keeps CRLF); the real toolbar click cannot be automated.
- The old harness is `test/e2e.mjs`. It is **paused**: it still contains Phase 0 auto-detect assumptions and must be rewritten for the inspect flow before it is used as a gate. The inspect-only harness is `test/inspect-smoke.mjs` (`npm run test:inspect`), which builds `dist/` and currently passes 15/15 headless-Chromium scenarios.

**Not implemented from this vision:** field/scope configuration, locator builder, save/replay/health (Milestone B); field-level picking, transforms, onboarding (Milestone C); optional native context-menu entry. `Lasso.analyze()` remains available to the fixture harness but has no message entry point, and the region overlay it drew was removed in D-023.

---

## 18. Decision log

- **D-013 — Inspect-first replaces auto-detect-first as the target UX.** Owner direction, 2026-10-26. Consequences: the default UI stops scanning the page; patterns become user-invoked on a selection; the locator/schema work moves onto the critical path; the current auto-detect UI is the baseline, not the destination. Sub-decisions in §16 were confirmed by D-015 (Milestone A defaults).
- **D-012 — Phase 0 real-browser smoke harness (Playwright).** Added so the panel and engine can be exercised in real Chrome; the test-only host rewrite is no longer needed because D-018 ships host access. Harness paused pending the pivot.
- **D-018 — Required all-site web access for a smooth flow.** Owner direction, 2026-10-26. The shipped manifest declares `http://*/*` + `https://*/*`; no content scripts. Consequences: no per-site prompt after reload; Chrome shows the all-sites warning at install; CWS review must justify the scope.

---

## 19. What “done” looks like for the first user

A new user opens a page, sees only page info, clicks Inspect, points at the article, right-clicks, chooses **Article**, sees clean Markdown with a token count, names the recipe “This site’s articles”, saves it, and next week opens the panel and clicks **Run** once. Nothing was uploaded, nothing on the page was rewritten, and no detector guessed on their behalf.
