# Modules system

## Purpose

The modules system resolves module specifiers, loads import maps, discovers React components,
transforms component source, and supports the internal module server used by Veryfront.

## Scope

This module:

- Resolves files, virtual modules, remote URLs, and bare package specifiers.
- Loads, validates, merges, and applies import maps.
- Discovers and tracks TSX and JSX components.
- Transforms and loads React component source for SSR and browser execution.
- Manages bounded in-memory and on-disk module caches.
- Serves transformed modules, batch manifests, API modules, and development WebSocket updates.
- Builds and validates route module manifests.

This module does not own production bundling, route matching, or application rendering. See
`build/`, `routing/`, and `rendering/` for those responsibilities.

## Architecture

```text
modules/
├── index.ts                # Supported module exports
├── module-resolver.ts      # File, virtual, URL, and package resolution
├── component-registry/     # Component discovery and metadata
├── import-map/             # Import map loading, merging, resolution, and transforms
├── loader-shared/          # Source-aware module specifier utilities
├── manifest/               # Route module manifest generation
├── react-loader/           # React source transforms and SSR loading
└── server/                 # Development module, API, batch, and WebSocket handlers
```

## Supported exports

The `#veryfront/modules` internal import exposes:

- `ComponentRegistry` and its component metadata types.
- `ModuleResolver` and its result and option types.
- `loadImportMap`, `preloadImportMap`, `clearImportMapCache`, `getDefaultImportMap`,
  `mergeImportMaps`, `resolveImport`, and `transformImportsWithMap`.
- `loadComponentFromSource` and `loadComponentsUnified`.
- `clearSSRModuleCache` and `clearSSRModuleCacheForProject`.
- `getGlobalTmpDir`, `getProjectTmpDir`, and `resetGlobalTmpDir`.
- `normalizeModulePath` and `resolveRelativePath`.

Server and loader internals use direct `#veryfront/modules/...` imports and are not exported from
the module entry point.

## Dependencies

The implementation uses Veryfront's runtime adapters for filesystem access, the shared transform
pipeline for TypeScript and JSX, the typed error registry, and the shared cache and observability
utilities. React is used only where component values are loaded or validated.

## Usage examples

The examples below are for code inside this repository. `#veryfront/modules` is an internal import
alias, not a package export.

### Load a React component from source

```typescript
import { loadComponentFromSource } from "#veryfront/modules";
import { runtime } from "veryfront/platform";
import { join } from "veryfront/platform/path";

const adapter = await runtime.get();
const projectDir = Deno.cwd();
const filePath = join(projectDir, "components", "Button.tsx");
const source = await adapter.fs.readFile(filePath);

const Button = await loadComponentFromSource(source, filePath, projectDir, adapter, {
  projectId: "local-example",
  ssr: false,
});
```

For SSR loading, set `ssr: true` and provide a stable `projectId` and `contentSourceId`. These
identities isolate cached modules between projects and content versions.

### Discover and inspect components

```typescript
import { ComponentRegistry } from "#veryfront/modules";
import { runtime } from "veryfront/platform";

const adapter = await runtime.get();
const registry = new ComponentRegistry({
  projectDir: Deno.cwd(),
  projectId: "local-example",
  adapter,
});

await registry.discover();
const button = await registry.loadComponent("Button");

if (button) {
  console.log(button.name, button.path);
}

registry.remove("Button");
registry.clear();
```

By default, discovery checks `components`, `islands`, `src/components`, and `src/islands`.
Filesystem components must be TSX or JSX files. Component names must be unique across configured
directories.

### Load and resolve an import map

```typescript
import { loadImportMap, resolveImport } from "#veryfront/modules";
import { runtime } from "veryfront/platform";

const adapter = await runtime.get();
const importMap = await loadImportMap(Deno.cwd(), adapter);
const reactSpecifier = resolveImport("react", importMap);

console.log(reactSpecifier);
```

`loadImportMap` merges framework defaults, the nearest `deno.json`, and Veryfront configuration in
that order. Later sources override earlier mappings. Invalid JSON or invalid import map shapes
produce a typed error.

