# Lasso — Extraction, Locator, and Recipe Specification

> Version: 1.0.0
> Date: 2026-10-28

This specification defines the serializable data models and resolution engine used by Lasso to persist, share, and replay extractions across live DOM sessions and page reloads without relying on ephemeral snapshot node IDs.

---

## 1. Locator Schema

A **Locator** represents a target DOM element (or set of elements) using a multi-layered set of locational signals. Locators survive DOM mutations, class name obfuscation, and minor structural page updates.

```json
{
  "anchors": {
    "id": "main-content",
    "testid": "product-card-123",
    "aria": "Shopping Cart Summary",
    "role": "article"
  },
  "css": "main#main-content > section.products > article.product-card",
  "path": "BODY > MAIN:nth-of-type(1) > SECTION:nth-of-type(2) > ARTICLE:nth-of-type(1)",
  "fingerprint": {
    "tag": "ARTICLE",
    "classes": ["product-card", "item"],
    "attributes": {
      "data-category": "electronics"
    },
    "textSnippet": "Wireless Headphones Noise cancelling...",
    "childCount": 4,
    "depth": 4
  }
}
```

### Fields
- **`anchors`** *(object)*: Direct identifier signals.
  - `id` *(string|null)*: DOM `id` attribute (omitted if dynamically generated/hashy).
  - `testid` *(string|null)*: Data attributes such as `data-testid`, `data-test-id`, `data-qa`, `data-cy`.
  - `aria` *(string|null)*: Accessible name or label (`aria-label`, `aria-labelledby`).
  - `role` *(string|null)*: Explicit ARIA role (`role="..."`).
- **`css`** *(string)*: A stable CSS selector path excluding unstable or hashed class names (e.g. CSS-in-JS).
- **`path`** *(string)*: Structural index path from root or scope parent (e.g., `DIV:nth-of-type(2) > P:nth-of-type(1)`).
- **`fingerprint`** *(object)*: Structural and content similarity features.
  - `tag` *(string)*: Upper-case HTML tag name.
  - `classes` *(string[])*: Array of stable (non-hashy) class names.
  - `attributes` *(object)*: Key-value map of stable attributes (e.g., `type`, `name`, `href`, `src`).
  - `textSnippet` *(string)*: Normalized initial string content (up to 60 chars).
  - `childCount` *(number)*: Number of immediate element children.
  - `depth` *(number)*: DOM depth from document body or scope root.

---

## 2. Extraction Schema

An **Extraction** defines how content is located and transformed into output data.

```json
{
  "version": 1,
  "pattern": "records",
  "shape": "record_list",
  "scope": {
    "css": "main div.grid-container",
    "path": "BODY > MAIN > DIV:nth-of-type(1)",
    "anchors": { "id": null, "testid": "grid-container", "aria": null, "role": null },
    "fingerprint": { "tag": "DIV", "classes": ["grid-container"], "attributes": {}, "textSnippet": "", "childCount": 12, "depth": 2 }
  },
  "item": {
    "css": "div.product-card",
    "path": "DIV:nth-of-type(1)",
    "anchors": { "id": null, "testid": null, "aria": null, "role": "article" },
    "fingerprint": { "tag": "DIV", "classes": ["product-card"], "attributes": {}, "textSnippet": "", "childCount": 3, "depth": 1 }
  },
  "fields": {
    "title": {
      "name": "title",
      "type": "text",
      "locator": {
        "css": "h3.title, .product-title",
        "path": "H3:nth-of-type(1)",
        "anchors": { "id": null, "testid": "title", "aria": null, "role": null },
        "fingerprint": { "tag": "H3", "classes": ["title"], "attributes": {}, "textSnippet": "", "childCount": 0, "depth": 1 }
      }
    },
    "price": {
      "name": "price",
      "type": "text",
      "locator": {
        "css": "span.price",
        "path": "SPAN:nth-of-type(1)",
        "anchors": { "id": null, "testid": null, "aria": null, "role": null },
        "fingerprint": { "tag": "SPAN", "classes": ["price"], "attributes": {}, "textSnippet": "", "childCount": 0, "depth": 1 }
      }
    },
    "link": {
      "name": "link",
      "type": "attribute",
      "attribute": "href",
      "locator": {
        "css": "a[href]",
        "path": "A:nth-of-type(1)",
        "anchors": { "id": null, "testid": null, "aria": null, "role": null },
        "fingerprint": { "tag": "A", "classes": [], "attributes": {}, "textSnippet": "", "childCount": 0, "depth": 1 }
      }
    }
  }
}
```

