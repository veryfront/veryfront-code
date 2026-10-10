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
content snapshots from core. PurgeCSS 8 uses `fast-glob`; its PostCSS dependency
loads `picocolors`, which reads `NO_COLOR`, `FORCE_COLOR`, `TERM`, and `CI` to
select terminal colors. The extension scopes `env:read` to those four keys. Its
standalone test task grants the same keys. Fast-glob reads CPU information at
module load to choose its default concurrency, including for in-memory callers.
The extension declares only `system:read` with `apis: ["cpus"]`,
mapped to `--allow-sys=cpus`. The exact audit rejects unscoped system access,
other system APIs, additional environment keys and other capabilities.

Consuming applications must approve this CPU-information permission when upgrading.

The extension pins PurgeCSS 8.0.0. The frozen repository lock resolves its
`postcss-selector-parser` dependency to 7.1.6, the patched minimum for
[GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf).
Published consumers must also resolve that parser to at least 7.1.6: upstream's
range permits older versions in an existing consumer lockfile. The separately
pinned typography parser finding remains retained for its own disposition.

PurgeCSS does not expose an operation-level cancellation signal, so this
contract cannot interrupt an invocation after it enters the provider. Core
still validates all inputs before invocation and all outputs before use.