### Resolve a module

```typescript
import { ModuleResolver } from "#veryfront/modules";
import { runtime } from "veryfront/platform";

const adapter = await runtime.get();
const resolver = new ModuleResolver({
  projectDir: Deno.cwd(),
  adapter,
  importMap: {
    "example-package": "https://esm.sh/example-package@1",
  },
});

const local = await resolver.resolve("./Button", "components/index.tsx");
const external = await resolver.resolve("example-package");

console.log(local, external);
```

Relative and project-root paths cannot escape `projectDir`. Bare specifiers that are not mapped
resolve to `https://esm.sh/<specifier>`.

### Transform imports with an import map

```typescript
import { transformImportsWithMap } from "#veryfront/modules";

const transformed = transformImportsWithMap(
  'import React from "react";',
  { imports: { react: "https://esm.sh/react@19" } },
  undefined,
  { resolveBare: true },
);

console.log(transformed);
```

The transformer parses ESM import and export specifiers. It does not rewrite matching text inside
comments, string literals, regular expressions, or template literal text.

## Import map configuration

Veryfront reads the nearest `deno.json` when loading an import map. The file must contain valid JSON
for this loader.

```json
{
  "imports": {
    "@components/": "./src/components/",
    "react": "https://esm.sh/react@19",
    "react-dom": "https://esm.sh/react-dom@19"
  },
  "scopes": {
    "https://esm.sh/": {
      "react": "https://esm.sh/react@19"
    }
  }
}
```

Relative targets from `deno.json` are omitted from the browser and SSR import map. Use Veryfront
configuration or framework mappings for targets that must be available to those runtimes.

## Resolution behavior

`resolveImport` applies the longest matching scope, then global mappings. Within each layer, exact
mappings take precedence over the longest valid trailing-slash prefix. It also understands esm.sh
package URLs and JavaScript extension fallbacks.

`ModuleResolver` applies virtual modules first, followed by import map mappings, remote URLs,
project-contained file resolution, and bare package resolution. File resolution checks supported
TypeScript, JavaScript, JSON, module, and CommonJS extensions, then matching `index` files.

## Resource limits and caching

Inputs, source sizes, registry sizes, discovery depth, concurrent transforms, WebSocket traffic,
and in-memory cache sizes have explicit bounds. Cache identities include project and content source
information where cross-project isolation is required. Call the matching cache-clear function when
source identity changes outside the normal lifecycle.

Do not rely on fixed latency or memory figures. Measure the target runtime and workload with the
repository's profiling and observability tools.

## Testing

Run the focused module suite from the repository root:

```bash
deno test --no-check --allow-all src/modules
```

Run a narrower area while iterating:

```bash
deno test --no-check --allow-all src/modules/import-map
deno test --no-check --allow-all src/modules/component-registry
deno test --no-check --allow-all src/modules/react-loader
```

## Troubleshooting

### A module does not resolve

Check the specifier and referrer passed to `ModuleResolver.resolve()`. Relative referrers are
interpreted from `projectDir`, and both the referrer and result must remain inside that directory.
The resolver returns `null` when a contained file cannot be found or a path escapes the project.

### An import map is not applied

Call `loadImportMap(projectDir, adapter)` and inspect the returned mappings in a development-only
diagnostic. Check that `deno.json` is valid JSON and that prefix keys and targets both end in `/`.
Remember that relative `deno.json` targets are filtered for browser and SSR loading.

### Component discovery is stale

Call `registry.clear()` and then `await registry.discover()` after the filesystem changes. There is
no global registry singleton. Each registry requires a project directory and runtime adapter.

### SSR loading reports a cache identity error

Provide a non-empty `projectId` and `contentSourceId`. Reuse the same values only for source that is
safe to share in the same cache namespace.

## Related modules

- `build/` creates production bundles.
- `platform/` supplies runtime and filesystem adapters.
- `rendering/` consumes loaded components during rendering.
- `routing/` owns route matching and API route integration.
- `transforms/` compiles and rewrites module source.
