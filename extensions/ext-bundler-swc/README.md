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

If `experimentalDecorators` is false or absent, the extension delegates source
unchanged to esbuild. If only `experimentalDecorators` is true, SWC emits legacy
decorators without runtime type metadata.

## What changes when you enable it

`experimentalDecorators: true` switches the TypeScript transform for the whole
project boundary, not just for decorated files. Every `.ts` and `.tsx` module in
the build graph is compiled by SWC instead of esbuild, so the emitted JavaScript
differs in places that have nothing to do with decorators. The clearest example
is enum declaration merging: esbuild emits `(function (E) { ... })(E || {})`, so
a later block merges into the earlier one, while SWC emits
`(function (E) { ... })({})` and each block starts fresh.

Treat turning the flag on as a transform swap, not as an addition. Re-run your
test suite after enabling it. Leaving `experimentalDecorators` false or absent
keeps every module on esbuild with byte-identical output.

## Runtime and packaging

The extension uses `@swc/wasm`, so one package works across Deno, Node.js, Bun,
and supported compiled binaries. It delegates module resolution, plugins,
incremental contexts, and final output generation to
`@veryfront/ext-bundler-esbuild`.

The WASM and reflection runtime stay in this explicit extension package. They
do not become dependencies of core or the default `veryfront` package.
