# @veryfront/ext-css-lightning

> **Category:** Build | **Contract:** `CSSOptimizationEngine` | **Activation:** Explicit

Provides parser-backed CSS optimization through pinned Lightning CSS and
Browserslist implementations. Veryfront core depends only on the
`CSSOptimizationEngine` contract; this package owns the vendor imports, browser
query grammar, target conversion, and native binary.

## Registration

Install and compose the extension explicitly:

```ts
import extCSSLightning from "@veryfront/ext-css-lightning";

export default defineConfig({
  extensions: [extCSSLightning()],
});
```

Core never probes the network, dynamically imports Lightning CSS, or substitutes
a regex/no-op implementation. Requested optimization fails with an actionable
missing-extension error until a provider is registered.

## Configuration

Browser queries are extension-owned input and are resolved exactly once for an
engine instance:

```ts
extCSSLightning({
  browserQueries: [">= 0.5%", "not dead"],
});
```

When omitted, the pinned Browserslist defaults are used. Configuration rejects
inherited fields, accessors, sparse arrays, custom iterators, unknown keys,
non-canonical strings, and queries that could load workspace configuration or
external statistics.

## Cache and failure semantics

`cacheIdentity` includes the extension semantics version, exact Lightning CSS
and Browserslist versions, selected native/WASM runtime, resolved targets, and
the pinned browser dataset. Core captures one immutable provider session for
each optimization operation, validates resource bounds and complete source-map
v3 output, and never switches providers midway through a publication.

Lightning parser errors, invalid UTF-8 output, missing requested source maps,
and unexpected source maps are fatal. The extension requests no filesystem,
network, or subprocess capability.

## Capabilities

- `env:read` for Lightning's native/WASM selector and Browserslist's documented
  cache and warning controls. The extension does not request Browserslist's
  dangerous external-configuration override.
- `native:ffi` for Lightning CSS's platform-specific Node-API binary.
