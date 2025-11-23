# Build Module

The Build module provides the production build system for Veryfront, including static site generation, asset bundling, client runtime generation, and build manifest creation.

## Import Map Aliases

```typescript
// Using import map aliases (recommended)
import { buildProduction, copyStaticAssets } from "#server/build";
import { buildProduction } from "#server/build/build";

// Using barrel files
import { buildProduction, copyStaticAssets } from "./server/build/index.ts";
import { buildProduction } from "./server/build/build/index.ts";
```

## Public API Overview

The Build module exports:

### Main Module (`server/build/`)

- **Asset Generation** - `copyStaticAssets()`, `loadClientStyles()`, `AssetStats`
- **Client Runtime** - `generateAppModule()`, `generateClientModule()`, `generateRouterScript()`, `generatePrefetchScript()`, `generateImportMap()`
- **Build Manifest** - `generateManifest()`, `generateRedirects()`, `BuildManifest`, `ManifestOptions`
- **Static Site Generation** - `buildPagesRoutes()`, `buildAppRoutes()`, `PageRenderResult`, `SSGStats`, `SSGOptions`

### Build Orchestration (`server/build/build/`)

- **Orchestration** - `buildProduction()`, `cleanupCaches()`, `cleanupRenderer()`, `logBuildCompletion()`
- **Execution** - `executeBuild()`, `BuildExecutorOptions`, `BuildResult`
- **Initialization** - `initializeBuildContext()`, `normalizeBuildOptions()`, `BuildContext`
- **Setup** - `setupBuildDirectories()`
- **Cleanup** - Build cleanup utilities
- **Code Splitting** - `runCodeSplitting()`, `SplitResult`
- **Output Generation** - `generateClientScripts()`, `generateManifestAndServiceWorker()`, `generateRedirectsFile()`, `copyAssets()`
- **Route Collection** - Route discovery and collection utilities

## File Structure

```
server/build/
├── index.ts                      # Public API (barrel file) ← USE THIS
├── README.md                     # This file
├── asset-generation.ts           # Static asset handling
├── client-runtime.ts             # Client-side runtime generation
├── manifest.ts                   # Build manifest generation
├── static-generation.ts          # SSG implementation
└── build/                        # Build orchestration (has own barrel)
    ├── index.ts                  # Build orchestration barrel file ← USE THIS
    ├── build-orchestrator.ts     # Main build workflow
    ├── build-executor.ts         # Build execution logic
    ├── build-initializer.ts      # Build context initialization
    ├── build-setup.ts            # Directory setup
    ├── build-cleanup.ts          # Build cleanup utilities
    ├── code-splitter-orchestrator.ts  # Code splitting
    ├── output-generator.ts       # Output file generation
    └── route-collector.ts        # Route discovery
```

## Quick Start

### Run Production Build

```typescript
import { buildProduction } from "#server/build/build";
import { getAdapter } from "../../adapters/index.ts";

const adapter = await getAdapter();

const stats = await buildProduction({
  projectDir: "./my-app",
  outDir: "./dist",
  adapter,
  minify: true,
  sourceMaps: false,
});

console.log(`Built ${stats.totalPages} pages in ${stats.buildTime}ms`);
```

### Generate Static Sites

```typescript
import { buildPagesRoutes } from "#server/build";

const stats = await buildPagesRoutes({
  projectDir: "./my-app",
  outDir: "./dist",
  adapter,
  parallel: true,
});

console.log(`Generated ${stats.pagesBuilt} static pages`);
```

### Copy Static Assets

```typescript
import { copyStaticAssets } from "#server/build";

await copyStaticAssets(
  adapter,
  "/project/root",
  "/output/public",
);
```

### Generate Client Runtime

```typescript
import { generateAppModule, generateImportMap, generateRouterScript } from "#server/build";

// Generate main app module
const appCode = generateAppModule();

// Generate import map
const importMap = await generateImportMap();

// Generate router script
const routerCode = generateRouterScript();
```

## Key Concepts

### 1. Build Workflow

The production build follows these steps:

1. **Initialize** - Set up build context and options
2. **Setup** - Create output directories
3. **Collect Routes** - Discover all pages and API routes
4. **Generate Static** - Pre-render static pages
5. **Bundle Client** - Generate client-side runtime
6. **Code Split** - Split large bundles into chunks
7. **Generate Assets** - Copy static assets
8. **Create Manifest** - Generate build manifest
9. **Cleanup** - Clean up temporary files and caches

### 2. Static Site Generation (SSG)

Pre-render pages at build time:

```typescript
import { buildAppRoutes, buildPagesRoutes } from "#server/build";

// Build Pages Router routes
const pagesStats = await buildPagesRoutes({
  projectDir: "./app",
  outDir: "./dist",
  adapter,
  parallel: true,
  concurrency: 4,
});

// Build App Router routes
const appStats = await buildAppRoutes({
  projectDir: "./app",
  outDir: "./dist",
  adapter,
});
```

### 3. Build Manifest

The build manifest tracks all generated files:

```typescript
import { generateManifest } from "#server/build";

const manifest = generateManifest({
  routes: allRoutes,
  assets: staticAssets,
  chunks: codeChunks,
  version: "1.0.0",
});

// Save manifest
await Deno.writeTextFile(
  "dist/manifest.json",
  JSON.stringify(manifest, null, 2),
);
```

### 4. Client Runtime

Generate client-side JavaScript:

```typescript
import { generateClientModule } from "#server/build";

const clientCode = generateClientModule({
  hydration: true,
  routing: true,
  prefetching: true,
});
```

## Advanced Usage

### Custom Build Options

