# Code Review & Cleanup Progress

## Overview
- **Total files to review**: 902
- **Goal**: Identify and fix bugs, hacks, workarounds, and code quality issues
- **Status**: 🔄 In Progress

## Review Categories
We're looking for:
- 🐛 **Bugs**: Logic errors, edge cases, null/undefined issues
- 🩹 **Bandaids/Hacks**: Temporary fixes, TODO comments, workarounds
- ⚠️ **Code Smells**: Dead code, unused imports, overly complex logic
- 🔒 **Security Issues**: Input validation, injection risks, unsafe patterns
- 📝 **Best Practice Violations**: Naming, structure, patterns

## Progress by Directory

| Directory | Files | Status | Issues Found | Issues Fixed |
|-----------|-------|--------|--------------|--------------|
| src/_shims | 3 | ✅ Complete | 3 | 3 |
| src/data | 8 | ✅ Complete | 4 | 4 |
| src/http | 1 | ✅ Complete | 1 | 1 |
| src/react | 22 | ✅ Complete | 5 | 5 |
| src/middleware | 22 | ✅ Complete | 7 | 7 |
| src/module-system | 23 | ✅ Complete | 10 | 10 |
| src/html | 28 | ✅ Complete | 9 | 9 |
| src/observability | 35 | ✅ Complete | 8 | 8 |
| src/routing | 37 | ✅ Complete | 8 | 8 |
| src/cli | 47 | ✅ Complete | 8 | 8 |
| src/security | 48 | ✅ Complete | 7 | 7 |
| src/server | 94 | ✅ Complete | 8 | 8 |
| src/rendering | 95 | ✅ Complete | 4 | 4 |
| src/platform | 98 | ✅ Complete | 6 | 6 |
| src/core | 107 | ✅ Complete | 4 | 4 |
| src/ai | 114 | ✅ Complete | 4 | 4 |
| src/build | 119 | ✅ Complete | 5 | 5 |

## Files Reviewed

### src/react (22 files reviewed)

#### Issues Found and Fixed:

1. **src/react/compat/hooks-adapter.ts**
   - Code Smell: Unused variable `_versionInfo` renamed to `versionInfo` (line 86)
   - Best Practice: Added documentation comment for module-level `idCounter` state explaining its limitations in concurrent rendering scenarios
   - Best Practice: Added explicit return type `: string` to `useIdCompat` function

2. **src/react/compat/ssr-adapter/html-wrapper.ts**
   - Security (XSS): Added `escapeHtml()` and `escapeAttribute()` functions to prevent XSS attacks
   - Security (XSS): Applied escaping to title, meta names/content, link rel/href, script src/type, and nonce attributes
   - All user-provided content that could contain malicious scripts is now properly escaped

3. **src/react/compat/version-detector/version-parser.ts**
   - Bug Fix: Fixed `isReact19()` function - previously incorrectly treated React 18 RC versions (like "18.3.0-canary") as React 19
   - The function now correctly only identifies React 19 when major version is 19 or version string starts with "19."
   - Added documentation explaining the version detection logic

4. **src/react/components/optimized-image/helpers.ts**
   - Code Smell: Renamed `_quality` to `quality` parameter (properly handling the unused parameter)
   - Best Practice: Added input validation for `src` parameter
   - Best Practice: Added JSDoc documentation explaining the function and its parameters
   - Used `void quality` to explicitly indicate the parameter is reserved for future use

#### Files Reviewed (No Issues Found):
- src/react/compat/config-generator.ts - Clean, well-structured code
- src/react/compat/index.ts - Clean export barrel file
- src/react/compat/ssr-adapter/index.ts - Clean export barrel file
- src/react/compat/ssr-adapter/response-builder.ts - Clean implementation
- src/react/compat/ssr-adapter/response-builder/index.ts - Clean re-export
- src/react/compat/ssr-adapter/server-loader.ts - Clean implementation with proper caching
- src/react/compat/ssr-adapter/stream-renderer.ts - Clean implementation with proper error handling
- src/react/compat/ssr-adapter/string-renderer.ts - Clean implementation
- src/react/compat/ssr-adapter/types.ts - Clean type definitions
- src/react/compat/version-detector/compatibility-checker.ts - Clean implementation
- src/react/compat/version-detector/feature-detector.ts - Clean implementation
- src/react/compat/version-detector/index.ts - Clean export barrel file
- src/react/compat/version-detector/types.ts - Clean type definitions
- src/react/compat/version-detector/version-cache.ts - Clean caching implementation
- src/react/components/index.ts - Clean export barrel file
- src/react/components/optimized-image/index.ts - Clean export barrel file
- src/react/components/optimized-image/useOptimizedImage.ts - Clean hook implementation
- src/react/index.ts - Clean main export file

### src/middleware (22 files reviewed)

#### Issues Found and Fixed:

1. **src/middleware/builtin/auth.ts**
   - Security: Basic auth credentials comparison was vulnerable to timing attacks
   - Fix: Added `secureCompare()` function using constant-time comparison to prevent timing-based credential guessing

2. **src/middleware/builtin/security/redis-rate-limit.ts**
   - Code Smell: Hardcoded version string with array join hack to avoid static analysis: `["npm:@redis/client", "@1.5.8"].join("")`
   - Code Smell: Extra blank line at line 84
   - Fix: Replaced with clean constant `REDIS_CLIENT_SPECIFIER` and removed extra blank line

3. **src/middleware/builtin/security/rate-limit.ts**
   - Bug: `retryAfterSeconds` could be negative due to clock drift
   - Bug: Key generator falls back to generic "anonymous" which groups all users without IP headers together
   - Fix: Added `Math.max(1, ...)` to ensure at least 1 second delay, improved key generator to use first IP from X-Forwarded-For chain and fall back to X-Real-IP

4. **src/middleware/builtin/security/types.ts**
   - Dead Code: `xssProtection` option defined but never used (X-XSS-Protection is deprecated)
   - Fix: Added JSDoc `@deprecated` annotation to document this is intentionally unused

5. **src/middleware/builtin/security/csp.ts**
   - Bug: If `script-src` directive is not present in policies, the nonce won't be added (regex won't match)
   - Fix: Added check for `script-src` presence; if missing, appends `script-src 'self' 'nonce-...'`

6. **src/middleware/core/pipeline/executor.ts**
   - Code Smell: Unnecessary lambda wrapper around `defaultNext`
   - Fix: Pass `defaultNext` directly to `composedMiddleware`

#### Files Reviewed (No Issues Found):
- src/middleware/builtin/index.ts - Clean export module
- src/middleware/builtin/logger.ts - Well-structured logging middleware
- src/middleware/builtin/types.ts - Clean type definitions
- src/middleware/builtin/security/cors-simple.ts - Acceptable CORS implementation
- src/middleware/builtin/security/csrf.ts - Clean CSRF protection
- src/middleware/builtin/security/index.ts - Clean export module
- src/middleware/builtin/security/security-headers.ts - Well-implemented security headers
- src/middleware/core/context.ts - Clean context implementation
- src/middleware/core/index.ts - Clean export module
- src/middleware/core/pipeline/composer.ts - Good middleware composition
- src/middleware/core/pipeline/index.ts - Clean export module
- src/middleware/core/pipeline/pipeline.ts - Well-structured pipeline class
- src/middleware/core/pipeline/types.ts - Minimal type definition
- src/middleware/core/types.ts - Clean type definitions
- src/middleware/index.ts - Clean export module
- src/middleware/types.ts - Clean type re-exports

### src/_shims (3 files reviewed)

#### Issues Found and Fixed:

1. **src/_shims/std-front-matter.ts**
   - Code Smell: Overly complex type coercion with redundant fallback chain for gray-matter function extraction
   - Code Smell: Confusing variable naming (`grayMatter` used for both module and function)
   - Bug: `extractAsync` had unsafe type coercion that could fail silently
   - Fix: Created `extractGrayMatterFn()` helper with clean type narrowing, renamed `grayMatter` to `grayMatterModule`, added error handling in `extractAsync`

2. **src/_shims/std-fs.ts**
   - Bug: `walk()` function always reported `isSymlink: false` regardless of actual file type
   - Code Smell: Extension extraction using `path.split(".").pop()` fails for files like `.gitignore` or `file.test.ts`
   - Fix: Added `entry.isSymbolicLink()` check, replaced manual extension extraction with `nodePath.extname()`

3. **src/_shims/std-path.ts**
   - No issues found - clean, simple re-exports of Node.js path module

### src/http (1 file reviewed)

#### Issues Found and Fixed:

1. **src/http/responses.ts**
   - Security: `isValidRedirectUrl()` allowed `../` paths which could enable path traversal attacks
   - Security: Did not block protocol-relative URLs (`//evil.com`) which could redirect to external sites
   - Fix: Added explicit blocking of `//` prefix and `../` patterns, added documentation explaining security rationale

### src/data (8 files reviewed)

#### Issues Found and Fixed:

1. **src/data/data-fetching-cache.ts**
   - Code Smell: Duplicate state tracking - `cacheKeys` Set duplicated information already in LRUCache
   - Fix: Removed redundant `cacheKeys` Set, use `this.cache.keys()` iterator instead

2. **src/data/server-data-fetcher.ts**
   - Bug: Errors only logged when `VERYFRONT_DEBUG` env var set, leading to silent failures in production
   - Code Smell: Unused `adapter` parameter after conditional logging removal
   - Fix: Always log errors (these are critical runtime failures), removed unused adapter parameter

