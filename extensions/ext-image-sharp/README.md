# @veryfront/ext-image-sharp

> **Category:** Build | **Contract:** `ImageOptimizationEngine` | **Explicit**

Provides native raster image decoding, resizing, and encoding through the exact
Sharp dependency owned by this extension. Veryfront core depends only on the
first-party `ImageOptimizationEngine` contract and never discovers or imports
Sharp itself.

The npm package requires Node.js 20.9 or newer, matching Sharp 0.35's native
runtime floor. This does not change Veryfront core's runtime support because
the extension is installed and activated only by applications that opt in.

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

Enabling image optimization without a registered `ImageOptimizationEngine`
fails before build output is published. The extension statically binds its
exact Sharp package; it never searches global installations or project
workspaces and never uses the network to discover an implementation.

## Output semantics

For each source image, the engine emits every requested format for each unique
target width that does not exceed the auto-oriented source width. The source
width is always included exactly once. Variants are returned deterministically
by ascending width and then canonical format order (`webp`, `avif`, `jpeg`,
`png`). Sharp is always called with `withoutEnlargement: true`, and returned
dimensions and format metadata must match the planned variant.

The extension snapshots descriptor-only request data before native work and
uses an independent Sharp pipeline for every operation. Inputs, decoded pixels,
variant count, per-variant bytes, and aggregate output bytes are bounded. Each
request carries an abort signal used by core for cancellation and deadlines.
Sharp cannot interrupt every native call already in progress, so the extension
races native steps with that signal and discards any late result.

The extension requests only Sharp's import-time environment reads
(`MALLOC_ARENA_MAX` and `npm_package_config_libvips`), read access to
`/proc/self/exe` and `/usr/bin/ldd` for Linux libc detection, and native FFI for
its packaged libvips module. It requests no network, subprocess, or project
workspace capability.
