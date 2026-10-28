# Lasso — Instructions for Coding Agents

Read this file, then `docs/MASTER_SPEC.md`, `docs/ARCHITECTURE.md` and `docs/BUILD_PLAN.md`. Work **one phase at a time**, stop at its gate, report, and wait for "next".

> This supersedes any earlier monorepo-based brief (`packages/core`, `packages/extension`, `SPRINT-1.md`). The project is now a **single standard Chrome MV3 extension** with no build step.

## Current state
Milestone A of the inspect-first pivot is implemented (2026-10-26; revised 2026-10-27 to a default-Text checkbox picker, selected-only detection, single-result Send, and multi-result Output cards — D-021): per-tab Inspect toggle, live DOM tree, breadcrumb, scoped Article/Table/List/Text + preview Chat/Contact detection, hover/selection sync, session stats, Output preview, and required all-site `http(s)` host access (D-018/D-021). `npm test` is green: 47 unit checks + 1 side-panel smoke + 11/11 fixtures. `npm run test:inspect` builds `dist/` and runs the headless-Chromium inspect smoke (15/15 scenarios); a 5-site public-web spot check also passed. **Your next task is the Milestone A real-browser gate:** run `npm install && npm test && npm run test:inspect`, then walk the owner through the remaining manual Chrome checks (native side panel/toolbar, install warning, extension reload, checkbox picker, single Send gate, multi-result collapsed cards) in `docs/BUILD_PLAN.md` §1.1. Turn every defect into a fixture (or panel-smoke assertion) first, then a fix. Do not start Milestone B (fields/scope/save/replay) until the owner confirms the Milestone A gate.

> **Direction — 2026-10-26 (Milestone A implemented):** the target UX is **inspect-first**, not page-wide auto-detection. The user points at a part of the page, chooses a pattern, configures and saves a recipe, and replays it with one click. Read `docs/VISION.md` before extending the panel or the engine. The old Phase 0 auto-detect UI is retained only for fixtures and the paused e2e harness; do not add features to it.

## Hard rules (the charter, short form)
1. Never mutate the page except the closed shadow-root overlay (`70-overlay.js`).
2. Detectors return scored candidates with evidence. No fixed confidences; label uncalibrated values.
3. Node ids are per-run only; persisted data uses locator sets.
4. One locator module builds/resolves selectors (Phase 1).
5. **No network:** no `fetch`/XHR/WebSocket/`eval`/`new Function` in shipped code (a unit test scans `src/`).
6. `chrome.*` only in `70-overlay.js` (messaging), `90-bridge.js`, the panel, and the background worker.
7. Storage only in the background worker.
8. Page-derived strings reach the DOM via `textContent` only (`src/sidepanel/dom.js`).
9. Keep zero runtime dependencies and no build step. If you believe a bundler is needed, write a `docs/DECISIONS.md` entry and ask first.
10. Behaviour changes update `docs/MASTER_SPEC.md` in the same change.

## Layering (engine, `src/content/`)
Files are classic scripts loaded in filename order; a file may only use lower-numbered layers. New files must be added to `src/shared/content-files.js` (a unit test checks the list). See `docs/ARCHITECTURE.md` §3 and §5 for the extension points and the planned file slots per phase.

## How to work
- **Fixtures first:** a bug or a new capability starts as a fixture + an entry in `test/fixtures/expected.json` (edit `test/make-fixtures.py`, run `npm run fixtures`), then the fix.
- Keep `npm test` green. Jsdom has no layout: do not claim layout/perf behaviour from it; those checks arrive with the Phase 1 real-browser harness.
- Small commits, clear messages. Log real alternatives in `docs/DECISIONS.md`.
- If reality contradicts the spec (an API behaves differently, a library is unmaintained), do not silently work around it: record it and flag it in your report.
- Every phase ends with a short report: what was built, what passed (numbers), what failed and why, what was deferred, proposed next step. Then stop.

## Suggested first prompt
> Read `AGENTS.md` and the three docs. Summarise the scope in 10 lines and list any ambiguities or conflicts. Run `npm install && npm test` and report. Then walk me through the Milestone A inspect smoke checklist step by step, and for each defect I report, add a fixture/panel-smoke assertion and fix it. Do not start Milestone B.