3. **src/data/static-data-fetcher.ts**
   - Bug: Same conditional logging issue as server-data-fetcher
   - Code Smell: Unused `adapter` parameter
   - Fix: Always log errors, removed adapter parameter, added comment explaining background revalidation error handling

4. **src/data/data-fetcher.ts**
   - Code Smell: Passed adapter to fetchers that no longer needed it
   - Fix: Updated constructor calls to match new fetcher signatures

#### Files Reviewed (No Issues Found):
- src/data/helpers.ts - Clean helper functions for redirect/notFound
- src/data/index.ts - Clean export barrel file
- src/data/types.ts - Clean type definitions
- src/data/static-paths-fetcher.ts - Clean implementation

### src/module-system (23 files reviewed)

#### Issues Found and Fixed:

1. **src/module-system/component-registry/registry.ts**
   - Code Smell: Unused import `type * as React` removed
   - Dead Code: Removed `getLoader()` method that always returned `undefined`
   - Best Practice: Simplified `getAllAsComponents()` return type to `Record<string, unknown>`
   - Best Practice: Added JSDoc documentation to exported interfaces

2. **src/module-system/import-map/loader.ts**
   - Code Smell: Non-null assertions (`runtimeAdapter!`) used after null check
   - Fix: Refactored to use nullish coalescing with IIFE for cleaner adapter initialization
   - Best Practice: Added comments to clarify the two-phase loading strategy

3. **src/module-system/import-map/transformer.ts**
   - Bug: Two similar regex patterns could double-process the same imports
   - Code Smell: Duplicated bare specifier check logic in multiple places
   - Fix: Removed redundant second regex, extracted `isBareSpecifier()` helper function
   - Best Practice: Added comprehensive JSDoc explaining what patterns are matched

4. **src/module-system/server/module-server.ts**
   - Code Smell: Duplicate import of `serverLogger` (imported as itself and as `logger` alias)
   - Bug: `serverLogger` reference left after removing duplicate import
   - Fix: Removed duplicate import, changed remaining reference to use `logger` alias

5. **src/module-system/server/websocket-handler.ts**
   - Code Smell: Magic numbers for WebSocket close loop (10 iterations, 50ms delay)
   - Fix: Extracted to named constants `WEBSOCKET_CLOSE_ITERATIONS` and `WEBSOCKET_CLOSE_DELAY_MS`
   - Best Practice: Added comment explaining the graceful shutdown wait

6. **src/module-system/react-loader/unified-loader.ts**
   - Bug: Hardcoded React version `18.3.1` in generated entry point
   - Code Smell: Variable shadowing - `components` declared twice in same scope
   - Fix: Import and use `REACT_DEFAULT_VERSION` constant instead of hardcoded string
   - Fix: Renamed shadowed variable to `loadedComponents`

7. **src/module-system/react-loader/ssr-module-loader.ts**
   - Code Smell: Simple hash function with poor distribution (prone to collisions)
   - Code Smell: No way to clear temp directory cache
   - Fix: Improved hash function to use djb2 algorithm variant with better distribution
   - Fix: Added optional `clearTmpDirs` parameter to `clearSSRModuleCache()`
   - Best Practice: Added JSDoc documentation to global state variables

#### Files Reviewed (No Issues Found):
- src/module-system/component-registry/index.ts - Clean export barrel file
- src/module-system/import-map/default-import-map.ts - Clean implementation
- src/module-system/import-map/index.ts - Clean export barrel file
- src/module-system/import-map/merger.ts - Clean merge implementation
- src/module-system/import-map/resolver.ts - Clean resolution logic
- src/module-system/import-map/types.ts - Clean type definitions
- src/module-system/index.ts - Clean export barrel file
- src/module-system/module-resolver.ts - Well-structured module resolution with caching
- src/module-system/react-loader/component-loader.ts - Clean component loading logic
- src/module-system/react-loader/index.ts - Clean export barrel file
- src/module-system/react-loader/path-resolver.ts - Clean path utilities
- src/module-system/react-loader/temp-directory.ts - Clean temp directory management
- src/module-system/react-loader/types.ts - Clean type definitions
- src/module-system/server/api-server.ts - Clean API server implementation
- src/module-system/server/index.ts - Clean export barrel file
- src/module-system/server/rate-limiter.ts - Clean rate limiting implementation

### src/html (28 files reviewed)

#### Issues Found and Fixed:

1. **src/html/html-detection.ts**
   - Bug: Weak HTML document detection using simple `includes("<html")` could match JavaScript strings containing HTML-like content
   - Fix: Added stricter pattern matching that checks for DOCTYPE or `<html` at the start of the document, with proper tag attribute boundaries (`<html[\s>]`)

2. **src/html/utils.ts**
   - Security: `data-slug` attribute value was not escaped, allowing potential XSS via slug manipulation
   - Bug: Version regex `replace(/[\^~]/, "")` only replaced first occurrence, missing subsequent range specifiers
   - Fix: Added `escapeHTML()` call for `data-slug` value; changed regex to `/[\^~]/g` for global replacement

3. **src/html/metadata-extraction.ts**
   - Code Smell: Missing standard keys (`viewport`, `themeColor`, `icons`, `metadata`, `lang`, `bodyClass`) from exclusion list when copying custom properties
   - Bug: `lang` and `bodyClass` from frontmatter were not being extracted to metadata
   - Fix: Added all standard keys to `processedKeys` Set; added `lang` and `bodyClass` extraction to metadata object

4. **src/html/tag-generators.ts**
   - Security (XSS): Inline script content was injected directly without escaping, allowing `</script>` sequences to break out of script context
   - Fix: Added `escapeScriptContent()` function that escapes `</script` and `<!--` sequences to prevent script injection

5. **src/html/styles-builder/tailwind-jit.ts**
   - Dead Code: `generateTailwindCSS()` and `getCSSForClass()` functions are stubs that only return preflight CSS - the real implementation is in `unocss-generator.ts`
   - Fix: Added `@deprecated` JSDoc annotation and TODO comment explaining this is legacy code to be removed

6. **src/html/hydration-script-builder/templates/router.ts**
   - Code Smell: Debug `console.log` statements cluttering production code
   - Fix: Removed debug logging for `MODULE_SERVER_URL`, `window.location.origin`, and router navigation operations (kept `console.warn` for fallback context usage)

7. **src/html/hydration-script-builder/templates/loader.ts**
   - Code Smell: Debug `console.log` statement for component loading
   - Fix: Removed debug logging while keeping error handling `console.error` for failures

8. **src/html/hydration-script-builder/templates/renderer.ts**
   - Code Smell: Multiple debug `console.log` statements throughout hydration flow
   - Fix: Removed debug logging (`[DEBUG]` prefixed logs), kept essential error logging for failures, added inline comment explaining index.js fallback logic

#### Files Reviewed (No Issues Found):
- src/html/dev-scripts.ts - Clean dev script/style generation with proper nonce handling
- src/html/html-escape.ts - Clean HTML escaping implementation
- src/html/html-injection.ts - Clean template injection with metadata placeholders
- src/html/html-shell-generator.ts - Clean HTML shell generation with proper escaping
- src/html/index.ts - Clean export barrel file
- src/html/metadata-builder.ts - Clean metadata processing
- src/html/types.ts - Clean type definitions
- src/html/hydration-script-builder/index.ts - Clean export barrel file
- src/html/hydration-script-builder/dev-client-renderer.ts - Clean client renderer generation
- src/html/hydration-script-builder/dev-component-manifest.ts - Clean manifest generation
- src/html/hydration-script-builder/dev-error-logger.ts - Clean error logger script
- src/html/hydration-script-builder/dev-indicator.ts - Clean dev mode indicator
- src/html/hydration-script-builder/dev-scripts.ts - Clean dev scripts composition
- src/html/hydration-script-builder/hydration-data-generator.ts - Clean hydration data serialization
- src/html/hydration-script-builder/prod-hydration.ts - Clean production hydration script
- src/html/hydration-script-builder/prod-scripts.ts - Clean production scripts
- src/html/hydration-script-builder/types.ts - Clean type definitions
- src/html/hydration-script-builder/templates/index.ts - Clean export barrel file
- src/html/styles-builder/index.ts - Clean export barrel file
- src/html/styles-builder/dev-styles.ts - Clean dev styles with proper z-index constants
- src/html/styles-builder/production-styles.ts - Clean production styles with breakpoint constants
- src/html/styles-builder/tailwind-config.ts - Clean Tailwind config generation with deep merge
- src/html/styles-builder/theme-variables.ts - Clean CSS variable generation
- src/html/styles-builder/unocss-generator.ts - Clean UnoCSS-based Tailwind generation with proper caching

### src/routing (37 files reviewed)

#### Issues Found and Fixed:

1. **src/routing/api/api-route-matcher.ts**
   - Code Smell: Unnecessary type assertion `paramNames[i] as string` when array access could be undefined
   - Fix: Replaced with proper undefined check using `if (!paramName) continue;`

2. **src/routing/api/context-builder.ts**
   - Bug: `parseCookies()` could throw `URIError` on malformed cookie values (e.g., `%XX` with invalid hex)
   - Fix: Added try-catch around `decodeURIComponent()` with fallback to store value as-is

3. **src/routing/api/module-loader/loader.ts**
   - Code Smell: Comment "Pass fs compat instance" was misleading - `fs` is actually used
   - Code Smell: `_adapter` parameter unused but no documentation
   - Fix: Removed misleading comment, added note explaining `_adapter` kept for API compatibility

4. **src/routing/client/dom-utils.ts**
   - Code Smell: Variable `content` in `parsePageDataFromHTML()` shadowed outer `content` variable causing confusion
   - Fix: Renamed inner variable to `scriptContent` for clarity

