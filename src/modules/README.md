# Modules System

## Purpose

The modules system handles dynamic module loading, resolution, and React component discovery in Veryfront. It provides import map management, component registry, and module transformation for seamless integration of user code with the framework.

## Scope

### What this module does:

- Load and resolve React components dynamically
- Manage import map configuration
- Register and track loaded components
- Transform module paths for different environments
- Handle JSX/TSX compilation on-the-fly
- Resolve npm packages via CDN (esm.sh)
- Support both file-based and in-memory modules

### What this module does NOT do:

- Build-time bundling (see `build/`)
- Static analysis (see `rendering/`)
- HTTP serving (see `server/`)

## Architecture

```
modules/
├── index.ts                # Public API exports
├── module-resolver.ts      # Main module resolution logic
├── component-registry/     # Component tracking
│   ├── index.ts
│   ├── registry.ts         # Component registration
│   └── types.ts
├── import-map/             # Import map management
│   ├── index.ts
│   ├── loader.ts           # Load import maps
│   ├── merger.ts           # Merge multiple maps
│   ├── resolver.ts         # Resolve imports
│   ├── transformer.ts      # Transform paths
│   ├── default-import-map.ts
│   └── types.ts
└── react-loader/           # React component loading
    ├── index.ts
    ├── unified-loader.ts   # Main component loader
    ├── component-loader.ts # Load individual components
    ├── path-resolver.ts    # Resolve component paths
    ├── temp-directory.ts   # Temp file handling
    └── types.ts
```

## Key Exports

### Module Resolution

- `ModuleResolver` - Main resolver class
- `resolveModule(specifier, options)` - Resolve module path

### Component Registry

- `ComponentRegistry` - Track loaded components
- `registerComponent(path, component)` - Register component
- `getComponent(path)` - Retrieve component
- `clearRegistry()` - Clear all components

### Import Map

- `loadImportMap(projectDir)` - Load import map config
- `mergeImportMaps(maps)` - Merge multiple maps
- `resolveImport(specifier, map)` - Resolve import specifier
- `transformModulePath(path, options)` - Transform path

### React Loader

- `loadComponent(path, options)` - Load React component
- `UnifiedComponentLoader` - Unified loading interface
- `resolveComponentPath(path)` - Resolve component location

## Dependencies

### Internal

- `core/utils` - Path utilities, logging
- `core/config` - Configuration loading
- `platform/` - File system adapters

### External

- `esbuild` - JSX/TSX compilation
- `react` - React component loading

## Usage Examples

### Load React Component

```typescript
import { loadComponent } from "@veryfront/modules";

// Load a page component
const PageComponent = await loadComponent("/pages/index.tsx", {
  projectDir: "/path/to/project",
  mode: "development",
});

// Load with custom import map
const Component = await loadComponent("/components/Button.tsx", {
  projectDir: "/path/to/project",
  importMap: {
    imports: {
      "react": "https://esm.sh/react@18.3.1",
    },
  },
});
```

### Component Registry

```typescript
import { ComponentRegistry } from "@veryfront/modules";

const registry = new ComponentRegistry();

// Register component
await registry.registerComponent("/pages/index.tsx", IndexPage);

// Retrieve component
const Component = registry.getComponent("/pages/index.tsx");

// Check if exists
if (registry.has("/pages/about.tsx")) {
  const AboutPage = registry.getComponent("/pages/about.tsx");
}

// Clear registry (useful for HMR)
registry.clearRegistry();
```

### Import Map Management

```typescript
import { loadImportMap, mergeImportMaps, resolveImport } from "@veryfront/modules";

// Load project import map
const projectMap = await loadImportMap("/path/to/project");

// Merge with framework defaults
const defaultMap = {
  imports: {
    "react": "https://esm.sh/react@18.3.1",
    "react-dom": "https://esm.sh/react-dom@18.3.1",
  },
};
const merged = mergeImportMaps([defaultMap, projectMap]);

// Resolve import specifier
const resolved = resolveImport("react", merged);
// Result: 'https://esm.sh/react@18.3.1'

const aliased = resolveImport("@/components/Button", merged);
// Result: '/src/components/Button.tsx'
```

### Module Resolver

```typescript
import { ModuleResolver } from "@veryfront/modules";

const resolver = new ModuleResolver({
  projectDir: "/path/to/project",
  importMap: customImportMap,
});

// Resolve relative import
const resolved = await resolver.resolve("./Button", "/components/index.tsx");
// Result: '/components/Button.tsx'

// Resolve npm package
const pkg = await resolver.resolve("lodash", "/pages/index.tsx");
// Result: 'https://esm.sh/lodash@4.17.21'

// Resolve with alias
const aliased = await resolver.resolve("@/utils/helpers", "/pages/index.tsx");
// Result: '/src/utils/helpers.ts'
```

