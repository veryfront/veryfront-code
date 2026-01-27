# 011: Import Rewriting Implementations

## Executive Summary

The veryfront-renderer codebase contains **7 separate import rewriting implementations** totaling **1,038 lines of code**, each using different techniques (es-module-lexer, regex patterns) and handling different specifier types inconsistently. This fragmentation creates maintenance burden, behavioral inconsistencies between SSR and browser environments, and makes the system difficult to reason about.

---

## Sub-Analyses

| Document | Severity | Issue |
|----------|----------|-------|
| [011.0 - Import Rewriting RFC](./011.0-import-rewriting-rfc.md) | -- | Unified strategy proposal |
| [011.1 - Global Warning State Pollution](./011.1-global-warning-state-pollution.md) | HIGH | `unversionedImportsWarned` Set leaks between tenants |
| [011.2 - SSR/Browser Resolution Divergence](./011.2-ssr-browser-resolution-divergence.md) | HIGH | Same import resolves to different URLs |
| [011.3 - Regex vs Lexer Inconsistencies](./011.3-regex-vs-lexer-inconsistencies.md) | MEDIUM | Multi-line imports, dynamic imports handled differently |
| [011.4 - Multiple Parsing Passes](./011.4-multiple-parsing-passes.md) | MEDIUM | 4+ parse passes per module, 74% overhead |
| [011.5 - Import Map Resolution Gaps](./011.5-import-map-resolution-gaps.md) | MEDIUM | Scoped prefix matching, bare specifier defaults |

---

## The Problem

Import rewriting is a critical concern in a meta-framework that must transform user code for:
- **Browser execution**: Convert bare specifiers to esm.sh URLs
- **SSR execution**: Handle npm:, file://, and HTTP imports across Deno/Node/Bun
- **MDX compilation**: Rewrite imports in compiled MDX output
- **Module caching**: Rewrite esm.sh relative paths to absolute URLs

The codebase has evolved to handle these concerns with **7 different implementations**, each with its own:
- Parsing approach (lexer vs regex)
- Specifier handling logic
- Runtime-specific behavior
- Edge case handling

---

## Implementation Inventory

### 1. ESM Import Rewriter (Main Pipeline)

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/transforms/esm/import-rewriter.ts`
**Lines**: 183
**Approach**: es-module-lexer via lexer.ts wrapper

**What it rewrites**:
- HMR timestamps for local imports
- Bare specifiers to esm.sh URLs
- React packages to vendor bundle URLs
- Tailwind version pinning

**When it runs**: Transform pipeline RESOLVE_BARE stage (browser mode)

```typescript
// Core function - uses es-module-lexer through replaceSpecifiers
export function rewriteBareImports(
  code: string,
  _moduleServerUrl?: string,
  reactVersion?: string,
): Promise<string> {
  const reactImportMap = getReactImportMap(reactVersion ?? REACT_DEFAULT_VERSION);

  return withSpan(
    "transforms.esm.rewriteBareImports",
    () =>
      replaceSpecifiers(code, (specifier) => {
        const mapped = reactImportMap[specifier];
        if (mapped) return mapped;

        if (shouldSkipRewrite(specifier)) return null;

        const normalized = normalizeVersionedSpecifier(specifier);
        let finalSpecifier = normalized;

        if (normalized === "tailwindcss" || normalized.startsWith("tailwindcss/")) {
          finalSpecifier = normalized.replace(/^tailwindcss/, `tailwindcss@${TAILWIND_VERSION}`);
        } else if (!hasVersionSpecifier(specifier)) {
          warnUnversionedImport(specifier);
        }

        return `https://esm.sh/${finalSpecifier}?external=react&target=es2022`;
      }),
    { "transforms.code_length": code.length },
  );
}
```

**Skip conditions**:
```typescript
function shouldSkipRewrite(specifier: string): boolean {
  return (
    specifier.startsWith("http://") ||
    specifier.startsWith("https://") ||
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith("/") ||
    specifier.startsWith("@/") ||
    specifier.startsWith("#") ||
    specifier.startsWith("veryfront")
  );
}
```

---

### 2. MDX Import Rewriter

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/transforms/mdx/compiler/import-rewriter.ts`
**Lines**: 136
**Approach**: Regex-based line-by-line processing

**What it rewrites**:
- Relative imports (./,  ../) to file:// URLs (SSR) or /_veryfront/fs/ URLs (browser)
- file:// URLs to base64-encoded browser-friendly paths
- @/ aliases to module server URLs