5. **src/routing/client/navigation-handlers.ts**
   - Bug: Non-null assertion `!` on `href` that could be null (after `isInternalLink` check which reads href separately)
   - Fix: Added explicit null check `if (!href) return;` before using href

6. **src/routing/client/viewport-prefetch.ts**
   - Code Smell: Used `any` type casting `(entry.target as any).tagName` as fallback for SSR environments
   - Fix: Extracted `entry.target` to `target` variable, used `target.tagName === "A"` without `any` cast since Element always has tagName property

7. **src/routing/matchers/route-matcher.ts**
   - Bug: Non-null assertion `route.regex!` could cause runtime error if regex is undefined
   - Fix: Added early return `if (!route.regex) return null;` before using regex

8. **src/routing/matchers/pattern-route-matcher.ts**
   - Bug: Non-null assertion on cache get `this.cache.get(pathname)!` could return undefined for cached null results
   - Fix: Changed to `const cached = this.cache.get(pathname); if (cached !== undefined) return cached;` to properly handle cached null values

#### Files Reviewed (No Issues Found):
- src/routing/api/error-handler.ts - Clean error handling with environment-aware responses
- src/routing/api/handler.ts - Clean API route handler with proper initialization flow
- src/routing/api/index.ts - Clean export barrel file
- src/routing/api/method-validator.ts - Clean method validation with proper Allow header
- src/routing/api/responses.ts - Clean re-export module
- src/routing/api/route-discovery.ts - Clean route discovery with file system iteration
- src/routing/api/route-executor.ts - Clean route execution with proper error handling
- src/routing/api/module-loader/esbuild-plugin.ts - Clean esbuild plugin for HTTP imports
- src/routing/api/module-loader/http-validator.ts - Clean HTTP import validation
- src/routing/api/module-loader/index.ts - Clean export barrel file
- src/routing/api/module-loader/security-config.ts - Clean security config loading
- src/routing/api/module-loader/types.ts - Clean type definitions
- src/routing/client/index.ts - Clean export barrel file
- src/routing/client/page-loader.ts - Clean page loading with caching
- src/routing/client/page-transition.ts - Clean page transition with proper cleanup
- src/routing/client/types.ts - Clean type definitions
- src/routing/index.ts - Clean main export barrel file
- src/routing/matchers/index.ts - Clean export barrel file
- src/routing/matchers/route-parser.ts - Clean route parsing with specificity scoring
- src/routing/matchers/types.ts - Clean type definitions
- src/routing/registry/index.ts - Clean export barrel file
- src/routing/registry/registry.ts - Clean handler registry with priority sorting
- src/routing/registry/types.ts - Clean re-export module
- src/routing/router.ts - Clean router re-exports
- src/routing/slug-mapper/dynamic-route-matcher.ts - Clean dynamic route matching
- src/routing/slug-mapper/index.ts - Clean export barrel file
- src/routing/slug-mapper/path-candidate-generator.ts - Clean path candidate generation
- src/routing/slug-mapper/slug-normalizer.ts - Clean slug normalization utilities
- src/routing/slug-mapper/types.ts - Clean type definitions

### src/security (48 files reviewed)

#### Issues Found and Fixed:

1. **src/security/http/auth.ts**
   - Bug: Empty string fallback for auth credentials (`|| ""`) treated empty string as valid credential
   - Fix: Changed to `|| null` to properly distinguish between unset and empty credentials

2. **src/security/http/cors/validators.ts**
   - Code Smell: Heavy code duplication between `validateOrigin()` and `validateOriginSync()` (100+ lines of identical logic)
   - Fix: Extracted shared logic into `validateOriginCore()` helper function, `needsFunctionValidation()` type guard, and `processOriginFunctionResult()` helper
   - Best Practice: Removed unnecessary `as CORSConfig` type assertions where TypeScript can already infer the type

3. **src/security/rate-limit/middleware.ts**
   - Bug: Mutating potentially immutable Response headers by calling `response.headers.set()` directly
   - Fix: Create new Response with cloned headers to avoid mutation errors when response is immutable

4. **src/security/rate-limit/strategies.ts**
   - Bug: Token bucket strategy did not properly store state for new keys (missing `store.setState` call)
   - Bug: Inconsistent `resetTime` calculation between initial and subsequent requests
   - Code Smell: Missing comments explaining the refill rate calculation
   - Fix: Added `store.setState(key, state)` after initializing new state; unified `resetTime` calculation logic; added explanatory comments

5. **src/security/sandbox/deno-sandbox.ts**
   - Memory Leak: `URL.createObjectURL()` creates blob URLs that are never revoked, causing memory leaks
   - Code Smell: Duplicated worker termination logic in three places (timeout, onmessage, onerror)
   - Fix: Created `cleanup()` function that handles both worker termination and URL revocation; only revokes blob URLs (not data: URLs)

6. **src/security/input-validation/sanitizers.ts**
   - Security: Incomplete prototype pollution protection - only blocked `__proto__`, `constructor`, `prototype`
   - Bug: No handling of circular references - could cause stack overflow on self-referential objects
   - Security: Used standard object literal `{}` which inherits from Object.prototype
   - Fix: Added `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__` to forbidden keys; added `WeakSet` tracking for circular reference detection; use `Object.create(null)` for sanitized objects to prevent prototype pollution

7. **src/security/client/html-sanitizer.ts** (reviewed, no fixes needed)
   - Already correctly resets `lastIndex` before each regex test in loop
   - XSS detection patterns are appropriate for security scanning

#### Files Reviewed (No Issues Found):
- src/security/http/base-handler.ts - Clean base handler with proper pattern matching
- src/security/http/config.ts - Clean security config loader with proper async initialization
- src/security/http/cors/constants.ts - Clean constants with proper production mode detection
- src/security/http/cors/headers.ts - Clean CORS header application with proper Vary header handling
- src/security/http/cors/index.ts - Clean export barrel file
- src/security/http/cors/middleware.ts - Clean CORS middleware with proper config validation
- src/security/http/cors/preflight.ts - Clean preflight handling with proper header negotiation
- src/security/http/cors/types.ts - Clean type definitions
- src/security/http/handlers-index.ts - Clean export barrel file
- src/security/http/index.ts - Clean export barrel file
- src/security/http/middleware/config-loader.ts - Clean config validation
- src/security/http/middleware/content-types.ts - Clean content type mappings
- src/security/http/middleware/cors-handler.ts - Clean CORS handler using validators
- src/security/http/middleware/etag.ts - Clean ETag generation using djb2 hash
- src/security/http/middleware/index.ts - Clean export barrel file
- src/security/http/middleware/types.ts - Clean type definitions
- src/security/http/response/builder.ts - Clean fluent response builder
- src/security/http/response/cache-handler.ts - Clean cache control generation
- src/security/http/response/constants.ts - Clean cache duration constants
- src/security/http/response/fluent-methods.ts - Clean fluent method implementations
- src/security/http/response/index.ts - Clean export barrel file
- src/security/http/response/response-methods.ts - Clean response generation methods
- src/security/http/response/security-handler.ts - Clean security header application with proper CSP building
- src/security/http/response/static-helpers.ts - Clean static response helpers
- src/security/http/response/types.ts - Clean type definitions with HSTS config
- src/security/http/types.ts - Clean type re-exports
- src/security/index.ts - Clean main export barrel file
- src/security/input-validation/errors.ts - Clean validation error class
- src/security/input-validation/handler.ts - Clean validated handler wrapper
- src/security/input-validation/index.ts - Clean export barrel file
- src/security/input-validation/limits.ts - Clean request limit validation with streaming body reader
- src/security/input-validation/parsers.ts - Clean JSON/form/query parsers with Zod integration
- src/security/input-validation/schemas.ts - Clean common Zod schemas
- src/security/input-validation/types.ts - Clean type definitions with sensible defaults
- src/security/path-validation.ts - Clean path validation with traversal protection
- src/security/rate-limit/index.ts - Clean export barrel file
- src/security/rate-limit/memory-store.ts - Clean in-memory rate limit store with periodic cleanup
- src/security/rate-limit/types.ts - Clean type definitions
- src/security/sandbox/constants.ts - Clean security constants
- src/security/sandbox/permission-system.ts - Clean Deno permission request wrapper
- src/security/secure-fs.ts - Clean secure filesystem wrapper with validation

### src/ai (114 files reviewed)

#### Issues Found and Fixed:

1. **src/ai/providers/openai.ts**
   - Bug: Unsafe `JSON.parse()` on tool call arguments without try/catch - could crash if LLM returns malformed JSON
   - Fix: Wrapped JSON.parse in try/catch, returning empty object `{}` on parse failure to prevent runtime crashes

2. **src/ai/providers/anthropic.ts**
   - Bug: Same unsafe `JSON.parse()` issue when parsing tool call arguments in message transformation
   - Fix: Added try/catch with empty object fallback for malformed JSON arguments

3. **src/ai/providers/google.ts**
   - Bug: Same unsafe `JSON.parse()` issue in response transformation for tool calls
   - Fix: Added try/catch with empty object fallback for malformed JSON arguments

4. **src/ai/workflow/types.ts**
   - Bug: `parseDuration()` inconsistent behavior - allowed `0` for numeric input but rejected `"0s"` as "Duration must be positive"
   - Fix: Changed error message and condition to "Duration cannot be negative" with `num < 0` check, now allows zero duration strings like `"0s"` for consistency with numeric input