```typescript
import { type BuildOptions, buildProduction } from "#server/build/build";

const options: BuildOptions = {
  projectDir: "./app",
  outDir: "./dist",
  adapter,

  // Optimization options
  minify: true,
  sourceMaps: false,
  treeshake: true,

  // SSG options
  parallel: true,
  concurrency: 8,

  // Caching
  cache: {
    enabled: true,
    dir: ".cache",
  },

  // Output options
  publicPath: "/static/",
  assetPrefix: "https://cdn.example.com/",
};

const stats = await buildProduction(options);
```

### Code Splitting

Split large bundles into smaller chunks:

```typescript
import { runCodeSplitting } from "#server/build/build";

const splitResult = await runCodeSplitting({
  entryPoints: ["app.js", "router.js"],
  outDir: "./dist/chunks",
  splitting: true,
  chunkNames: "[name]-[hash]",
});

console.log(`Created ${splitResult.chunks.length} chunks`);
```

### Build Cleanup

Clean up after failed builds:

```typescript
import { cleanupCaches, performCleanup } from "#server/build/build";

// Clean up all build artifacts
await performCleanup({
  outDir: "./dist",
  cacheDir: ".cache",
  tempDir: ".tmp",
});

// Clean up caches only
await cleanupCaches({
  cacheDir: ".cache",
});
```

### Incremental Builds

Only rebuild changed pages:

```typescript
import { buildPagesRoutes } from "#server/build";

const stats = await buildPagesRoutes({
  projectDir: "./app",
  outDir: "./dist",
  adapter,
  incremental: true, // Only rebuild changed pages
  cache: {
    enabled: true,
    dir: ".cache",
  },
});

console.log(`Rebuilt ${stats.pagesRebuilt} of ${stats.totalPages} pages`);
```

### Build Monitoring

Monitor build progress:

```typescript
import { buildProduction } from "#server/build/build";

const stats = await buildProduction({
  projectDir: "./app",
  outDir: "./dist",
  adapter,
  onProgress: (event) => {
    console.log(`[${event.stage}] ${event.message}`);
  },
});

// stats includes:
// - totalPages: number
// - pagesBuilt: number
// - buildTime: number
// - errors: Error[]
```

## Build Statistics

The build system provides comprehensive statistics:

```typescript
interface SSGStats {
  totalPages: number;
  pagesBuilt: number;
  pagesFailed: number;
  buildTime: number;
  averagePageTime: number;
  errors: Array<{ slug: string; error: Error }>;
}
```

## Testing

Tests are located in `tests/integration/server/build/`:

```bash
deno test tests/integration/server/build/
```

## Module Boundaries

The `server/build/` module has established boundaries to ensure clean architecture and maintainability.

### Public API (via Barrel Files)

**Always import from barrel files** (`index.ts`):

```typescript
// CORRECT - Using import map aliases
import { buildProduction } from "#server/build/build";
import { copyStaticAssets } from "#server/build";

// ALSO CORRECT - Using barrel files directly
import { buildProduction } from "./server/build/build/index.ts";
import { copyStaticAssets } from "./server/build/index.ts";

// WRONG - Deep imports bypassing barrel files
import { buildProduction } from "./server/build/build/build-orchestrator.ts";
import { copyStaticAssets } from "./server/build/asset-generation.ts";
```

### Internal Files (Do Not Import Directly)

These are implementation details and should not be imported from outside the module:

**Main Module Internals**:

- `asset-generation.ts` - Internal asset handling
- `client-runtime.ts` - Internal runtime generation
- `manifest.ts` - Internal manifest creation
- `static-generation.ts` - Internal SSG implementation

**Build Orchestration Internals**:

- `build/build-orchestrator.ts` - Internal orchestration
- `build/build-executor.ts` - Internal execution
- `build/build-initializer.ts` - Internal initialization
- `build/build-setup.ts` - Internal setup
- `build/build-cleanup.ts` - Internal cleanup
- `build/code-splitter-orchestrator.ts` - Internal code splitting
- `build/output-generator.ts` - Internal output generation
- `build/route-collector.ts` - Internal route collection

### Enforcing Boundaries

Run the deep import linter to check for violations:

```bash
deno task lint:ban-deep-imports
```

This will detect any imports that bypass the barrel files and suggest corrections.

### Why Module Boundaries Matter

1. **Encapsulation**: Internal implementation can be refactored without breaking external code
2. **Clear API**: Public API is explicitly defined in one place (two barrel files)
3. **Maintainability**: Changes to internal files don't affect consumers
4. **Discoverability**: Developers know exactly what's public by reading `index.ts` files
5. **Type Safety**: Export types are properly managed and versioned

## Related Domains

- **rendering/**: Rendering system used during build
- **data/**: Data fetching for static generation
- **cli/**: CLI commands that trigger builds
- **server/**: Server implementations that serve built assets

## Performance Tips

1. **Use Parallel Builds** - Enable `parallel: true` for faster builds
2. **Enable Caching** - Use incremental builds with caching
3. **Optimize Concurrency** - Tune `concurrency` based on CPU cores
4. **Code Splitting** - Split large bundles into chunks
5. **Minify Output** - Enable minification for production

## Troubleshooting

### Build Fails with Out of Memory

```typescript
// Reduce concurrency
const stats = await buildPagesRoutes({
  // ...
  concurrency: 2, // Lower from default 4
});
```

### Assets Not Copied

```typescript
// Ensure public directory exists
await copyStaticAssets(adapter, projectDir, publicDir);
```

### Manifest Generation Fails

```typescript
// Check all routes are valid
const manifest = generateManifest({
  routes: validRoutes, // Ensure routes are properly formatted
  assets,
  chunks,
});
```
