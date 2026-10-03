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
content snapshots from core. PurgeCSS 7 uses `glob`, whose matcher reads
`__MINIMATCH_TESTING_PLATFORM__` during module loading. Its PostCSS dependency
loads `picocolors`, which reads `NO_COLOR`, `FORCE_COLOR`, `TERM`, and `CI` to
select terminal colors. The extension scopes `env:read` to those five keys. Its
standalone test task grants the same keys, so module loading works even when
`FORCE_COLOR` is unset. The exact capability audit rejects unscoped environment
access and any additional key or capability. The extension requests no
filesystem, network, subprocess, native, or system capability.

PurgeCSS does not expose an operation-level cancellation signal, so this
contract cannot interrupt an invocation after it enters the provider. Core
still validates all inputs before invocation and all outputs before use.