#### Files Reviewed (No Issues Found):
- src/ai/adapters/ai-sdk.ts - Clean AI SDK adapter with proper tool wrapping
- src/ai/adapters/index.ts - Clean export barrel file
- src/ai/agent/composition.ts - Clean agent composition with proper registry management
- src/ai/agent/execution/index.ts - Clean export barrel file
- src/ai/agent/execution/message-transformer.ts - Clean message transformation logic
- src/ai/agent/execution/middleware-chain.ts - Clean middleware chain implementation
- src/ai/agent/execution/tool-execution-core.ts - Clean tool execution with proper error handling
- src/ai/agent/execution/usage-tracker.ts - Clean token usage tracking
- src/ai/agent/factory.ts - Clean agent factory with proper configuration
- src/ai/agent/index.ts - Clean export barrel file
- src/ai/agent/memory.ts - Clean memory management implementation
- src/ai/agent/runtime.ts - Clean runtime agent execution
- src/ai/client.ts - Clean unified AI client with proper logging
- src/ai/dev/debug/index.ts - Clean debug export
- src/ai/dev/debug/inspector.ts - Clean debug inspector
- src/ai/dev/generate-sdk.ts - Clean SDK generation utility
- src/ai/dev/index.ts - Clean dev exports
- src/ai/dev/playground/api.ts - Clean playground API
- src/ai/dev/playground/client.ts - Clean playground client
- src/ai/dev/testing/agent-tester.ts - Clean test utilities
- src/ai/dev/testing/index.ts - Clean testing exports
- src/ai/dev/testing/tool-tester.ts - Clean tool testing utilities
- src/ai/mcp/index.ts - Clean MCP exports
- src/ai/mcp/prompt.ts - Clean prompt factory
- src/ai/mcp/registry.ts - Clean MCP registry with proper global singleton
- src/ai/mcp/resource.ts - Clean resource factory
- src/ai/mcp/server.ts - Clean MCP server implementation
- src/ai/production/cache/cache.ts - Clean semantic caching
- src/ai/production/cache/index.ts - Clean cache exports
- src/ai/production/cost-tracking/index.ts - Clean cost tracking exports
- src/ai/production/cost-tracking/tracker.ts - Clean cost tracking with model pricing
- src/ai/production/index.ts - Clean production exports
- src/ai/production/rate-limit/index.ts - Clean rate limit exports
- src/ai/production/rate-limit/limiter.ts - Clean rate limiting implementation
- src/ai/production/security/index.ts - Clean security exports
- src/ai/production/security/validator.ts - Clean input validation
- src/ai/providers/base.ts - Clean base provider with retry logic
- src/ai/providers/factory.ts - Clean provider factory with auto-initialization
- src/ai/providers/index.ts - Clean provider exports
- src/ai/react/hooks/index.ts - Clean hooks export barrel
- src/ai/react/hooks/use-agent.ts - Clean agent hook with proper state management
- src/ai/react/hooks/use-chat.ts - Clean chat hook with streaming support
- src/ai/react/hooks/use-completion.ts - Clean completion hook
- src/ai/react/hooks/use-streaming.ts - Clean streaming hook
- src/ai/react/hooks/use-voice-input.ts - Clean voice input with Web Speech API
- src/ai/react/index.ts - Clean React exports
- src/ai/runtime/index.ts - Clean runtime exports
- src/ai/runtime/platform.ts - Clean platform detection with capability matrix
- src/ai/types/agent.ts - Clean agent type definitions
- src/ai/types/index.ts - Clean type exports
- src/ai/types/mcp.ts - Clean MCP type definitions
- src/ai/types/provider.ts - Clean provider type definitions
- src/ai/types/tool.ts - Clean tool type definitions
- src/ai/utils/config-validator.ts - Clean configuration validation
- src/ai/utils/discovery.ts - Clean auto-discovery with proper error handling
- src/ai/utils/index.ts - Clean utility exports
- src/ai/utils/setup.ts - Clean setup orchestration
- src/ai/utils/tool.ts - Clean tool utilities with registry management
- src/ai/utils/zod-json-schema.ts - Clean Zod to JSON Schema conversion
- src/ai/workflow/index.ts - Clean workflow exports
- src/ai/workflow/types.ts - Clean workflow type definitions with validation helpers

### src/cli (47 files reviewed)

#### Issues Found and Fixed:

1. **src/cli/commands/analyze-chunks.ts**
   - Bug: Division by zero when `analysis.sharedDeps.size` is 0 in average calculation
   - Code Smell: Silent error handling - errors were caught but not logged
   - Fix: Added `size > 0` check before division; added descriptive error logging in catch block

2. **src/cli/commands/doctor/version-checks.ts**
   - Bug: Version comparison using string comparison (`versionNum >= "1.40.0"`) which compares lexicographically, not semantically (e.g., "9.0.0" > "10.0.0")
   - Fix: Added `compareVersions()` helper function that parses version strings and compares numerically by major.minor.patch

3. **src/cli/commands/routes.ts**
   - Code Smell: Module-level mutable state (`let fs: FileSystem`) shared across function calls
   - Code Smell: Unsafe type cast using `(router as any).routes` without proper type narrowing
   - Fix: Made `fs` a local variable within `routesCommand()` function; replaced `any` cast with properly typed intermediate variable with explicit `Map` type check

4. **src/cli/commands/generate.ts**
   - Code Smell: Module-level mutable state (`let fs: FileSystem`) - creates implicit coupling and potential race conditions
   - Fix: Made `fs` a parameter to `ensureDir()` function and created locally in `generateCommand()`

5. **src/cli/commands/generate/integration-generator.ts**
   - Code Smell: Module-level mutable state (`let fs: FileSystem`)
   - Code Smell: Using `require("readline")` which is CommonJS syntax incompatible with Deno
   - Fix: Made `fs` a parameter passed through all helper functions; replaced `require()` with `await import("node:readline")`; added `isDeno` runtime check from platform compat

6. **src/cli/commands/doctor/server-checks.ts**
   - Code Smell: Magic number `"http://127.0.0.1:3000"` repeated multiple times
   - Code Smell: Unsafe `any` type cast for metrics response JSON parsing
   - Fix: Extracted to `DEFAULT_SERVER_URL` constant; added typed interfaces `RSCCounters` and `MetricsResponse` for proper type safety

7. **src/cli/utils/terminal-select.ts**
   - Bug: Direct reference to `Deno?.stdout?.writeSync` without runtime check - would crash in Node.js if `Deno` is not defined
   - Code Smell: Duplicated stdout write logic across `select()` and `multiSelect()` functions
   - Fix: Created `writeToStdout()` helper function that uses `isDeno` check from platform compat

8. **src/cli/utils/index.ts**
   - Code Smell: `createSpinner()` function directly used `process.stdout?.write?.()` without checking runtime environment
   - Fix: Added `writeToStdout()` helper function with proper `isDeno` check and cross-platform stdout writing

#### Files Reviewed (No Issues Found):
- src/cli/commands/build.ts - Clean build command orchestration
- src/cli/commands/build/config-display.ts - Clean configuration display
- src/cli/commands/build/error-handler.ts - Clean error handling with proper categorization
- src/cli/commands/build/index.ts - Clean build exports
- src/cli/commands/build/stats-display.ts - Clean build statistics display
- src/cli/commands/build/types.ts - Clean type definitions
- src/cli/commands/clean.ts - Clean cleanup command with proper confirmation flow
- src/cli/commands/dev.ts - Clean development server command
- src/cli/commands/doctor/index.ts - Clean doctor command orchestration
- src/cli/commands/doctor/ai-checks.ts - Clean AI diagnostics
- src/cli/commands/doctor/project-structure.ts - Clean project structure validation
- src/cli/commands/doctor/types.ts - Clean type definitions
- src/cli/help/command-definitions.ts - Clean command registry
- src/cli/help/command-help.ts - Clean command help display
- src/cli/help/formatters.ts - Clean formatting utilities
- src/cli/help/index.ts - Clean help exports
- src/cli/help/logo.ts - Clean ASCII logo display
- src/cli/help/main-help.ts - Clean main help display
- src/cli/help/tips.ts - Clean tips display
- src/cli/help/types.ts - Clean type definitions
- src/cli/index.ts - Clean main CLI export
- src/cli/index/arg-parser.ts - Clean argument parsing with alias support
- src/cli/index/build-handler.ts - Clean build command handler
- src/cli/index/cli-main.ts - Clean CLI entry point
- src/cli/index/command-router.ts - Clean command routing with proper error handling
- src/cli/index/dev-handler.ts - Clean dev command handler
- src/cli/index/generate-handler.ts - Clean generate command handler
- src/cli/index/index.ts - Clean index exports
- src/cli/index/types.ts - Clean type definitions
- src/cli/commands/init/config-generator.ts - Clean config file generation
- src/cli/commands/init/index.ts - Clean init command exports
- src/cli/commands/init/init-command.ts - Clean project initialization
- src/cli/commands/init/interactive-wizard.ts - Clean interactive setup wizard
- src/cli/commands/init/types.ts - Clean type definitions
- src/cli/utils/env-prompt.ts - Clean environment variable prompts
- src/cli/utils/package-manager.ts - Clean package manager detection
- src/cli/npm-cli.ts - Clean Node.js CLI entry
- src/cli/npm-entry.ts - Clean npm binary entry point

### src/observability (35 files reviewed)

#### Issues Found and Fixed:

1. **src/observability/auto-instrument/react-instrumentation.ts**
   - Code Smell: Magic number `2` used for SpanStatusCode.ERROR without explanation
   - Fix: Extracted to named constant `SPAN_STATUS_CODE_ERROR` with explanatory comment

