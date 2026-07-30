# @veryfront/ext-css-lightning

> **Category:** Build | **Contract:** `CSSOptimizationEngine` | **Explicit**

Provides parser-backed CSS optimization for Veryfront through Lightning CSS and
Browserslist. The framework core depends only on the first-party
`CSSOptimizationEngine` contract; this package owns every concrete vendor import
and target-conversion detail.

## Registration

Install this extension and compose it explicitly in `veryfront.config.ts`:

```ts
import extCSSLightning from "@veryfront/ext-css-lightning";

export default defineConfig({
  extensions: [extCSSLightning()],
});
```

The extension is not auto-imported or probed by core. Enabling CSS optimization
or Tailwind post-processing without a registered engine fails with an actionable
install error; there is no no-op or regex fallback.

## Provided contract

`CSSOptimizationEngine` exposes one synchronous operation:

- `optimize(request)` parses and transforms CSS, optionally minifies it, applies
  application-selected browser compatibility queries, and returns a source-map
  v3 document when requested.

The implementation identity includes this extension version plus the installed
Lightning CSS and Browserslist versions, so caches cannot reuse output across
implementation or engine upgrades.

## Capabilities

- **env:** reads `CSS_TRANSFORMER_WASM` while selecting Lightning CSS's native
  or WASM implementation plus Browserslist's cache, extended-query security, and
  old-data warning controls.
- **native FFI:** loads Lightning CSS's platform-specific Node-API binary.

The extension requests no filesystem, network, or subprocess capability.

## Configuration

Browser compatibility expressions are optional factory configuration and are
resolved once when the extension is created:

```ts
extCSSLightning({
  browserQueries: [">= 0.5%", "not dead"],
});
```

When omitted, the pinned Browserslist defaults are used. Configuration must be
an own-property plain object; inherited properties, accessors, sparse arrays,
custom iterators, and unknown keys are rejected without invocation. Queries
that load external Browserslist configuration or statistics packages are also
rejected, so targets come only from this extension's pinned dependency graph.
