# @veryfront/ext-bundler-swc

> **Category:** Build | **Contract:** `Bundler` | **Explicit**

Adds an opt-in SWC TypeScript transform before Veryfront's esbuild graph
bundler. Use it for libraries that require legacy TypeScript decorator metadata,
such as class-validator, TypeORM, and constructor-based dependency injection.

The default Veryfront bundler remains esbuild. Projects that do not select this
extension keep the existing output and standard decorator behavior.

## Install

```bash
deno add npm:@veryfront/ext-bundler-swc
```

```bash
npm install @veryfront/ext-bundler-swc
```

## Configure

Register the extension explicitly in `veryfront.config.ts`:

```ts
import { defineConfig } from "veryfront";
import extSwc from "@veryfront/ext-bundler-swc";

export default defineConfig({
  extensions: [extSwc()],
});
```

Enable both legacy decorator flags in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

Veryfront follows inherited TypeScript configuration. The extension embeds
`reflect-metadata` before an opted-in decorated module runs, including prepared
worker modules and compiled runtime routes.

Trusted host execution can follow configuration outside the project directory.
Isolated preparation accepts parent and package configuration only when it stays
inside the project boundary, including project-owned `node_modules`. Copy an
external shared configuration into the project before using it in an isolated
runtime.

If `experimentalDecorators` is false or absent, the extension delegates source
unchanged to esbuild when Veryfront already needs a bundle or transform. Local
Deno routes keep their normal direct-import path. If only
`experimentalDecorators` is true, SWC emits legacy decorators without runtime
type metadata.

## What changes when you enable it

`experimentalDecorators: true` switches the TypeScript transform for the whole
project boundary, not just for decorated files. Every `.ts` and `.tsx` module in
the build graph is compiled by SWC instead of esbuild, so the emitted JavaScript
can differ in places that have nothing to do with decorators. Examples include
enum declaration merging and class-field initialization.

The extension reads only `experimentalDecorators` and
`emitDecoratorMetadata` from `tsconfig.json`. Veryfront bundle settings still
control the target and JSX transform. Other TypeScript emit settings, such as
`useDefineForClassFields`, are not forwarded to SWC.

The legacy SWC path does not compose source maps yet. A bundle or transform
that enables legacy decorators and requests a source map fails with an
actionable error instead of returning a map to generated JavaScript. Flags-off
calls continue to delegate source maps to esbuild.

When legacy decorators are enabled, local Deno API routes use per-route bundles
so their source passes through SWC. Two route bundles do not share module-level
state from a common imported project file. Put shared clients, pools, caches,
and registries behind a framework service or extension instead of relying on a
cross-route module singleton.

Treat turning the flag on as a transform swap, not as an addition. Re-run your
test suite after enabling it. Leaving `experimentalDecorators` false or absent
does not force local routes through bundling and keeps existing bundler calls on
the esbuild delegate.

## Runtime and packaging

The extension uses `@swc/wasm`, so one package works across Deno, Node.js, Bun,
and supported compiled binaries. It delegates module resolution, plugins,
incremental contexts, and final output generation to
`@veryfront/ext-bundler-esbuild`.

The WASM and reflection runtime stay in this explicit extension package. They
do not become dependencies of core or the default `veryfront` package. The SWC
WASM asset is about 20 MB, so distributions and compiled binaries that embed
the explicit extension must account for that size.