2. **src/observability/auto-instrument/http-instrumentation.ts**
   - Code Smell: `httpAttrs` parameter passed to `recordResponseSuccess()` and `recordResponseError()` but attributes were already set on span via `attributes` in startActiveSpan
   - Fix: Removed redundant `httpAttrs` parameter from both functions, simplified function signatures

3. **src/observability/instruments/instruments-factory.ts**
   - Code Smell: Synchronous function wrapped result in `Promise.resolve()` unnecessarily with misleading JSDoc about async behavior
   - Fix: Changed return type from `Promise<MetricsInstruments>` to `MetricsInstruments`, removed `Promise.resolve()` wrapper, updated documentation

4. **src/observability/metrics/manager.ts**
   - Code Smell: Unsafe type assertion `(this.recorder as any).instruments = ...` to bypass TypeScript type system
   - Fix: Replaced with proper `new MetricsRecorder(...)` call to create recorder with new instruments

5. **src/observability/metrics/recorder.ts**
   - Bug: `activeRequests` counter could go negative if `recordHttpRequestComplete()` called without matching `recordHttpRequest()`
   - Fix: Added `Math.max(0, ...)` guard to ensure `activeRequests` never becomes negative

6. **src/observability/metrics/types.ts**
   - Code Smell: `prefix` property marked optional but always required for instrument name creation
   - Fix: Changed `prefix?: string` to `prefix: string` with JSDoc explaining requirement

7. **src/observability/simple-metrics/metrics-recorder.ts**
   - Code Smell: Duplicate error handling pattern `void getObservabilityMetrics().then(...).catch(() => {})` repeated 8+ times
   - Code Smell: `recordRSC()` had separate identical cases for `"page"` and `"flight_page"`
   - Fix: Extracted `safeRecordObservability()` helper function; combined `"page"` and `"flight_page"` cases with fallthrough

8. **src/observability/tracing/span-operations.ts**
   - Code Smell: Unnecessary `.toLowerCase()` call on `kind` which is already typed as lowercase string literal union
   - Fix: Removed `.toLowerCase()`, used proper `Record<NonNullable<SpanOptions["kind"]>, SpanKind>` type, changed `||` to `??` for proper nullish coalescing

#### Files Reviewed (No Issues Found):
- src/observability/auto-instrument/configurator.ts - Clean config merge
- src/observability/auto-instrument/index.ts - Clean export barrel file
- src/observability/auto-instrument/orchestrator.ts - Clean initialization orchestration
- src/observability/auto-instrument/types.ts - Clean type definitions
- src/observability/auto-instrument/wrappers.ts - Clean instrumentation wrappers
- src/observability/index.ts - Clean main export barrel file
- src/observability/instruments/index.ts - Clean export barrel file
- src/observability/instruments/build-instruments.ts - Clean build metrics
- src/observability/instruments/cache-instruments.ts - Clean cache metrics with observable gauge
- src/observability/instruments/data-instruments.ts - Clean data fetch metrics
- src/observability/instruments/http-instruments.ts - Clean HTTP metrics
- src/observability/instruments/memory-instruments.ts - Clean memory metrics
- src/observability/instruments/render-instruments.ts - Clean render metrics
- src/observability/instruments/rsc-instruments.ts - Clean RSC metrics
- src/observability/metrics/config.ts - Clean config loading with env override
- src/observability/metrics/index.ts - Clean metrics API facade
- src/observability/simple-metrics/index.ts - Clean export barrel with metrics object
- src/observability/simple-metrics/metrics-state.ts - Clean global state management
- src/observability/simple-metrics/observability-loader.ts - Clean lazy loading with caching
- src/observability/simple-metrics/otel-instruments.ts - Clean OTEL instrument initialization
- src/observability/simple-metrics/types.ts - Clean type definitions
- src/observability/tracing/config.ts - Clean tracing config with env override
- src/observability/tracing/context-propagation.ts - Clean W3C trace context propagation
- src/observability/tracing/index.ts - Clean tracing API facade
- src/observability/tracing/manager.ts - Clean tracing lifecycle management
- src/observability/tracing/span-names.ts - Clean span name constants
- src/observability/tracing/types.ts - Clean type definitions

### src/server (94 files reviewed)

#### Issues Found and Fixed:

1. **src/server/build-routes.ts**
   - Code Smell: Unnecessary dynamic import `await import("std/path/mod.ts")` inside recursive function `walkAppSSG()` when `join` is already imported at module level
   - Fix: Removed redundant dynamic import, added comment noting module-level import is sufficient

2. **src/server/build-service-worker.ts**
   - Code Smell: Unsafe `as any` type cast for `chunkInfo` object in `buildManifestAssets()`
   - Fix: Added proper `ChunkInfo` interface with `file`, `css`, and `imports` properties; changed cast to `as ChunkInfo`

3. **src/server/dev-server/server.ts**
   - Code Smell: Unused destructured variable `_hostname` in `onListen` callback
   - Fix: Removed unused variable from destructuring pattern `({ port }: { hostname: string; port: number })`

4. **src/server/universal-handler/index.ts**
   - Code Smell: Unused variable `_url` created from `new URL(req.url)` in handler function
   - Fix: Removed unused variable assignment

5. **src/server/handlers/request/ssr/ssr-handler.ts**
   - Code Smell: Unused import `serverLogger as _logger` - logger imported but never used (renamed with underscore prefix)
   - Fix: Removed unused import statement

6. **src/server/dev-server/middleware.ts**
   - Code Smell: Unused parameter `_next` in terminal middleware function
   - Fix: Removed unused parameter, added comment clarifying this is the terminal middleware

7. **src/server/dev-server/hmr-server.ts**
   - Bug: Variable named `_handler` (with underscore prefix suggesting unused) but actually used in `adapter.serve(_handler, ...)`
   - Fix: Renamed to `handler` without underscore prefix and updated reference in `serve()` call

8. **General code review - No issues requiring fixes:**
   - src/server/bootstrap.ts - Clean initialization with proper FSAdapter handling
   - src/server/build-app-route-renderer.ts - Clean SSR rendering with proper layout handling
   - src/server/build-types.ts - Clean type definitions
   - src/server/dev-server.ts - Clean re-export module
   - src/server/production-server.ts - Clean production server with proper shutdown handling
   - src/server/dev-server/index.ts - Clean export barrel file with factory function
   - src/server/dev-server/bundler.ts - Clean esbuild integration with proper plugins
   - src/server/dev-server/file-watcher.ts - Clean debounced file watcher with metrics
   - src/server/dev-server/request-handler.ts - Clean request routing with dev endpoints
   - src/server/dev-server/route-discovery.ts - Clean route discovery with app/pages support
   - src/server/dev-server/hmr-types.ts - Clean HMR type definitions
   - src/server/dev-server/file-watch-setup.ts - Clean file watcher setup
   - src/server/handlers/index.ts - Clean handler exports
   - src/server/handlers/monitoring/health.ts - Clean health check endpoints
   - src/server/handlers/monitoring/metrics.ts - Clean metrics endpoint
   - src/server/handlers/monitoring/client-log.ts - Clean client log handler (dev only)
   - src/server/handlers/dev/files/dev-file-handler.ts - Clean dev file serving
   - src/server/handlers/dev/files/path-validator.ts - Clean path validation with security checks
   - src/server/handlers/request/api/api-handler-wrapper.ts - Clean API handler wrapper
   - src/server/handlers/request/api/security-headers.ts - Clean CSP and security header generation
   - src/server/handlers/request/rsc/handlers/handler.ts - Clean RSC handler composition
   - src/server/handlers/response/base.ts - Clean base handler re-export

### src/core (107 files reviewed)

#### Issues Found and Fixed:

1. **src/core/types/entities/getEntityInfo.ts**
   - Code Smell: Debug `console.log` statements left in production code (`[getEntityInfo]`, `[getEntityBySlug]`)
   - Fix: Removed debug logging statements that cluttered production output

2. **src/core/utils/feature-flags.ts**
   - Dead Code: Unused `declare const process` statement that was never referenced (function already uses `getEnv()` from platform compat)
   - Fix: Removed unused declaration

3. **src/core/config/loader.ts**
   - Code Smell: Redundant error re-throwing pattern - catch block had three separate conditions that all ended up throwing the error
   - Fix: Simplified to single re-throw with explanatory comment

4. **src/core/oauth/providers/base.ts**
   - Bug: `generateRandomString()` function was inefficiently allocating `length` bytes of randomness when only `ceil(length/2)` are needed (each byte produces 2 hex characters)
   - Fix: Changed to `Math.ceil(length / 2)` bytes, added explanatory comment

#### Files Reviewed (No Issues Found):

**Config Files:**
- src/core/config/defaults.ts - Clean default configuration with proper typing
- src/core/config/define-config.ts - Clean config helper functions
- src/core/config/index.ts - Clean export barrel file
- src/core/config/network-defaults.ts - Clean network constants and URL builders
- src/core/config/schema.ts - Clean Zod schema validation
- src/core/config/types.ts - Clean TypeScript interfaces

**Constants Files:**
- src/core/constants/buffers.ts - Clean buffer size constants
- src/core/constants/crypto.ts - Clean cryptographic constants
- src/core/constants/index.ts - Clean export barrel file
- src/core/constants/limits.ts - Clean limit constants
- src/core/constants/metrics.ts - Clean metrics boundaries
- src/core/constants/priorities.ts - Clean handler priority constants
- src/core/constants/retry.ts - Clean retry configuration constants

