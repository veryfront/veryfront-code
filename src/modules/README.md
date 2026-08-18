# Modules

`src/modules` owns Veryfront's project-module boundary: component source
discovery, import-map resolution, source-to-module loading, SSR module caching,
browser module serving, and route module manifests.

It does not own the complete transform pipeline, MDX compilation, render
orchestration, API-route execution, or production bundling. Those concerns live
under `transforms/`, `rendering/`, `routing/`, and `build/`.

## Architecture

| Area                              | Responsibility                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `component-registry/`             | Discover `.tsx` and `.jsx` component sources, retain immutable metadata, and load source text through a runtime adapter. |
| `import-map/`                     | Load, validate, merge, snapshot, resolve, and apply project import maps.                                                 |
| `module-resolver.ts`              | Resolve virtual, local, external, and npm module identities while containing filesystem access to a project root.        |
| `react-loader/`                   | Transform source strings into executable React modules or materialize a bounded batch of components.                     |
| `react-loader/ssr-module-loader/` | Transform dependency graphs for SSR and manage memory, disk, and optional distributed caches.                            |
| `server/`                         | Classify and serve browser/SSR module requests, data requests, and WebSocket traffic.                                    |
| `manifest/`                       | Track bounded route dependency graphs and generate escaped module-preload hints.                                         |
| `loader-shared/`                  | Shared path validation and narrow compatibility patterns used by loader implementations.                                 |

The normal hosted flow resolves an import-map snapshot for the authenticated
project and content source, binds that snapshot to a cache identity, transforms
the requested graph, and only then publishes reusable cache entries. Standalone
callers may omit an identity where the relevant option explicitly permits
ambient import-map resolution, but hosted request paths should not.

## Entry points

### Root API

`#veryfront/modules` exports the stable, general-purpose surface:

| Export                                                                         | Contract                                                                                                                             |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ComponentRegistry`                                                            | Discovers and reads component source metadata. It does not compile discovered files or populate React exports automatically.         |
| `ModuleResolver`                                                               | Resolves one specifier to a contained file, virtual module, external URL, or esm.sh npm URL. Missing or blocked paths return `null`. |
| `loadImportMap`, `mergeImportMaps`, `resolveImport`, `transformImportsWithMap` | Import-map loading and resolution.                                                                                                   |
| `loadComponentFromSource`                                                      | Transforms and imports one source string, returning its React component export.                                                      |
| `loadComponentsUnified`                                                        | Transforms and imports a bounded batch of named component sources.                                                                   |
| `clearSSRModuleCache`, `clearSSRModuleCacheForProject`                         | Explicit SSR cache invalidation.                                                                                                     |
| Path and temp-directory helpers                                                | Module-path normalization and project-scoped materialization support.                                                                |

Consult [`index.ts`](./index.ts) for the exact root exports. The following
specialized entry points are intentionally separate:

| Entry point                                                  | Primary exports                                                                     |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `#veryfront/modules/import-map/index.ts`                     | Import-map identity creation and validation in addition to the root import-map API. |
| `#veryfront/modules/react-loader/index.ts`                   | `loadModuleFromSource` and the React loader surface.                                |
| `#veryfront/modules/react-loader/ssr-module-loader/index.ts` | `SSRModuleLoader`, SSR import-map identities, cache controls, and cache statistics. |
| `#veryfront/modules/server/index.ts`                         | `serveModule`, `APIServer`, `RateLimiter`, and WebSocket lifecycle functions.       |
| `#veryfront/modules/manifest/index.ts`                       | Route module collection, lookup, invalidation, and preload hints.                   |
| `#veryfront/modules/loader-shared/index.ts`                  | Cross-project request validation and low-level compatibility patterns.              |

## Examples

### Resolve a project module

Every filesystem-facing API requires a runtime adapter. The caller owns the
adapter and project identity.

```typescript
import { ModuleResolver } from "#veryfront/modules";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

export async function resolveButton(adapter: RuntimeAdapter) {
  const resolver = new ModuleResolver({
    projectDir: "/workspace/site",
    adapter,
    importMap: {
      "analytics": "https://esm.sh/@example/analytics@1.2.3",
    },
  });

  return await resolver.resolve(
    "./Button",
    "components/index.ts",
  );
}
```

Relative and absolute project paths are checked lexically and, when the adapter
supports `realPath`, canonically. A path that escapes the project through `..`
or a symlink resolves to `null`.

### Discover and read component source