**When it runs**: MDX compilation (after @mdx-js/mdx)

```typescript
// Line-by-line regex approach
function rewriteLine(
  line: string,
  basedir: string,
  target: CompilationTarget,
  baseUrl?: string,
): string {
  const mapper = (spec: string) => mapSpec(spec, basedir, target, baseUrl);

  return line
    .replace(
      /^(\s*import\s+[^'";]+?from\s+)(["'])([^"']+)(\2)/,
      (_m, p1, q, s, q2) => `${p1}${q}${mapper(s)}${q2}`,
    )
    .replace(
      /^(\s*import\s+)(["'])([^"']+)(\2)/,
      (_m, p1, q, s, q2) => `${p1}${q}${mapper(s)}${q2}`,
    )
    .replace(
      /^(\s*export\s+[^'";]+?from\s+)(["'])([^"']+)(\2)/,
      (_m, p1, q, s, q2) => `${p1}${q}${mapper(s)}${q2}`,
    );
}
```

**Special browser path encoding**:
```typescript
function toBrowserFs(abs: string, baseUrl?: string): string {
  if (abs.startsWith("http://") || abs.startsWith("https://")) return abs;

  const b64 = btoa(abs).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const path = `/_veryfront/fs/${b64}.js`;
  return baseUrl ? `${baseUrl}${path}` : path;
}
```

---

### 3. SSR Import Rewriter

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/modules/server/ssr-import-rewriter.ts`
**Lines**: 125
**Approach**: Regex-based with runtime detection

**What it rewrites**:
- Bare specifiers (react, etc.) to esm.sh URLs
- @/ aliases to /_vf_modules/ URLs with SSR params
- Relative imports (./, ../) with SSR params and cache busters
- npm: prefix handling (Deno-specific)

**When it runs**: SSR module loading (after transform pipeline)

```typescript
function rewriteBareImports(code: string, version?: string): string {
  const v = version ?? getReactVersion();
  return code.replace(/from\s+["']([^"'./][^"']*)["']/g, (_match, specifier: string) => {
    // Strip npm: prefix for resolution (npm: is Deno-specific)
    const bareSpecifier = specifier.startsWith("npm:") ? specifier.slice(4) : specifier;

    const reactUrl = resolveReactForRuntime(bareSpecifier, v);
    if (reactUrl) return `from "${reactUrl}"`;
    if (shouldKeepBareSpecifier(specifier)) return `from "${specifier}"`;

    // For third-party packages: Use esm.sh with external=react
    return `from "https://esm.sh/${bareSpecifier}?external=react&target=es2022"`;
  });
}

function rewritePathAliases(code: string, options: SSRRewriteOptions): string {
  const { projectSlug, branch, cacheBuster = Date.now(), crossProjectRef } = options;
  const projectParam = projectSlug ? `&project=${projectSlug}` : "";
  const branchParam = branch ? `&branch=${branch}` : "";

  return code.replace(/from\s+["']@\/([^"']+)["']/g, (_match, path: string) => {
    const jsPath = path.endsWith(".js") ? path : `${path}.js`;

    if (crossProjectRef) {
      return `from "/_vf_modules/_cross/${crossProjectRef}/@/${jsPath}?ssr=true&v=${cacheBuster}"`;
    }

    return `from "/_vf_modules/${jsPath}?ssr=true${projectParam}${branchParam}&v=${cacheBuster}"`;
  });
}
```

**Runtime-specific React resolution**:
```typescript
function resolveReactForRuntime(specifier: string, version?: string): string | null {
  // For Bun: Use local React paths from veryfront's node_modules
  if (!isDeno && !isNode) {
    const localPaths = getLocalReactPaths();
    const localPath = localPaths[specifier];
    if (localPath) return localPath;
  }

  // For Deno/Node: Use esm.sh URLs
  const v = version ?? getReactVersion();
  const reactMap = getReactImportMap(v);
  return reactMap[specifier] ?? null;
}
```

---

### 4. ESM Rewriter (Module Loader)

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/rendering/orchestrator/module-loader/esm-rewriter.ts`
**Lines**: 91
**Approach**: Regex-based with recursive fetch

**What it rewrites**:
- esm.sh relative paths (/pkg@version/...) to absolute https://esm.sh URLs
- esm.sh relative imports (./file) to resolved URLs
- All esm.sh URLs to local file:// paths (after download)

**When it runs**: During HTTP module fetching for Node.js SSR caching

