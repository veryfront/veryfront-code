# Choose a module loader

Veryfront has several module loaders because they admit different inputs and
produce different outputs. Choose the loader by boundary; they are not
interchangeable convenience wrappers.

## Quick reference

| Input and desired result                         | Entry point               | Location                                   |
| ------------------------------------------------ | ------------------------- | ------------------------------------------ |
| One source string to a React component           | `loadComponentFromSource` | `modules/react-loader/component-loader.ts` |
| One source string to its complete module exports | `loadModuleFromSource`    | `modules/react-loader/component-loader.ts` |
| A bounded batch of named component sources       | `loadComponentsUnified`   | `modules/react-loader/unified-loader.ts`   |
| A project file/source graph for SSR              | `SSRModuleLoader`         | `modules/react-loader/ssr-module-loader/`  |
| A compiled MDX program                           | `loadModuleESM`           | `transforms/mdx/esm-module-loader/`        |
| A render-orchestrator file and dependency graph  | `loadModule`              | `rendering/orchestrator/module-loader/`    |
| An API route handler file                        | `loadHandlerModule`       | `routing/api/module-loader/`               |
| An HTTP request for `/_vf_modules/*`             | `serveModule`             | `modules/server/`                          |

## Decision guide

1. If the input is an HTTP request for a browser or SSR module URL, use
   `serveModule`. It owns request classification, containment, response
   headers, and module transformation.
2. If the input is an API route file, use `loadHandlerModule`. It owns API
   handler extraction, HTTP-import policy, external dependency preparation,
   and direct host-process loading. The higher-level API request handler uses
   the separate preparation path when worker isolation is available.
3. If the input is compiled MDX program text, use `loadModuleESM`. It owns MDX
   metadata/component wiring and the MDX ESM cache.
4. If rendering needs to load a project file and recursively transform its
   dependencies, use the render orchestrator's `loadModule`.
5. If application code already has a source string:
   - use `loadComponentFromSource` when only the React component is needed;
   - use `loadModuleFromSource` when named exports are also needed;
   - use `loadComponentsUnified` for a bounded collection that should be
     transformed and imported together.
6. Use `SSRModuleLoader` directly only when the caller owns the SSR project,
   content-source, adapter, and import-map identities. Most hosted request
   paths reach it through a higher-level loader.

## Loader contracts

### Source component loaders

```typescript
import {
  loadComponentFromSource,
  loadModuleFromSource,
} from "#veryfront/modules/react-loader/index.ts";
```

Both functions require source code, its logical file path, the project root,
and a `RuntimeAdapter`. `loadComponentFromSource` validates and returns a React
component export; `loadModuleFromSource` returns the module namespace.

Both functions also require `dev`, the render mode of the current request.
`true` selects development semantics for every transform the load triggers: no
minification, no tree shaking, inline sourcemaps, and the dev-only SSR loader
branches. It is required rather than defaulted so that a production render
cannot inherit development semantics by omission.

Set `ssr: true` for server execution. In hosted code, also pass stable
`projectId`, `contentSourceId`, React version, and the request-bound import map
when it is already available.

`loadComponentsUnified` is for an in-memory batch. It validates the batch,
bounds aggregate input/output, limits transform and write concurrency,
materializes a temporary entry module, imports it, and cleans up its owned
temporary directory.

### SSR module loader

```typescript
import {
  createSSRImportMapIdentity,
  SSRModuleLoader,
} from "#veryfront/modules/react-loader/ssr-module-loader/index.ts";
```

`SSRModuleLoader` transforms local and cross-project dependency graphs for
server execution. Its reusable caches include:

- bounded process memory;
- content-hashed files under project/content-source cache directories;
- an optional distributed cache when explicitly initialized.

For hosted work, construct `importMapIdentity` from the immutable map resolved
for that exact project and content source. Omitting it is reserved for
standalone callers that intentionally accept ambient import-map resolution.

The loader fails when a required static dependency, transform, cache
validation, or capacity acquisition fails. Dynamic dependencies may be left
for runtime resolution when they are not required by the current execution
path.

### MDX ESM loader

```typescript
import {
  type ESMLoaderContext,
  loadModuleESM,
} from "#veryfront/transforms/mdx/esm-module-loader/index.ts";
```

Use this after MDX has been compiled to an ESM program. The loader resolves MDX
component imports, prepares the JSX runtime, materializes module dependencies,
and returns an `MDXModule`.

`strictMissingModules` defaults to `true`. Setting it to `false` enables the
legacy missing-module/stub behavior and should only be done by a trusted caller
that deliberately accepts incomplete output; it is not a generic recovery
mode.

### Render-orchestrator loader

```typescript
import {
  loadModule,
  type ModuleLoaderConfig,
} from "#veryfront/rendering/orchestrator/module-loader/index.ts";
```

This loader recursively transforms a render dependency graph, persists
content-addressed artifacts, and imports the resulting root module. The caller
provides request-scoped caches, adapter, project root, mode, and optional
cooperative cancellation/progress hooks.

Do not call it for API handlers or raw browser module requests. Those
boundaries have different security and response contracts.

### API route loader

```typescript
import {
  loadHandlerModule,
  type LoadModuleOptions,
} from "#veryfront/routing/api/module-loader/index.ts";
```

This loader validates that the route module stays inside the project, prepares
its dependency graph for the active runtime, enforces configured remote-import
hosts, imports it in the host process, and returns the supported HTTP method
handlers. A loaded module with no supported handler exports returns `null`;
missing files and build, validation, or execution failures are surfaced as API
errors. Hosted request handling may instead prepare the route for worker
execution; do not infer worker isolation from a direct `loadHandlerModule`
call.

### HTTP module server

```typescript
import { type ModuleServerOptions, serveModule } from "#veryfront/modules/server/index.ts";
```

`serveModule` handles canonical and legacy module URL prefixes, snippet
modules, cross-project modules, SSR query identities, release-aware response
caching, and HEAD response semantics. Hosted callers should supply a validated
request-bound `importMapIdentity` and the project/source identities used by
their filesystem adapter.

## Shared patterns

`#veryfront/modules/loader-shared/index.ts` exports path-validation helpers and
legacy import regexes. The regexes are suitable only for their documented,
bounded compatibility call sites. They do not parse JavaScript and must not be
used for new general source rewriting.

Use the module lexer/import-rewriter primitives under `transforms/` when an edit
must distinguish real imports and exports from comments, strings, templates,
or regular expressions.

## Migration reference

The former `module-loader/` MDX helper paths were consolidated under
`transforms/mdx/esm-module-loader/`:

| API                                                         | Current location                              |
| ----------------------------------------------------------- | --------------------------------------------- |
| `extractFrontmatter`, `extractMetadata`, `mergeFrontmatter` | `esm-module-loader/metadata/index.ts`         |
| `extractBalancedBlock`, `cleanModuleCode`, `parseJsonish`   | `esm-module-loader/metadata/string-parser.ts` |
| `extractComponentImports`, `resolveComponents`              | `esm-module-loader/components/resolver.ts`    |
| `loadJSXRuntime`                                            | `esm-module-loader/jsx/runtime-loader.ts`     |

Import these APIs through
`#veryfront/transforms/mdx/esm-module-loader/index.ts` where they are exported,
rather than recreating the removed legacy path.