### Transform Module Path

```typescript
import { transformModulePath } from "@veryfront/modules";

// Transform for browser
const browserPath = transformModulePath("/src/components/Button.tsx", {
  mode: "browser",
  baseUrl: "http://localhost:3000",
});
// Result: 'http://localhost:3000/src/components/Button.tsx'

// Transform for build
const buildPath = transformModulePath("/src/components/Button.tsx", {
  mode: "build",
  outDir: "./dist",
});
// Result: './dist/_veryfront/components/Button.js'
```

## Import Map Configuration

### deno.json / import_map.json

```json
{
  "imports": {
    // Path aliases
    "@/": "./src/",
    "@components/": "./src/components/",
    "@utils/": "./src/utils/",

    // npm packages (via CDN)
    "react": "https://esm.sh/react@18.3.1",
    "react-dom": "https://esm.sh/react-dom@18.3.1",
    "lodash": "https://esm.sh/lodash@4.17.21",

    // Local packages
    "~lib/": "./lib/",

    // Specific remapping
    "old-package": "./node_modules/new-package/index.js"
  },
  "scopes": {
    "https://esm.sh/": {
      "react": "https://esm.sh/react@18.3.1"
    }
  }
}
```

## Module Resolution Algorithm

1. **Check Import Map Imports**
   - Exact match in `imports`
   - Prefix match for paths ending with `/`

2. **Check Import Map Scopes**
   - Match based on parent URL
   - Apply scoped imports

3. **Relative Path Resolution**
   - Resolve `./` and `../` relative to parent
   - Add file extensions if missing

4. **Bare Specifier Resolution**
   - Check node_modules (Node.js)
   - Check npm: URLs (Deno)
   - Fallback to esm.sh CDN

5. **File System Check**
   - Try with extensions: `.ts`, `.tsx`, `.js`, `.jsx`
   - Try index files: `index.ts`, `index.tsx`

## Performance

### Component Loading

- First load: ~10-20ms (includes compilation)
- Cached load: ~1-2ms (from registry)
- Memory usage: ~50KB per component

### Import Map Resolution

- Resolution: <1ms (hash map lookup)
- Merge: ~2ms per map
- Transform: ~0.5ms per path

### Registry

- Registration: O(1)
- Lookup: O(1)
- Memory: ~10KB overhead + components

## Testing

```bash
# Run all module tests
deno task test src/modules/

# Test component registry
deno task test src/modules/component-registry/

# Test import maps
deno task test src/modules/import-map/

# Test React loader
deno task test src/modules/react-loader/
```

## Related Modules

- [`rendering/`](../rendering/README.md) - Uses modules for component loading
- [`build/`](../build/README.md) - Bundles modules for production
- [`platform/`](../platform/README.md) - File system access
- [`core/config/`](../core/README.md) - Configuration management

## Troubleshooting

### Module Not Found

```typescript
// Enable verbose logging
import { ModuleResolver } from "@veryfront/modules";
import { logger } from "@veryfront/utils";

logger.level = "debug";

const resolver = new ModuleResolver({ projectDir });
try {
  const resolved = await resolver.resolve("./Button", parent);
} catch (error) {
  console.error("Resolution failed:", error);
  console.error("Search paths:", resolver.getSearchPaths());
}
```

### Import Map Not Applied

```typescript
// Verify import map loaded correctly
import { loadImportMap } from "@veryfront/modules";

const map = await loadImportMap(projectDir);
console.log("Loaded import map:", map);

// Check for syntax errors in import_map.json
```

### Component Registry Stale

```typescript
// Clear registry on file changes (HMR)
import { ComponentRegistry } from "@veryfront/modules";

const registry = ComponentRegistry.getInstance();

// On file change
registry.remove("/components/Button.tsx");
// Or clear all
registry.clearRegistry();
```

### JSX Compilation Errors

```typescript
// Check esbuild configuration
import { loadComponent } from "@veryfront/modules";

try {
  const Component = await loadComponent(path, {
    projectDir,
    jsx: "react-jsx", // or 'react' for classic runtime
    jsxImportSource: "react",
  });
} catch (error) {
  console.error("Compilation failed:", error);
}
```

## Maintainer Notes

**Team:** Core Infrastructure Team
**Stability:** Stable (v0.1.0+)
**Performance Critical:** Yes (runs on every page render)

This module is critical for dynamic loading - optimize for speed and caching.