```typescript
export function rewriteEsmPaths(code: string, urlBase: string): string {
  const resolveAbsolute: PathResolver = (path) => `https://esm.sh${path}`;
  const resolveRelative: PathResolver = (path) => new URL(path, urlBase).href;

  const patterns: Array<[RegExp, number, PathResolver]> = [
    // Absolute paths from esm.sh root
    [/import\s*(["'])(\/[^"']+)\1/g, 2, resolveAbsolute],
    [/from\s*(["'])(\/[^"']+)\1/g, 2, resolveAbsolute],
    [/export\s*\*\s*from\s*(["'])(\/[^"']+)\1/g, 2, resolveAbsolute],
    [/export\s*\{([^}]+)\}\s*from\s*(["'])(\/[^"']+)\2/g, 3, resolveAbsolute],

    // Relative paths resolved against current URL
    [/import\s*(["'])(\.\.?\/[^"']+)\1/g, 2, resolveRelative],
    [/from\s*(["'])(\.\.?\/[^"']+)\1/g, 2, resolveRelative],
    [/export\s*\*\s*from\s*(["'])(\.\.?\/[^"']+)\1/g, 2, resolveRelative],
    [/export\s*\{([^}]+)\}\s*from\s*(["'])(\.\.?\/[^"']+)\2/g, 3, resolveRelative],
  ];

  let result = code;
  for (const [pattern, pathIndex, resolver] of patterns) {
    result = result.replace(pattern, (...args) => {
      const match = args[0] as string;
      const path = args[pathIndex - 1] as string;
      const quote = (pathIndex === 3 ? args[2] : args[1]) as string;

      const resolved = resolver(path);
      const pathPattern = new RegExp(`${quote}${escapeRegExp(path)}${quote}`);
      return match.replace(pathPattern, `${quote}${resolved}${quote}`);
    });
  }

  return result;
}
```

---

### 5. Path Resolver (Multiple Functions)

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/transforms/esm/path-resolver.ts`
**Lines**: 279
**Approach**: es-module-lexer via replaceSpecifiers

**What it rewrites**:
- @/ aliases to relative paths or module server URLs
- Cross-project imports (project@version/@/path)
- @veryfront/* to veryfront/*
- #veryfront/* to /_vf_modules/_veryfront/*
- Relative imports (./, ../) to full paths

**When it runs**: Transform pipeline RESOLVE_ALIASES and RESOLVE_RELATIVE stages

```typescript
// @/ alias resolution
export function resolvePathAliases(
  code: string,
  filePath: string,
  projectDir: string,
  ssr = false,
): Promise<string> {
  return Promise.resolve(
    withSpanSync(
      "transforms.esm.resolvePathAliases",
      () => {
        const normalizedProjectDir = projectDir.replace(/\\/g, "/").replace(/\/$/, "");
        const relativeFilePath = getRelativeFilePath(filePath, normalizedProjectDir);
        const fileDir = relativeFilePath.substring(0, relativeFilePath.lastIndexOf("/"));
        const depth = fileDir.split("/").filter(Boolean).length;
        const relativeToRoot = depth === 0 ? "." : "../".repeat(depth).slice(0, -1);

        return replaceSpecifiers(code, (specifier) => {
          if (!specifier.startsWith("@/")) return null;

          const path = specifier.substring(2);
          const relativePath = depth === 0 ? `./${path}` : `${relativeToRoot}/${path}`;

          if (!/\.(tsx?|jsx?|mjs|cjs|mdx)$/.test(relativePath)) {
            return `${relativePath}.js`;
          }

          if (ssr) {
            return relativePath.replace(/\.(tsx?|jsx|mdx)$/, ".js");
          }

          return relativePath;
        });
      },
      { "transforms.ssr": ssr },
    ),
  );
}

// Cross-project import resolution
export function resolveCrossProjectImports(
  code: string,
  options: CrossProjectImportOptions,
): Promise<string> {
  return Promise.resolve(
    replaceSpecifiers(code, (specifier) => {
      const parsed = parseCrossProjectImport(specifier);
      if (!parsed) return null;

      const { projectSlug, version, path } = parsed;
      const modulePath = /\.(js|mjs|jsx|ts|tsx|mdx)$/.test(path) ? path : `${path}.tsx`;
      const projectRef = version === "latest" ? projectSlug : `${projectSlug}@${version}`;

      return `/_vf_modules/_cross/${projectRef}/@/${modulePath}`;
    }),
  );
}
```

---

### 6. Import Map Transformer

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/modules/import-map/transformer.ts`
**Lines**: 50
**Approach**: Regex-based with import map resolution

**What it rewrites**:
- Import specifiers using import map mappings
- esm.sh URLs to pinned versions from import map
- Bare specifiers (optional, controlled by resolveBare flag)

**When it runs**: Transform pipeline RESOLVE_BARE stage (SSR mode only)

```typescript
export function transformImportsWithMap(
  code: string,
  importMap: ImportMapConfig,
  scope?: string,
  options?: TransformOptions,
): string {
  const resolve = (specifier: string): string => resolveImport(specifier, importMap, scope);

  let transformedCode = code;

  // Static imports with from clause
  transformedCode = transformedCode.replace(
    /((?:import|export)\s+(?:[\w,{}\s*]+\s+from\s+)?|export\s+(?:\*|\{[^}]+\})\s+from\s+)["']([^"']+)["']/g,
    (_match, prefix, specifier) => {
      if (!shouldResolve(specifier, options)) return `${prefix}"${specifier}"`;
      return `${prefix}"${resolve(specifier)}"`;
    },
  );

  // Catch-all from clause
  transformedCode = transformedCode.replace(/from\s+["']([^"']+)["']/g, (match, specifier) => {
    if (!shouldResolve(specifier, options)) return match;
    return `from "${resolve(specifier)}"`;
  });

  // Dynamic imports
  transformedCode = transformedCode.replace(
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
    (_match, specifier) => {
      return `import("${resolve(specifier)}")`;
    },
  );

  return transformedCode;
}
```

---

### 7. Lexer Wrapper (Foundation Layer)

**File**: `/Users/mattboon/Sites/veryfront-renderer/src/transforms/esm/lexer.ts`
**Lines**: 174
**Approach**: es-module-lexer with HTTP URL masking

**What it provides**:
- `parseImports()`: Parse import statements
- `replaceSpecifiers()`: Replace specifier strings in imports
- `rewriteImports()`: Rewrite entire import statements

This is the **foundation** used by implementations #1 and #5.

```typescript
// URL masking to prevent es-module-lexer from parsing HTTP URLs as import paths
function maskHttpUrls(code: string): UrlMaskResult {
  const urlMap = new Map<string, string>();
  let counter = 0;

  const masked = code.replace(HTTP_URL_PATTERN, (_match, quote: string, url: string) => {
    const placeholder = `__VFURL_${counter++}__`;
    urlMap.set(placeholder, url);
    return `${quote}${placeholder}${quote}`;
  });

  return { masked, urlMap };
}

export async function replaceSpecifiers(
  code: string,
  replacer: (specifier: string, isDynamic: boolean) => string | null | undefined,
): Promise<string> {
  await initLexer();

  const { masked, urlMap } = maskHttpUrls(code);
  const [imports] = parse(masked);

  let result = masked;

  // Process imports in reverse order to preserve offsets
  for (let i = imports.length - 1; i >= 0; i--) {
    const imp = imports[i];
    if (!imp?.n) continue;

    const originalSpecifier = unmaskHttpUrls(imp.n, urlMap);
    const replacement = replacer(originalSpecifier, imp.d > -1);

    if (!replacement || replacement === originalSpecifier) continue;

    // Handle dynamic imports with proper quote preservation
    const isDynamic = imp.d > -1;
    if (isDynamic) {
      const quote = result[imp.s];
      if (quote === '"' || quote === "'" || quote === "`") {
        result = result.substring(0, imp.s) + quote + replacement + quote + result.substring(imp.e);
      } else {
        result = result.substring(0, imp.s) + replacement + result.substring(imp.e);
      }
    } else {
      result = result.substring(0, imp.s) + replacement + result.substring(imp.e);
    }
  }

  return unmaskHttpUrls(result, urlMap);
}
```

---

## Behavioral Differences

### Same Import, Different Handling

| Import | ESM Rewriter | MDX Rewriter | SSR Rewriter | Path Resolver |
|--------|-------------|--------------|--------------|---------------|
| `react` | esm.sh URL | Unchanged | esm.sh or local file:// | Unchanged |
| `@/Button` | Skip | Module server URL | Module server URL + SSR params | Relative path |
| `./utils` | Skip | file:// or /_veryfront/fs/ | Add .js + SSR params | Module server URL |
| `npm:lodash` | Skip | Unchanged | Strip prefix (Deno) | Unchanged |
| `file://...` | Skip | Pass-through or encode | Keep | Convert to relative |

### Runtime Differences

| Runtime | React Resolution | npm: Handling | file:// Handling |
|---------|-----------------|---------------|------------------|
| Deno | esm.sh URLs | Keep as-is | Direct use |
| Node.js | esm.sh URLs (cached) | Convert to esm.sh | Direct use |
| Bun | Local file:// paths | Convert to esm.sh | Direct use |

---

## Duplication Analysis

### Duplicate Logic Across Files

1. **Skip condition checking** (appears in 5 places):
   ```typescript
   // All check similar patterns:
   specifier.startsWith("http://") ||
   specifier.startsWith("https://") ||
   specifier.startsWith("./") ||
   specifier.startsWith("../")
   ```

2. **React import mapping** (appears in 4 places):
   - `getReactImportMap()` in package-registry.ts
   - `resolveReactForRuntime()` in ssr-import-rewriter.ts
   - `ssrReactImports` in react-imports.ts
   - Import map resolution in resolver.ts

3. **esm.sh URL building** (appears in 4 places):
   - `rewriteBareImports()` - bare to esm.sh
   - `ssr-import-rewriter.ts` - bare to esm.sh
   - `esm-rewriter.ts` - relative to absolute
   - `package-registry.ts` - version pinning

4. **Regex patterns for imports** (6 different patterns):
   ```typescript
   // Pattern 1: from clause
   /from\s+["']([^"']+)["']/g

   // Pattern 2: import with from
   /^(\s*import\s+[^'";]+?from\s+)(["'])([^"']+)(\2)/

   // Pattern 3: dynamic import
   /import\s*\(\s*["']([^"']+)["']\s*\)/g

   // Pattern 4: export from
   /export\s*\*\s*from\s*(["'])(\/[^"']+)\1/g

   // Pattern 5: @/ alias
   /from\s+["']@\/([^"']+)["']/g

   // Pattern 6: bare specifier
   /from\s+["']([^"'./][^"']*)["']/g
   ```

### Total Duplication Estimate

| Category | Lines Duplicated | Files Affected |
|----------|-----------------|----------------|
| Skip conditions | ~60 lines | 5 files |
| React mapping | ~80 lines | 4 files |
| URL building | ~50 lines | 4 files |
| Regex patterns | ~40 lines | 6 files |
| **Total** | **~230 lines** | **7 files** |

---

## Transform Pipeline Flow

```
Source Code
     |
     v
[PARSE] MDX Compilation
     |  - Uses MDX import-rewriter (regex)
     v
[COMPILE] esbuild JSX->JS
     |
     v
[RESOLVE_ALIASES] @/ and cross-project
     |  - Uses path-resolver.ts (lexer)
     v
[RESOLVE_REACT] React packages
     |  - Uses react-imports.ts (lexer)
     v
[RESOLVE_CONTEXT] Context packages
     |
     v
[RESOLVE_RELATIVE] ./ and ../ imports
     |  - Uses path-resolver.ts (lexer)
     v
[RESOLVE_BARE] npm packages
     |  - Browser: import-rewriter.ts (lexer)
     |  - SSR: import-map/transformer.ts (regex)
     v
[FINALIZE] Caching, cleanup
     |
     v
Transformed Code
     |
     | (SSR only)
     v
[SSR LOADER] Runtime loading
     |  - Uses ssr-import-rewriter.ts (regex)
     |  - Uses esm-rewriter.ts (regex) for HTTP modules
     v
Executed Code
```

---

## Problems This Creates

### 1. Inconsistent Behavior

The same import can be handled differently depending on:
- Which rewriter processes it first
- Whether it's SSR or browser
- Which runtime is executing
- Whether it was in MDX or TypeScript

### 2. Maintenance Burden

Changes to import handling require updates in multiple files:
- Adding a new specifier type means 5-7 file changes
- Bug fixes often need to be applied in multiple places
- Testing requires coverage of all implementations

### 3. Edge Cases Fall Through Cracks

Each implementation has its own edge case handling:
- Dynamic imports with expressions
- Re-exports
- Type imports
- Computed specifiers

### 4. Performance Overhead

Multiple parsing passes:
1. MDX compilation parses imports
2. Transform pipeline parses again (lexer)
3. SSR loader parses again (regex)
4. HTTP module fetcher parses again (regex)

---

## Success Criteria

A unified import rewriting system should:

1. **Single parsing pass** per transform context
2. **Consistent behavior** across SSR and browser
3. **Declarative configuration** for specifier handling
4. **Extensible** for new specifier types
5. **Testable** with comprehensive edge case coverage
6. **Runtime-aware** with clean abstractions

---

## Recommended Solution

### Unified Import Rewriter Architecture

```typescript
// Core rewriter with strategy pattern
interface ImportRewriteStrategy {
  name: string;
  priority: number;
  matches(specifier: string, context: RewriteContext): boolean;
  rewrite(specifier: string, context: RewriteContext): string | null;
}

interface RewriteContext {
  target: 'browser' | 'ssr';
  runtime: 'deno' | 'node' | 'bun';
  filePath: string;
  projectDir: string;
  reactVersion: string;
  importMap?: ImportMapConfig;
  moduleServerUrl?: string;
}

class UnifiedImportRewriter {
  private strategies: ImportRewriteStrategy[] = [];
  private lexer: LexerWrapper;

  addStrategy(strategy: ImportRewriteStrategy): void {
    this.strategies.push(strategy);
    this.strategies.sort((a, b) => a.priority - b.priority);
  }

  async rewrite(code: string, context: RewriteContext): Promise<string> {
    return this.lexer.replaceSpecifiers(code, (specifier, isDynamic) => {
      for (const strategy of this.strategies) {
        if (strategy.matches(specifier, context)) {
          const result = strategy.rewrite(specifier, context);
          if (result !== null) return result;
        }
      }
      return null;
    });
  }
}
```

### Built-in Strategies

```typescript
// Strategy implementations
const httpUrlStrategy: ImportRewriteStrategy = {
  name: 'http-url',
  priority: 0,
  matches: (s) => s.startsWith('http://') || s.startsWith('https://'),
  rewrite: () => null, // Pass through
};

const reactStrategy: ImportRewriteStrategy = {
  name: 'react',
  priority: 10,
  matches: (s) => s === 'react' || s.startsWith('react/') || s.startsWith('react-dom'),
  rewrite: (specifier, ctx) => {
    const map = getReactImportMap(ctx.reactVersion);
    return map[specifier] ?? null;
  },
};

const pathAliasStrategy: ImportRewriteStrategy = {
  name: 'path-alias',
  priority: 20,
  matches: (s) => s.startsWith('@/'),
  rewrite: (specifier, ctx) => {
    // Unified @/ resolution logic
  },
};

const bareSpecifierStrategy: ImportRewriteStrategy = {
  name: 'bare-specifier',
  priority: 100,
  matches: (s) => !s.startsWith('.') && !s.startsWith('/') && !s.includes(':'),
  rewrite: (specifier, ctx) => {
    if (ctx.target === 'ssr' && ctx.importMap) {
      return resolveImport(specifier, ctx.importMap);
    }
    return `https://esm.sh/${specifier}?external=react&target=es2022`;
  },
};
```

### Migration Path

1. **Phase 1**: Create unified rewriter with all existing strategies
2. **Phase 2**: Replace transform pipeline usage
3. **Phase 3**: Replace MDX import rewriter
4. **Phase 4**: Replace SSR import rewriter
5. **Phase 5**: Remove legacy implementations

### Estimated Impact

| Metric | Before | After |
|--------|--------|-------|
| Files | 7 | 2 (core + strategies) |
| Lines | 1,038 | ~400 |
| Parsing passes | 4 | 1-2 |
| Test coverage | Fragmented | Unified |

---

## Files to Consolidate

1. `/Users/mattboon/Sites/veryfront-renderer/src/transforms/esm/import-rewriter.ts` (183 lines)
2. `/Users/mattboon/Sites/veryfront-renderer/src/transforms/mdx/compiler/import-rewriter.ts` (136 lines)
3. `/Users/mattboon/Sites/veryfront-renderer/src/modules/server/ssr-import-rewriter.ts` (125 lines)
4. `/Users/mattboon/Sites/veryfront-renderer/src/rendering/orchestrator/module-loader/esm-rewriter.ts` (91 lines)
5. `/Users/mattboon/Sites/veryfront-renderer/src/transforms/esm/path-resolver.ts` (279 lines)
6. `/Users/mattboon/Sites/veryfront-renderer/src/modules/import-map/transformer.ts` (50 lines)

**Keep as foundation**:
- `/Users/mattboon/Sites/veryfront-renderer/src/transforms/esm/lexer.ts` (174 lines)

---

## Related Audit Chapters

- **006-runtime-conditionals.md**: Runtime detection used in ssr-import-rewriter.ts
- **003-cache-behavior.md**: Transform cache version tied to import rewriting changes
- **001-adapter-divergence.md**: Runtime adapters affect import resolution