### Pattern Types & Shapes
- **`records`** / `record_list`: Repeating items with extracted key-value fields.
- **`article`** / `article`: Long-form text content with headline, byline, and clean prose text/markdown.
- **`table`** / `table`: Structured tabular data with headers and row values.
- **`chat`** / `chat`: Conversational thread with role-attributed messages.
- **`contact`** / `contact`: Business or personal contact card (emails, phones, addresses, links).
- **`text`** / `text`: Scoped raw text subtree content.

---

## 3. Recipe Schema

A **Recipe** encapsulates an extraction alongside metadata, target site conditions, and optional user overrides.

```json
{
  "id": "recipe_1710000000000_a1b2c3",
  "name": "E-Commerce Product Grid",
  "description": "Extracts product name, price, and URL from search result pages",
  "urlPattern": "^https://.*\\.example\\.com/search.*",
  "extraction": { /* Extraction Schema */ },
  "createdAt": "2026-10-28T12:00:00.000Z",
  "updatedAt": "2026-10-28T12:00:00.000Z"
}
```

---

## 4. Locator Resolution Strategy

When resolving a Locator against a live DOM root (`rootEl`, defaulting to `document`), the engine executes four resolution strategies in waterfall order, returning `{ el, confidence, strategy }` or `{ elements, confidence, strategy }`.

```
                  ┌──────────────────────┐
                  │   Locator Input      │
                  └──────────┬───────────┘
                             │
                             ▼
                ┌──────────────────────────┐
                │ 1. Anchor Matching       │ ── (ID, data-testid, ARIA, Role) ──► Match? [Confidence 0.90 – 1.00]
                └──────────┬───────────────┘
                           │ No match
                           ▼
                ┌──────────────────────────┐
                │ 2. Stable CSS Selector   │ ── (querySelector / querySelectorAll) ──► Unique? [Confidence 0.85]
                └──────────┬───────────────┘
                           │ No match / ambiguous
                           ▼
                ┌──────────────────────────┐
                │ 3. Structural Path       │ ── (nth-of-type DOM traversal) ──► Match? [Confidence 0.70]
                └──────────┬───────────────┘
                           │ No match
                           ▼
                ┌──────────────────────────┐
                │ 4. Fingerprint Similarity│ ── (Tag, Classes, Text, Children) ──► Best candidate >= 0.5 [Confidence = score]
                └──────────┬───────────────┘
                           │ Below threshold
                           ▼
                  ┌──────────────────────┐
                  │ Resolution Failed    │ [Confidence 0.0, el = null]
                  └──────────────────────┘
```

### Resolution Rules & Confidence Calibration
1. **Anchor Strategy (Confidence 0.90 – 1.00)**:
   - Match by non-hashy `id` attribute: **1.00**
   - Match by test attribute (`data-testid`, `data-qa`): **0.95**
   - Match by `aria-label` or explicit `role`: **0.90**
2. **Stable CSS Strategy (Confidence 0.85)**:
   - Evaluates `css` selector. If `querySelectorAll` yields exactly 1 matching element (or when resolving multi-item collections, all matching elements): **0.85**.
3. **Structural Path Strategy (Confidence 0.70)**:
   - Traverses DOM hierarchy using `path` steps. Verifies that the resulting element matches expected tag name: **0.70**.
4. **Fingerprint Similarity Strategy (Confidence 0.50 – 0.84)**:
   - Scans candidate elements within `rootEl`.
   - Computes weighted score based on:
     - Tag equality (0.25)
     - Class name intersection (0.25)
     - Attribute match ratio (0.20)
     - Text content similarity / Levenshtein overlap (0.15)
     - Child count similarity (0.15)
   - Highest scoring candidate exceeding **0.50** is returned with `confidence = score`.

### Shadow DOM Resolution
The locator engine inspects shadow root bounds (`element.shadowRoot`). During CSS selector, path, or fingerprint resolution, open shadow roots are continuously traversed to ensure elements inside Web Components are resolved reliably.
