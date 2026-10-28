# Lasso — Page Data Extractor (Chrome extension)

> **Direction — 2026-10-26 (Milestone A implemented):** the UX is **inspect-first** — point at any part of a page, pick a pattern, configure/save the recipe (Milestone B), replay with one click. The default panel is inspect-first; the old Phase 0 auto-detect flow is retained only for fixtures and the paused legacy e2e harness. Read `docs/VISION.md` before contributing.

**Teach a page once. Extract it forever. Nothing leaves your browser.**

Lasso lets you point at any part of a page and export it as clean **Markdown, JSON or CSV**. Milestone A gives you a per-tab inspect mode, a live DOM tree, scoped Article/Table/List/Text patterns and an Output preview. Per-site saved recipes with one-click replay arrive in Milestone B.

- **Local-first:** no account, no cloud, no network requests, no analytics.
- **Permissions:** required `activeTab`, `scripting`, `sidePanel`, `storage`, plus host access to `http://*/*` and `https://*/*`. Chrome warns at install that Lasso can read and change data on websites. The engine is injected only when you open Lasso and start Inspect; page content never leaves the browser.
- **No build step, no runtime dependencies:** plain JavaScript you can read in an afternoon.
- **Measured, not assumed:** `npm run perf` times the engine in real Chromium at 1k/5k/25k nodes (see `docs/MASTER_SPEC.md` §12 for the current numbers, including the 25k main-thread budget Lasso still misses).

> **Status: Milestone A.** The local test suite covers unit, side-panel, and fixture checks. `npm run test:browser` builds `dist/` and runs the headless-Chromium inspect smoke suite. The native-Chrome gate remains; use the checklist in `docs/BUILD_PLAN.md` §1.1. The legacy `test/e2e.mjs` is not an active gate because it targets the retired Phase 0 UI.

## Install (developer mode)
1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this folder (the one containing `manifest.json`).
3. Pin the Lasso icon. Requires Chrome 116 or newer.

## Use
1. Open any regular web page and click the **Lasso** icon — the side panel opens on **Page** with site basics. No page scan happens yet.
2. Click **Inspect**. The active tab enters inspect mode and **Map** shows a live DOM tree. Hover the page to highlight, left-click to select, then right-click (or use the Map checkboxes). **Text** is checked by default; choose one or more patterns and click **Detect selected**.
3. One pattern shows a short result view with **Send to Output**. Multiple patterns go straight to **Output** as collapsed cards — expand one to read or copy it. Choose Markdown / JSON / CSV; **Copy** or **Download**. Token count is an estimate.
4. Toggle Inspect off or press **Escape** to remove the overlay. Inspect is per-tab: switching tabs leaves each tab's session intact; reload/navigation ends it.

The panel follows the active tab. All-site host access means you do not need a toolbar click on every tab; Inspect state stays per-tab.

## Patterns in Milestone A
| Pattern | Examples | Notes |
|---|---|---|
| Article | blog posts, news, docs pages | title, author, date, headings, body as Markdown; navigation, cookie banners, hidden text and footers are left out |
| Table | `<table>` and ARIA grids | header detection, `colspan`; nested in articles is fine |
| List | product grids, blog indexes, search results | repetition mining; items → title, url, image, price, date, snippet |
| Chat *(preview)* | AI chat threads | repeated message blocks; role from common `data-*`/class hints; falls back to `message` |
| Contact *(preview)* | footer/imprint/contact blocks | name, emails, phones, addresses and links from the selected footer |
| Text | any selected element | clean text/Markdown fallback |

Patterns are registered through `L.inspect.registerPattern`; a new pattern is a small file that calls it (see `docs/ARCHITECTURE.md` §5). Detection is scoped to the selected region and only the checked patterns run. Not yet: fields/scope configuration, save/replay/health (Milestone B); field-level picking, div-grids without ARIA roles, pagination/infinite scroll (Milestone C/D). Full list: `docs/VISION.md` §14.

## Develop
```bash
npm install          # dev only: jsdom for tests
npm test             # unit + side-panel smoke + fixture corpus
npm run test:unit    # unit checks only
npm run test:panel   # side-panel smoke only
npm run test:fixtures # fixture corpus only
npm run test:browser # build + headless-Chromium inspect smoke
npm run test:all     # local suite plus browser smoke
npm run perf         # engine timings at 1k/5k/25k nodes (measurement only)
npm run build        # assemble the unpacked extension into dist/
npm run fixtures     # regenerate fixtures (python3)
```

GitHub Actions runs the local suite, build, and browser smoke checks on pushes and pull requests. The native Chrome checklist remains a manual release gate.

After editing code: `chrome://extensions` → reload Lasso, reopen the panel, and start Inspect. Existing tabs can be re-injected without a page reload; a stale overlay host is removed on the next mount.

```
manifest.json   src/background/   src/sidepanel/   src/content/ (engine)   src/shared/
docs/           test/             assets/icons/
```
Read `docs/ARCHITECTURE.md` for layering rules and extension points (add a detector, format or tab in a few lines). Behaviour is defined in `docs/MASTER_SPEC.md`; the schedule is in `docs/BUILD_PLAN.md`.

## Roadmap
A Inspect *(implemented; real-Chrome gate next)* → B Fields/save/replay → C Teaching polish *(private beta)* → D Robustness *(public beta, Web Store)* → Agents & batch *(Pro)* → Assist & sharing → Scale.

## Privacy
Page content is processed on your device and never transmitted. The only stored data is a small per-site visit profile (and, from Milestone B, your own recipes). See `docs/PRIVACY.md`.

## Contributing and licence
Add a fixture first, then the fix; keep `npm test` green; log decisions in `docs/DECISIONS.md`. MIT licensed (see `LICENSE`).
