# Lasso — Page Data Extractor (Chrome extension)

> **Direction — 2026-10-28 (Milestone B slice in progress):** the UX is **inspect-first** — point at any part of a page, pick a pattern, configure/save the recipe, replay it, and inspect extraction health. Read `docs/VISION.md` before contributing.

**Teach a page once. Extract it forever. Nothing leaves your browser.**

Lasso lets you point at any part of a page and export it as clean **Markdown, JSON or CSV**. Milestone A provides inspect mode, a live DOM tree, scoped patterns and output preview. The Milestone B slice adds versioned recipe validation, bounded replay, saved recipe storage, and health states.

- **Local-first:** no account, no cloud, no network requests, no analytics.
- **Permissions:** required `activeTab`, `scripting`, `sidePanel`, `storage`, plus host access to `http://*/*` and `https://*/*`.
- **No build step, no runtime dependencies:** plain JavaScript you can read in an afternoon.
- **Bounded recipes:** recipe count, field count, selector length, replay items, and replay text are capped.

> **Status: Milestone B vertical slice.** The code has not been executed in this environment. Run `npm ci`, `npm test`, `npm run build`, and `npm run test:browser` before treating this branch as passing.

## Milestone B recipe shape
A validated recipe contains a version, URL match, optional root/item selectors, and field selectors:

```js
{
  schemaVersion: 1,
  id: 'products',
  name: 'Products',
  kind: 'record_list',
  match: { domain: 'example.com', pathPattern: '/products/*' },
  rootSelector: '.catalog',
  itemSelector: '.product',
  fields: [
    { key: 'title', selector: '.title' },
    { key: 'url', selector: 'a' }
  ]
}
```

Replay reports one of these health states: `healthy`, `partial`, `fields-missing`, `no-items`, or `root-missing`.

## Develop
```bash
npm ci
npm test
npm run test:recipe
npm run build
npm run test:browser
npm run test:all
npm run perf
```

The legacy `test/e2e.mjs` remains inactive because it targets the retired Phase 0 UI. Native Chrome validation remains a manual release gate.

## Privacy
Page content is processed on your device and never transmitted. Saved recipes and site profiles remain in `chrome.storage.local`. See `docs/PRIVACY.md`.

## Contributing and licence
Add a fixture first, then the fix; keep `npm test` green; log decisions in `docs/DECISIONS.md`. MIT licensed (see `LICENSE`).
