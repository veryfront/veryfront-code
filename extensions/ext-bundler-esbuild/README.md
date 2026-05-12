# @veryfront/ext-bundler-esbuild

Veryfront extension that registers two contracts:

- **`Bundler`** — esbuild-backed module bundler (`EsbuildBundler`)
- **`ModuleLexer`** — es-module-lexer-backed ESM scanner (`EsModuleLexer`)

These are the default implementations Veryfront expects for both the runtime build pipeline and module-graph analysis. Without this extension, both surfaces throw an install-suggestion error.

## Installation

Add the extension to your project's `veryfront.config.ts`:

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
