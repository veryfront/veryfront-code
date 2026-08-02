# @veryfront/ext-css-purgecss

> **Category:** Build | **Contract:** `CSSPurgingEngine` | **Explicit**

Provides parser-backed unused-rule removal and critical/remaining CSS splitting
through PurgeCSS. Veryfront core owns the dependency-free contract, request and
result validation, resource limits, and filesystem collection. This extension
owns the third-party implementation.

## Registration

```ts
import extCSSPurgeCSS from "@veryfront/ext-css-purgecss";

export default defineConfig({
  extensions: [extCSSPurgeCSS()],
});
```

The extension is never imported, probed, or auto-loaded by core. A purge or
critical-CSS operation fails with a missing-extension error when no
`CSSPurgingEngine` is registered. There is no regex, no-op, dynamic-import,
network, or workspace fallback.

## Configuration and capabilities

The factory accepts no options. It receives only bounded in-memory CSS and
content snapshots from core. PurgeCSS loads `fast-glob`, which reads the CPU
count to size its concurrency, so the extension requests only `system:read`
with `apis: ["cpus"]`. In Deno this maps to `--allow-sys=cpus`. The extension
requests no filesystem, network, environment, subprocess, or native capability.

PurgeCSS does not expose an operation-level cancellation signal, so this
contract cannot interrupt an invocation after it enters the provider. Core
still validates all inputs before invocation and all outputs before use.