```typescript
import { ComponentRegistry } from "#veryfront/modules";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

export async function readButtonSource(adapter: RuntimeAdapter) {
  const registry = new ComponentRegistry({
    projectDir: "/workspace/site",
    adapter,
    componentDirs: ["components", "islands"],
  });

  await registry.discover();
  const button = await registry.loadComponent("Button");
  return button?.content;
}
```

Discovery ignores test/spec files, `node_modules`, directory indexes, and
non-JSX/TSX files. Duplicate basenames are rejected because the registry key is
the basename, not the relative path.

### Load a component from source

```typescript
import { loadComponentFromSource } from "#veryfront/modules";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

export async function loadPage(
  source: string,
  adapter: RuntimeAdapter,
) {
  return await loadComponentFromSource(
    source,
    "/workspace/site/pages/index.tsx",
    "/workspace/site",
    adapter,
    {
      projectId: "project-uuid",
      // Required. Pass the render mode of the current request. `true` selects
      // development semantics, so a production render must pass `false`.
      dev: false,
      contentSourceId: "preview-main",
      reactVersion: "19.1.1",
      ssr: true,
    },
  );
}
```

SSR loading resolves or accepts an import-map snapshot for the complete
dependency graph. Browser loading transforms and materializes a content-hashed
module before importing it.

### Merge and resolve import maps

```typescript
import { loadImportMap, mergeImportMaps, resolveImport } from "#veryfront/modules";
import type { VeryfrontConfig } from "#veryfront/config";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

export async function resolveReact(
  adapter: RuntimeAdapter,
  validatedConfig?: VeryfrontConfig,
) {
  const projectMap = await loadImportMap("/workspace/site", adapter, validatedConfig);
  const overrides = {
    imports: {
      "@app/": "/_vf_modules/app/",
    },
  };
  const importMap = mergeImportMaps(projectMap, overrides);

  return resolveImport("@app/page.js", importMap);
}
```

`mergeImportMaps` accepts maps as separate arguments. Later maps win for exact
keys, while scoped maps are merged per scope. `loadImportMap` applies framework
defaults, project `deno.json`, and Veryfront configuration in that order and
then enforces the framework React mappings. Its optional third argument accepts
an already validated request configuration; without it, the loader discovers
the project configuration from the project path.

## Operational contracts

- Project and cross-project paths are bounded and must remain inside their
  admitted roots. Encoded separators, traversal, and canonical symlink escapes
  are rejected at their respective request boundaries.
- Hosted module requests should carry the request-bound import-map identity.
  Cache entries are scoped by the identities that can change transformed
  output.
- Request-triggered browser graphs require either a root-bound stable snapshot
  reader or an own `symlinkSemantics: "none"` declaration paired with a genuine
  exact bounded byte reader. Browser compilation fails closed when an adapter
  cannot provide either authority; raw text reads are never a fallback.
- Browser graph compilation has fixed per-project and isolate-wide admission
  ceilings, bounded queues, dependency/probe/input/output limits, and a request
  deadline. Operator overrides may only tighten resource and duration limits.
- Component, manifest, lookup, response, and transform caches are bounded.
  Use the exported project-specific invalidation functions when project content
  changes.
- Missing project files generally return `null` or a not-found response.
  Malformed identities, unsafe paths, invalid source, and operational adapter
  failures are not converted into alternate dependency graphs.
- The regex constants in `loader-shared/patterns.ts` exist for narrow legacy
  consumers. New source rewrites should use the module lexer/import-rewriter
  primitives so comments and strings cannot be mistaken for imports.

For guidance on selecting between the source, SSR, MDX, render, API, and HTTP
loaders, see [`LOADER_GUIDE.md`](./LOADER_GUIDE.md).

## Verification

The repository's canonical tasks are:

```bash
deno task test:unit
deno task lint
deno task fmt:check
deno task lint:module-boundaries
```

During focused development, run the relevant files under `src/modules` with
the same preload, environment, and permissions used by the `test` task. Do not
omit the broader unit gate before merging a loader or cache change.

## Related areas

- [`build/`](../build/README.md): production compilation and artifacts
- [`config/`](../config/README.md): project configuration
- [`platform/`](../platform/README.md): runtime adapters and filesystem
  contracts
- [`rendering/`](../rendering/README.md): render orchestration
- [`routing/`](../routing/README.md): API and application routes
- [`transforms/`](../transforms/README.md): source transformation pipelines