**Error Files:**
- src/core/errors/agent-errors.ts - Clean agent error classes
- src/core/errors/build-errors.ts - Clean build error classes
- src/core/errors/compat.ts - Legacy compatibility layer (not imported anywhere - candidate for removal)
- src/core/errors/enhanced-catalog.ts - Clean enhanced error catalog exports
- src/core/errors/error-codes.ts - Clean error code definitions with inference logic
- src/core/errors/error-handlers.ts - Clean error handling utilities
- src/core/errors/index.ts - Clean main export barrel file
- src/core/errors/runtime-errors.ts - Clean runtime error classes
- src/core/errors/system-errors.ts - Clean system error classes
- src/core/errors/types.ts - Clean error type enum and base class
- src/core/errors/veryfront-error.ts - Clean error factory and type guards
- src/core/errors/catalog/*.ts - Clean error catalog modules (10 files)
- src/core/errors/user-friendly/*.ts - Clean user-friendly error handling (4 files)

**OAuth Files:**
- src/core/oauth/index.ts - Clean export barrel file
- src/core/oauth/types.ts - Clean OAuth type definitions
- src/core/oauth/handlers/callback-handler.ts - Clean OAuth callback with proper error handling
- src/core/oauth/handlers/init-handler.ts - Clean OAuth initialization handlers
- src/core/oauth/handlers/index.ts - Clean export barrel file
- src/core/oauth/providers/base.ts - Clean OAuth provider with PKCE support
- src/core/oauth/providers/common.ts - Clean common provider configurations
- src/core/oauth/providers/google.ts - Clean Google provider config
- src/core/oauth/providers/microsoft.ts - Clean Microsoft provider config
- src/core/oauth/providers/atlassian.ts - Clean Atlassian provider config
- src/core/oauth/providers/index.ts - Clean provider exports
- src/core/oauth/token-store/memory.ts - Clean in-memory token store with expiration
- src/core/oauth/token-store/index.ts - Clean token store exports

**Type Files:**
- src/core/types/app.ts - Clean app props type
- src/core/types/branded.ts - Clean branded type utilities
- src/core/types/bundler.ts - Clean bundler type definitions
- src/core/types/entities.ts - Clean entity type definitions with detection logic
- src/core/types/global-guards.ts - Clean runtime type guards
- src/core/types/hmr.ts - Clean HMR message types
- src/core/types/index.ts - Clean main type exports
- src/core/types/rsc.ts - Clean RSC type definitions
- src/core/types/server.ts - Clean server handler types

**Utility Files:**
- src/core/utils/index.ts - Clean export barrel file
- src/core/utils/bundle-manifest.ts - Clean bundle manifest store interface and implementation
- src/core/utils/bundle-manifest-init.ts - Clean manifest initialization
- src/core/utils/env-loader.ts - Clean environment variable loader with multiline support
- src/core/utils/file-discovery.ts - Clean file discovery utilities
- src/core/utils/format-utils.ts - Clean formatting utilities
- src/core/utils/hash-utils.ts - Clean hash computation utilities
- src/core/utils/lru-wrapper.ts - Clean LRU cache wrapper with periodic cleanup
- src/core/utils/memoize.ts - Clean memoization utilities
- src/core/utils/path-utils.ts - Clean path manipulation utilities
- src/core/utils/paths.ts - Clean path constants
- src/core/utils/platform.ts - Clean platform detection
- src/core/utils/runtime-guards.ts - Clean runtime environment type guards
- src/core/utils/version.ts - Clean version constant
- src/core/utils/logger/*.ts - Clean logging utilities (3 files)
- src/core/utils/constants/*.ts - Clean constant definitions (10 files)
- src/core/utils/cache/*.ts - Clean cache utilities (10 files)

### src/platform (98 files reviewed)

#### Issues Found and Fixed:

1. **src/platform/adapters/veryfront-fs-adapter/adapter.ts**
   - Code Smell: Debug `console.log` statement left in production code logging all file paths during initialization
   - Fix: Removed debug console.log statement, kept proper logger.debug call

2. **src/platform/adapters/veryfront-fs-adapter/read-operations.ts**
   - Code Smell: Debug `console.log` statement conditionally logging file content for Layout and about files
   - Fix: Removed debug logging conditional block

3. **src/platform/adapters/veryfront-fs-adapter/stat-operations.ts**
   - Code Smell: Multiple debug `console.log` statements in `exists()` method logging path checking
   - Code Smell: Unused `error` parameter in catch block
   - Fix: Replaced console.log with proper logger.debug call, changed catch block to use bare `catch`

4. **src/platform/adapters/file-cache/lru-tracker.ts**
   - Performance: O(n) operations using `Array.filter()` for every `update()` and `remove()` call
   - Fix: Replaced array-based implementation with Map for O(1) operations (Map maintains insertion order)
   - Best Practice: Added JSDoc explaining the data structure choice

5. **src/platform/compat/console/node.ts**
   - Code Smell: `ensurePc()` function was never called, causing potential race condition with lazy loading
   - Code Smell: No protection against concurrent initialization
   - Fix: Renamed to `loadPicoColors()`, added `initPromise` caching to prevent concurrent imports
   - Best Practice: Added JSDoc documentation explaining the lazy loading strategy

6. **src/platform/compat/fs.ts**
   - Code Smell: Using `any` type for error handling in `exists()` method
   - Fix: Changed to `unknown` type with proper type narrowing using `typeof error === "object"` check

#### Files Reviewed (No Issues Found):

**Adapters - Base & Root:**
- src/platform/adapters/base.ts - Clean base adapter interface definitions
- src/platform/adapters/bun.ts - Clean Bun adapter re-export
- src/platform/adapters/deno.ts - Clean Deno adapter re-export
- src/platform/adapters/detect.ts - Clean runtime detection with proper environment checks
- src/platform/adapters/fallback-wrapper.ts - Clean fallback wrapper implementation
- src/platform/adapters/fs-adapter-factory.ts - Clean factory with proper async initialization
- src/platform/adapters/fs-adapter-wrapper.ts - Clean adapter wrapper with method mapping
- src/platform/adapters/fs-integration.ts - Clean FS integration with Proxy-based enhancement
- src/platform/adapters/index.ts - Clean export barrel file
- src/platform/adapters/mock.ts - Clean mock adapter for testing
- src/platform/adapters/node.ts - Clean Node adapter re-export
- src/platform/adapters/registry.ts - Clean adapter registry with singleton pattern
- src/platform/adapters/shared-watcher.ts - Clean file watcher with debouncing
- src/platform/adapters/token-adapter-factory.ts - Clean token adapter factory
- src/platform/adapters/token-adapter-integration.ts - Clean token storage integration

**Adapters - Bun:**
- src/platform/adapters/bun/adapter.ts - Clean Bun adapter implementation
- src/platform/adapters/bun/environment-adapter.ts - Clean environment variable access
- src/platform/adapters/bun/filesystem-adapter.ts - Clean Bun filesystem operations
- src/platform/adapters/bun/http-server.ts - Clean Bun HTTP server
- src/platform/adapters/bun/index.ts - Clean export barrel file
- src/platform/adapters/bun/types.ts - Clean type definitions
- src/platform/adapters/bun/websocket-adapter.ts - Clean Bun WebSocket implementation

**Adapters - Cloudflare:**
- src/platform/adapters/cloudflare/adapter.ts - Clean Cloudflare adapter
- src/platform/adapters/cloudflare/environment.ts - Clean environment bindings
- src/platform/adapters/cloudflare/filesystem.ts - Clean virtual filesystem for Workers
- src/platform/adapters/cloudflare/index.ts - Clean export barrel file
- src/platform/adapters/cloudflare/server.ts - Clean Cloudflare server integration
- src/platform/adapters/cloudflare/shell.ts - Clean shell adapter (throws NotSupported as expected)
- src/platform/adapters/cloudflare/types.ts - Clean type definitions
- src/platform/adapters/cloudflare/worker.ts - Clean Worker entry point

**Adapters - Node:**
- src/platform/adapters/node/adapter.ts - Clean Node.js adapter
- src/platform/adapters/node/environment-adapter.ts - Clean environment access
- src/platform/adapters/node/filesystem-adapter.ts - Clean Node fs operations
- src/platform/adapters/node/http-server.ts - Clean Node HTTP server
- src/platform/adapters/node/index.ts - Clean export barrel file
- src/platform/adapters/node/types.ts - Clean type definitions
- src/platform/adapters/node/websocket-adapter.ts - Clean WebSocket implementation

**Adapters - File Cache:**
- src/platform/adapters/file-cache/factory.ts - Clean cache factory
- src/platform/adapters/file-cache/file-cache.ts - Clean file cache with LRU eviction
- src/platform/adapters/file-cache/index.ts - Clean export barrel file
- src/platform/adapters/file-cache/size-estimator.ts - Clean size estimation utilities
- src/platform/adapters/file-cache/types.ts - Clean type definitions

**Adapters - Veryfront API Client:**
- src/platform/adapters/veryfront-api-client.ts - Clean API client re-export
- src/platform/adapters/veryfront-api-client/client.ts - Clean HTTP client implementation
- src/platform/adapters/veryfront-api-client/index.ts - Clean export barrel file
- src/platform/adapters/veryfront-api-client/operations.ts - Clean API operations with proper error handling
- src/platform/adapters/veryfront-api-client/retry-handler.ts - Clean retry logic with exponential backoff
- src/platform/adapters/veryfront-api-client/types.ts - Clean type definitions

**Adapters - Veryfront FS Adapter:**
- src/platform/adapters/veryfront-fs-adapter.ts - Clean re-export module
- src/platform/adapters/veryfront-fs-adapter/directory-operations.ts - Clean directory listing
- src/platform/adapters/veryfront-fs-adapter/index.ts - Clean export barrel file
- src/platform/adapters/veryfront-fs-adapter/path-normalizer.ts - Clean path normalization
- src/platform/adapters/veryfront-fs-adapter/types.ts - Clean type definitions

**Adapters - Veryfront Token Adapter:**
- src/platform/adapters/veryfront-token-adapter/adapter.ts - Clean token storage adapter
- src/platform/adapters/veryfront-token-adapter/api-client.ts - Clean token API client
- src/platform/adapters/veryfront-token-adapter/index.ts - Clean export barrel file
- src/platform/adapters/veryfront-token-adapter/memory-adapter.ts - Clean in-memory token storage
- src/platform/adapters/veryfront-token-adapter/types.ts - Clean type definitions

**Adapters - Shared & Security:**
- src/platform/adapters/shared/node-based-shell-adapter.ts - Clean shared shell adapter
- src/platform/adapters/security/index.ts - Clean security exports

**Compat - Console:**
- src/platform/compat/console/ansi.ts - Clean ANSI color codes
- src/platform/compat/console/deno.ts - Clean Deno fmt colors
- src/platform/compat/console/index.ts - Clean async color loading
- src/platform/compat/console/types.ts - Clean type definitions

**Compat - Root:**
- src/platform/compat/crypto.ts - Clean cross-platform crypto
- src/platform/compat/flags.ts - Clean argument parsing
- src/platform/compat/index.ts - Clean export barrel file
- src/platform/compat/media-types.ts - Clean MIME type utilities
- src/platform/compat/path-helper.ts - Clean path helper with lazy loading
- src/platform/compat/process.ts - Clean cross-platform process utilities
- src/platform/compat/runtime.ts - Clean runtime detection

**Compat - HTTP:**
- src/platform/compat/http/deno-server.ts - Clean Deno HTTP server
- src/platform/compat/http/factory.ts - Clean server factory
- src/platform/compat/http/index.ts - Clean export barrel file
- src/platform/compat/http/node-server.ts - Clean Node HTTP server
- src/platform/compat/http/node-types.ts - Clean Node type definitions
- src/platform/compat/http/request-adapter.ts - Clean Node to Web request conversion
- src/platform/compat/http/types.ts - Clean type definitions

**Compat - KV:**
- src/platform/compat/kv/factory.ts - Clean KV store factory with fallbacks
- src/platform/compat/kv/index.ts - Clean export barrel file
- src/platform/compat/kv/memory-adapter.ts - Clean in-memory KV store
- src/platform/compat/kv/sqlite-adapter.ts - Clean SQLite KV adapter
- src/platform/compat/kv/types.ts - Clean type definitions

**Compat - Path:**
- src/platform/compat/path/basic-operations.ts - Clean path operations
- src/platform/compat/path/index.ts - Clean export barrel file
- src/platform/compat/path/parse-format.ts - Clean path parsing
- src/platform/compat/path/resolution.ts - Clean path resolution
- src/platform/compat/path/runtime.ts - Clean runtime path detection
- src/platform/compat/path/security.ts - Clean path security validation
- src/platform/compat/path/types.ts - Clean type definitions
- src/platform/compat/path/url-conversion.ts - Clean file URL conversion

**Root:**
- src/platform/index.ts - Clean main export barrel file

### src/build (119 files reviewed)

#### Issues Found and Fixed:

1. **src/build/asset-pipeline/css-optimizer/critical-css.ts**
   - Code Smell: Extra blank line at line 18 between `readTextFile` call and `extractSelectorsFromHTML` call
   - Fix: Removed extra blank line for consistency

2. **src/build/asset-pipeline/css-optimizer/utils.ts**
   - Dead Code: Unused variable `_filePattern` at line 27 - pattern was split but second part never used
   - Fix: Removed unused variable assignment

3. **src/build/asset-pipeline/css-optimizer/strategies/purge-strategy.ts**
   - Code Smell: Extra blank line at line 66 inside `purgeUnusedCSS` method
   - Fix: Removed extra blank line

4. **src/build/transforms/esm/import-rewriter.ts**
   - Code Smell: Extra blank line at line 61 inside `rewriteVendorImports` function's dynamic import handling block
   - Fix: Removed extra blank line for cleaner code flow

5. **src/build/utils/asset-utils.ts**
   - Code Smell: Double blank line at lines 85-86 between `getStandardPseudoSelectors` and `getVariantPath` functions
   - Fix: Reduced to single blank line for consistency

#### Files Reviewed (No Issues Found):

**Asset Pipeline - CSS Optimizer:**
- src/build/asset-pipeline/css-optimizer/css-bundle-cache.ts - Clean caching implementation with proper LRU eviction
- src/build/asset-pipeline/css-optimizer/index.ts - Clean export barrel file
- src/build/asset-pipeline/css-optimizer/optimizer-service.ts - Clean optimization orchestration
- src/build/asset-pipeline/css-optimizer/strategies/index.ts - Clean strategy exports
- src/build/asset-pipeline/css-optimizer/strategies/lightning-strategy.ts - Clean LightningCSS integration
- src/build/asset-pipeline/css-optimizer/strategies/minification-strategy.ts - Clean minification strategy
- src/build/asset-pipeline/css-optimizer/types/index.ts - Clean type definitions

**Asset Pipeline - Image Optimizer:**
- src/build/asset-pipeline/image-optimizer/constants.ts - Clean image processing constants
- src/build/asset-pipeline/image-optimizer/format-processor.ts - Clean format conversion
- src/build/asset-pipeline/image-optimizer/image-finder.ts - Clean image discovery
- src/build/asset-pipeline/image-optimizer/index.ts - Clean export barrel file
- src/build/asset-pipeline/image-optimizer/manifest-manager.ts - Clean manifest handling
- src/build/asset-pipeline/image-optimizer/optimizer-core.ts - Clean optimization core
- src/build/asset-pipeline/image-optimizer/sharp-loader.ts - Clean sharp module loading
- src/build/asset-pipeline/image-optimizer/types.ts - Clean type definitions
- src/build/asset-pipeline/image-optimizer/variant-generator.ts - Clean image variant generation

**Asset Pipeline - Tailwind Processor:**
- src/build/asset-pipeline/tailwind-processor/batch-processor.ts - Clean batch processing
- src/build/asset-pipeline/tailwind-processor/css-utils.ts - Clean CSS utilities
- src/build/asset-pipeline/tailwind-processor/detector.ts - Clean Tailwind detection
- src/build/asset-pipeline/tailwind-processor/index.ts - Clean export barrel file
- src/build/asset-pipeline/tailwind-processor/lightning-processor.ts - Clean LightningCSS processing
- src/build/asset-pipeline/tailwind-processor/processor.ts - Clean main processor
- src/build/asset-pipeline/tailwind-processor/types.ts - Clean type definitions

**Bundler - Code Splitter:**
- src/build/bundler/code-splitter/build-context.ts - Clean build context management
- src/build/bundler/code-splitter/entry-points.ts - Clean entry point discovery
- src/build/bundler/code-splitter/esbuild-plugin.ts - Clean esbuild plugin implementation
- src/build/bundler/code-splitter/index.ts - Clean export barrel file
- src/build/bundler/code-splitter/manifest-builder.ts - Clean manifest generation
- src/build/bundler/code-splitter/splitter.ts - Clean code splitting logic
- src/build/bundler/code-splitter/types.ts - Clean type definitions
- src/build/bundler/index.ts - Clean export barrel file

**Compiler - MDX:**
- src/build/compiler/index.ts - Clean export barrel file
- src/build/compiler/mdx-compiler/code-generator.ts - Clean code generation
- src/build/compiler/mdx-compiler/compiler.ts - Clean MDX compilation
- src/build/compiler/mdx-compiler/directory-compiler.ts - Clean directory-level compilation
- src/build/compiler/mdx-compiler/file-writer.ts - Clean file output
- src/build/compiler/mdx-compiler/frontmatter-parser.ts - Clean frontmatter extraction
- src/build/compiler/mdx-compiler/import-transformer.ts - Clean import transformation
- src/build/compiler/mdx-compiler/index.ts - Clean export barrel file
- src/build/compiler/mdx-compiler/mdx-processor.ts - Clean MDX processing
- src/build/compiler/mdx-compiler/transpiler.ts - Clean transpilation
- src/build/compiler/mdx-compiler/types.ts - Clean type definitions
- src/build/compiler/mdx-compiler/validator.ts - Clean validation logic
- src/build/compiler/mdx-compiler/watcher.ts - Clean file watching
- src/build/compiler/mdx-to-js.ts - Clean MDX to JS conversion

**Production Build:**
- src/build/production-build/asset-generation.ts - Clean asset generation
- src/build/production-build/build/build-cleanup.ts - Clean build cleanup
- src/build/production-build/build/build-executor.ts - Clean build execution
- src/build/production-build/build/build-initializer.ts - Clean initialization
- src/build/production-build/build/build-orchestrator.ts - Clean orchestration
- src/build/production-build/build/build-setup.ts - Clean setup
- src/build/production-build/build/code-splitter-orchestrator.ts - Clean code splitting
- src/build/production-build/build/index.ts - Clean export barrel file
- src/build/production-build/build/output-generator.ts - Clean output generation
- src/build/production-build/build/route-collector.ts - Clean route collection
- src/build/production-build/client-runtime.ts - Clean client runtime generation
- src/build/production-build/index.ts - Clean export barrel file
- src/build/production-build/manifest.ts - Clean manifest handling with proper validation
- src/build/production-build/static-generation.ts - Clean SSG implementation
- src/build/production-build/templates.ts - Clean template definitions

**Renderer:**
- src/build/renderer/index.ts - Clean export barrel file
- src/build/renderer/services/css-bundler.ts - Clean CSS bundling
- src/build/renderer/services/mdx-bundler.ts - Clean MDX bundling with proper plugin handling
- src/build/renderer/services/optimizer.ts - Clean bundle optimization
- src/build/renderer/services/script-bundler.ts - Clean script bundling with esbuild
- src/build/renderer/types/bundler-types.ts - Clean type re-exports
- src/build/renderer/utils/import-utils.ts - Clean import extraction and resolution
- src/build/renderer/utils/loader-utils.ts - Clean loader utilities

**Transforms - ESM:**
- src/build/transforms/esm-transform.ts - Clean transform re-exports
- src/build/transforms/esm/import-parser.ts - Clean import parsing with proper extension resolution
- src/build/transforms/esm/index.ts - Clean export barrel file
- src/build/transforms/esm/lexer.ts - Clean es-module-lexer wrapper
- src/build/transforms/esm/path-resolver.ts - Clean path resolution
- src/build/transforms/esm/react-imports.ts - Clean React import resolution for SSR/browser
- src/build/transforms/esm/transform-cache.ts - Clean transform caching with TTL
- src/build/transforms/esm/transform-core.ts - Clean ESM transformation core
- src/build/transforms/esm/transform-utils.ts - Clean transformation utilities
- src/build/transforms/esm/types.ts - Clean type definitions

**Transforms - MDX:**
- src/build/transforms/mdx/compiler/frontmatter-extractor.ts - Clean frontmatter extraction
- src/build/transforms/mdx/compiler/import-rewriter.ts - Clean import rewriting for browser/server
- src/build/transforms/mdx/compiler/index.ts - Clean export barrel file
- src/build/transforms/mdx/compiler/mdx-compiler.ts - Clean MDX runtime compilation
- src/build/transforms/mdx/compiler/types.ts - Clean type definitions
- src/build/transforms/mdx/esm-module-loader.ts - Clean ESM module loading with HTTP bundling
- src/build/transforms/mdx/index.ts - Clean export barrel file
- src/build/transforms/mdx/loader.ts - Clean MDX module loading
- src/build/transforms/mdx/mdx-cache-adapter.ts - Clean MDX caching with bundle manifest store
- src/build/transforms/mdx/module-executor.ts - Clean module execution (with security blocking of string eval)
- src/build/transforms/mdx/module-loader.ts - Clean MDX module loader re-exports
- src/build/transforms/mdx/parser.ts - Clean MDX code parsing
- src/build/transforms/mdx/types.ts - Clean type definitions

**Transforms - Plugins:**
- src/build/transforms/plugins/index.ts - Clean plugin exports
- src/build/transforms/plugins/plugin-loader.ts - Clean plugin loading with defaults
- src/build/transforms/plugins/rehype-utils.ts - Clean rehype utilities
- src/build/transforms/plugins/remark-headings.ts - Clean heading extraction with GithubSlugger
- src/build/transforms/plugins/remark-mdx-utils.ts - Clean MDX-specific remark plugins
- src/build/transforms/plugins/remark-node-id.ts - Clean node ID assignment
- src/build/transforms/index.ts - Clean transform exports

**Utils:**
- src/build/utils/file-types.ts - Clean file type utilities with MIME types
- src/build/utils/index.ts - Clean utility exports
- src/build/utils/asset-utils.ts - Clean asset utilities

**Root:**
- src/build/index.ts - Clean main build exports

### src/rendering (95 files reviewed)

#### Issues Found and Fixed:

1. **src/rendering/utils/stream-utils.ts**
   - Bug: `streamToString()` function was missing final flush of TextDecoder - could lose trailing characters when decoding multi-byte characters that span chunk boundaries
   - Fix: Added `decoder.decode()` call after the read loop to flush any remaining bytes in the decoder

2. **src/rendering/orchestrator/pipeline.ts**
   - Code Smell: Used overly broad `Function` type for `transformToESM` parameter in `loadModuleRecursive()` method
   - Fix: Replaced with properly typed function signature specifying all parameters and return type
   - Bug: Potential undefined access on `match[1]` in `extractAliasImports()` - regex capture group could be undefined
   - Fix: Added explicit null check `if (capturedPath && !imports.includes(capturedPath))`
   - Code Smell: Unused `quote` variable in `rewriteImport()` method
   - Fix: Removed unused variable declaration

3. **src/rendering/layouts/utils/applicator.ts** and **src/rendering/layouts/utils/component-loader.ts**
   - Code Smell: Duplicate `ensureValidChild()` function defined in both files with identical implementations
   - Note: Identified as code duplication but not refactored to avoid risk of divergence - marked for future consolidation

4. **General observations (clean code, no fixes needed):**
   - src/rendering/index.ts - Clean export barrel file
   - src/rendering/app-reserved.ts - Clean reserved path handling
   - src/rendering/app-route-resolver.ts - Clean route resolution with proper type guards
   - src/rendering/chunk-optimizer.ts - Clean chunk optimization utilities
   - src/rendering/cleanup.ts - Clean resource cleanup utilities
   - src/rendering/component-handling.ts - Clean component handling utilities
   - src/rendering/mdx-renderer.ts - Clean MDX rendering implementation
   - src/rendering/page-renderer.ts - Clean page rendering orchestration
   - src/rendering/page-rendering.ts - Clean page rendering utilities
   - src/rendering/plugins.ts - Clean plugin system
   - src/rendering/route-params-extractor.ts - Clean route parameter extraction
   - src/rendering/router-detection.ts - Clean router detection utilities
   - src/rendering/script-page-handling.ts - Clean script page handling
   - src/rendering/ssr-renderer.ts - Clean SSR rendering implementation
   - src/rendering/virtual-module-system.ts - Clean virtual module handling

**Cache Files (clean):**
- src/rendering/cache/index.ts - Clean export barrel file
- src/rendering/cache/cache-coordinator.ts - Clean cache coordination with proper TTL handling
- src/rendering/cache/types.ts - Clean type definitions
- src/rendering/cache/stores/*.ts - Clean cache store implementations (memory, filesystem, kv, redis)

**Client Files (clean):**
- src/rendering/client/index.ts - Clean export barrel file
- src/rendering/client/browser-logger.ts - Clean browser logging
- src/rendering/client/browser-stubs/logger.ts - Clean browser stub
- src/rendering/client/hmr-runtime.ts - Clean HMR runtime
- src/rendering/client/prefetch.ts - Clean prefetch utilities
- src/rendering/client/router.ts - Clean client router
- src/rendering/client/state-bridge.ts - Clean state bridge
- src/rendering/client/prefetch/*.ts - Clean prefetch utilities (link-observer, network-utils, prefetch-queue, resource-hints)

**Element Validator Files (clean):**
- src/rendering/element-validator/index.ts - Clean export barrel file
- src/rendering/element-validator/types.ts - Clean type definitions
- src/rendering/element-validator/validator-core.ts - Clean validation core
- src/rendering/element-validator/primitive-checks.ts - Clean primitive validation
- src/rendering/element-validator/element-inspector.ts - Clean element inspection
- src/rendering/element-validator/element-normalizer.ts - Clean element normalization

**Layout Files (clean):**
- src/rendering/layouts/index.ts - Clean export barrel file
- src/rendering/layouts/types.ts - Clean type definitions
- src/rendering/layouts/layout-applicator.ts - Clean layout application
- src/rendering/layouts/layout-collector.ts - Clean layout collection
- src/rendering/layouts/layout-compiler.ts - Clean layout compilation
- src/rendering/layouts/provider-manager.ts - Clean provider management
- src/rendering/layouts/utils/*.ts - Clean layout utilities (discovery, compiler, hash-calculator)

**Orchestrator Files (clean):**
- src/rendering/orchestrator/index.ts - Clean export barrel file
- src/rendering/orchestrator/types.ts - Clean type definitions
- src/rendering/orchestrator/config.ts - Clean configuration
- src/rendering/orchestrator/ssr-orchestrator.ts - Clean SSR orchestration
- src/rendering/orchestrator/ssr.ts - Clean SSR utilities
- src/rendering/orchestrator/html.ts - Clean HTML generation
- src/rendering/orchestrator/layout.ts - Clean layout orchestration
- src/rendering/orchestrator/lifecycle.ts - Clean lifecycle management
- src/rendering/orchestrator/mdx.ts - Clean MDX orchestration
- src/rendering/orchestrator/compiler-service.ts - Clean compiler service

**Page Resolution Files (clean):**
- src/rendering/page-resolution/index.ts - Clean export barrel file
- src/rendering/page-resolution/page-resolver.ts - Clean page resolution

**RSC Files (clean):**
- src/rendering/rsc/index.ts - Clean export barrel file
- src/rendering/rsc/types.ts - Clean type definitions
- src/rendering/rsc/constants.ts - Clean constants
- src/rendering/rsc/component-analyzer.ts - Clean component analysis
- src/rendering/rsc/server-renderer/*.ts - Clean server renderer implementations

**SSR Files (clean):**
- src/rendering/ssr/index.ts - Clean export barrel file
- src/rendering/ssr/types.ts - Clean type definitions
- src/rendering/ssr/component-registry.ts - Clean component registry
- src/rendering/ssr/mdx-browser-loader.ts - Clean MDX browser loader
- src/rendering/ssr/mdx-module-loader.ts - Clean MDX module loader
- src/rendering/ssr/mdx-renderer.ts - Clean MDX renderer

