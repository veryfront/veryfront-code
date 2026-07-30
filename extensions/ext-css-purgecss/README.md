# @veryfront/ext-css-purgecss

> **Category:** Build | **Contract:** `CSSPurgingEngine` | **Explicit**

Provides parser-backed unused-rule removal and critical/remaining CSS splitting
through PurgeCSS. Veryfront core owns only the dependency-free contract,
validation, resource limits, and filesystem collection; this extension owns the
third-party runtime.

## Registration

```ts
import extCSSPurgeCSS from "@veryfront/ext-css-purgecss";

export default defineConfig({
  extensions: [extCSSPurgeCSS()],
});
```

The extension is never imported or probed by core. A purge or critical-CSS
operation fails with the `missing-extension` error when no implementation is
registered. There is no regex, no-op, or dynamic-import fallback.

## Configuration and capabilities

The factory accepts no options. It consumes CSS and already-collected content
as bounded in-memory strings, so it requests no filesystem, network, environment,
subprocess, or native capability.
