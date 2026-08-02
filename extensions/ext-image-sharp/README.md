# @veryfront/ext-image-sharp

> **Category:** Build | **Contract:** `ImageOptimizationEngine` | **Explicit**

Provides native raster image decoding, resizing, and encoding through Sharp.
Veryfront core depends only on the first-party `ImageOptimizationEngine`
contract. This extension owns the Sharp import and native library boundary.

## Registration

Install this extension and compose it explicitly in `veryfront.config.ts`:

```ts
import extImageSharp from "@veryfront/ext-image-sharp";

export default defineConfig({
  extensions: [extImageSharp()],
  assetPipeline: {
    images: { enabled: true },
  },
});
```

The extension is not discovered or loaded by core. Enabling image optimization
without a registered `ImageOptimizationEngine` fails before build output is
published.

## Boundary and limits

Core reads and writes files, enforces input and output byte limits, validates
dimensions and result structure, applies a deadline, and owns atomic
publication. The extension receives immutable byte-oriented requests and owns
only decoding, resizing, and encoding.

Each request carries an abort signal. Sharp cannot interrupt every native
operation already in progress, but the extension checks cancellation before
and after every native step, and core discards results that arrive after the
deadline.

The extension declares the single import-time environment read performed by
Sharp (`npm_package_config_libvips`) and native FFI for the libvips module. It
requests no network, subprocess, or project-filesystem capability.
