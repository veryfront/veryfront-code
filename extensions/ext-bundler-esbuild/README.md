# @veryfront/ext-bundler-esbuild

> **Category:** Build | **Contracts:** `Bundler`, `ModuleLexer` | **Built-in**

Provides ESM bundling and module analysis for Veryfront's runtime build pipeline and module-graph analysis, backed by esbuild and es-module-lexer.

Registers two contracts:

- **`Bundler`** — esbuild-backed module bundler (`EsbuildBundler`)
- **`ModuleLexer`** — es-module-lexer-backed ESM scanner (`EsModuleLexer`)

Without this extension, both surfaces throw an install-suggestion error.

## Registration

This extension is auto-enabled by core bootstrap. Add it to `veryfront.config.ts` only when you need to override the built-in registration:

```ts
import extEsbuild from "@veryfront/ext-bundler-esbuild";

export default defineConfig({
  extensions: [extEsbuild()],
});
```

## Provided contracts

| Contract      | Implementation   | Backed by         |
| ------------- | ---------------- | ----------------- |
| `Bundler`     | `EsbuildBundler` | `esbuild`         |
| `ModuleLexer` | `EsModuleLexer`  | `es-module-lexer` |

Both classes are also exported by name so callers can construct an instance outside the registry:

```ts
import { EsbuildBundler, EsModuleLexer } from "@veryfront/ext-bundler-esbuild";
```

## Configuration

No factory options. The extension reads no environment variables and takes no config.

## Lifecycle

The factory's `teardown()` calls `EsbuildBundler.stop()` to release the esbuild service on shutdown.

All `EsbuildBundler` instances in a process share one module-level esbuild service and shutdown
barrier. Await `stop()` after bundler work, and dispose build contexts before stopping the service.

Use the Veryfront `Bundler` contract exclusively for asynchronous esbuild work. Starting the same
raw `esbuild` module outside this adapter makes its child process impossible to track retroactively.
The adapter rejects that mixed-ownership state and requires a process restart instead of reporting
an unverified shutdown as successful.

The service-child tracking matches the esbuild `0.28.1` process contract. Revalidate spawn capture,
plugin disposal ordering, and child-close tests before changing that version.
