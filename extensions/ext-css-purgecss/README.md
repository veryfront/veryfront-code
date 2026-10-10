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
content snapshots from core. PostCSS loads picocolors, which reads `NO_COLOR`,
`FORCE_COLOR`, `TERM`, and `CI` to select terminal colors. The manifest, factory,
standalone test task and exact capability audit allow only those four environment
keys.

## Reproducible in-memory distribution

Upstream PurgeCSS 8.0.0 uses fast-glob, which introduces braces 3.0.3 and the
unpatched High advisory
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
The extension therefore ships a reviewed in-memory distribution of PurgeCSS 8,
with direct exact PostCSS 8.5.29 and selector-parser 7.1.6 dependencies. It retains
the upstream CSS algorithm and MIT attribution. Config-file, content-file and
stylesheet-file paths throw explicitly; those inputs are already outside the
provider-neutral in-memory contract.

Eight reversible source edits remove unused filesystem/glob imports and constants,
replace file operations with explicit rejection, and use block-scoped temporaries
in their original function scopes. Verify the bundled algorithm
against the pinned upstream source, offline, with:

```sh
deno run --frozen --allow-read scripts/build/prepare-purgecss-memory-source.ts
```

The verifier reconstructs the original upstream module and checks its pinned
SHA-256, checks the MIT license digest, and reproduces the exact bundled source.
`vendor-sources.json` binds the distribution version, source bytes and upstream
origin. SBOM generation verifies those bytes and includes the modified library,
its upstream pedigree and MIT license in both aggregate and extension outputs.
The engine cache identity includes the distribution version and source digest.

The frozen parser pin excludes versions affected by
[GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf).
The separately pinned typography parser finding remains retained for its own
disposition. This distribution does not require CPU-information access.

PurgeCSS does not expose an operation-level cancellation signal, so this
contract cannot interrupt an invocation after it enters the provider. Core
still validates all inputs before invocation and all outputs before use.
