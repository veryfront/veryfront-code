# NLSpec: src/types/

## Purpose

Central type-definition module for the Veryfront renderer. It declares and re-exports all shared
contracts consumed across the codebase: branded IDs, server handler types, RSC / HMR message
shapes, entity models (with Zod validation), MDX/page rendering interfaces, bundler options,
CSS-optimizer types, and global runtime type-guards. The barrel `index.ts` is the single
`#veryfront/types` import-map entry so every other module can depend on a stable public surface.

## Public API

### Exports

| Export | Type | Source | Description |
|--------|------|--------|-------------|
| `Brand<T, TBrand>` | type | branded.ts | Branded-type constructor via unique symbol |
| `Unbrand<T>` | type | branded.ts | Strips the brand from a branded type |
| `EntityId`, `ResourceId`, `ToolId`, `PromptId`, `UserId`, `AgentId`, `SessionId`, `Slug`, `PageId`, `LayoutId`, `RequestId`, `ToolCallId`, `MessageId`, `AuthToken`, `CsrfToken`, `ApiKey` | type | branded.ts | Concrete branded string IDs |
| `Handler`, `HandlerContext`, `HandlerResult`, `HandlerMetadata`, `HandlerPriority` (enum) | type/value | server.ts | Server request-handler chain types |
| `MiddlewareFunction` | type | server.ts | Middleware signature (req, ctx, next) |
| `ParsedDomain` | type | server.ts | Parsed domain info from host header |
| `RoutePattern`, `RouteRegistryConfig`, `RouteHandlerModule`, `AppRouteMatch` | type | server.ts | Route matching & registry types |
| `SecurityConfig` | type | server.ts | Security configuration shape |
| `BundleResult`, `BundlerOptions`, `EmbeddedBundleManifest`, `MDXBundleOptions`, `MDXBundleResult` | type | bundler.ts | Bundler input/output contracts |
| `RSCNode`, `RSCPayload`, `ClientComponentMeta`, `RSCRendererOptions`, `RSCHydratorOptions`, `ComponentType`, `ComponentAnalysis` | type | rsc.ts | React Server Components types |
| `HMRMessage`, `HMRMessageType`, `HMRConnectedMessage`, `HMRUpdateMessage`, `HMRReloadMessage` | type | hmr.ts | Hot-module-replacement WebSocket messages |
| `Entity`, `EntityInfo`, `EntityTypeInfo`, `Frontmatter`, `BundleInfo`, `LoaderData` | type | entities.ts | Entity model + related shapes |
| `FrontmatterSchema`, `EntitySchema` | value | entities.ts | Zod schemas for validation |
| `validateEntity`, `safeValidateEntity`, `detectEntityType` | function | entities.ts | Entity validation & type-detection |
| `getEntityInfo`, `getEntityBySlug`, `getLayoutEntity` | function | entities/getEntityInfo.ts | Entity resolution from filesystem/adapter |
| `AppProps` | type | app.ts | Root React app component props |
| `ComponentProps`, `Component`, `ComponentFunction` | type | index.ts | Generic React component contracts |
| `MDXComponents`, `MDXFrontmatter`, `MDXGlobals` | type | index.ts | MDX-specific types |
| `PageContext`, `RequestContext` | type | index.ts | Per-request context shapes |
| `MaybePromise<T>` | type | index.ts | `T \| Promise<T>` utility |
| `MdxBundle`, `PageBundle`, `MDXModule`, `ScriptPageModule` | type | index.ts | Page rendering contracts |
| `LayoutItem` | type | index.ts | Layout stack item (mdx or tsx) |
| `RenderMetadata`, `RenderResult` | type | index.ts | Render output shapes |
| CSS optimizer types (`BrowserTargets`, `CSSBundle`, etc.) | type | re-exported from build module | CSS optimization contracts |
| `GlobalWithReactDOM`, `GlobalWithVeryFrontCache` | type | global-guards.ts | Augmented global shapes |
| `hasReactDOM`, `hasVeryFrontCache`, `hasDenoRuntime`, `hasNodeProcess`, `hasBunRuntime` | function | global-guards.ts | Runtime type-guard predicates |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `react` | esm.sh | React types for component contracts |
| `zod` | esm.sh | Entity/Frontmatter validation schemas |
| `#std/front-matter/yaml.ts` | Deno std | YAML frontmatter extraction |
| `#veryfront/platform/compat/fs.ts` | platform module | Filesystem abstraction |
| `#veryfront/compat/path` | compat module | Path manipulation |
| `#veryfront/platform/adapters/*` | platform module | Runtime adapter & fallback |
| `#veryfront/errors/*` | errors module | Structured error creation |
| `#veryfront/utils` | utils module | Logger, runtime guards |
| `#veryfront/utils/parallel.ts` | utils module | `parallelMap` helper |
| `#veryfront/observability/tracing/*` | observability | `withSpan` for tracing |
| `#veryfront/config` | config module | `VeryfrontConfig` type |
| `../server/context/*` | server module | `RequestContext`, `EnrichedContext` types |
| `../security/csrf/helpers.ts` | security module | `CsrfConfig` type |

## Behaviors

### Behavior 1: Entity type detection (`detectEntityType`)
- **Given**: A filename and optional frontmatter
- **When**: `detectEntityType(fileName, frontmatter)` is called
- **Then**: Returns `EntityTypeInfo` with `type` ("page"/"layout"/"component"), `kind` ("mdx"/"tsx"), and boolean flags
- **Edge cases**:
  - Files starting with `[` are dynamic routes (not components)
  - Uppercase-initial filenames are components (unless layout)
  - `frontmatter.isLayout === true` overrides filename detection

### Behavior 2: Entity validation (`validateEntity` / `safeValidateEntity`)
- **Given**: An unknown value
- **When**: Validated against `EntitySchema`
- **Then**: Returns typed `Entity` or throws/returns null
- **Edge cases**: Path must match file extension regex; id must be valid UUID

### Behavior 3: Entity info resolution (`getEntityInfo`)
- **Given**: A file path and optional runtime adapter
- **When**: Called
- **Then**: Reads file, extracts frontmatter (if mdx/md), detects entity type, returns `EntityInfo`
- **Edge cases**:
  - Adapter paths normalized for Veryfront API adapter
  - Falls back to local filesystem when adapter fails
  - Returns null on missing files or errors

### Behavior 4: Entity lookup by slug (`getEntityBySlug`)
- **Given**: A project directory, slug, and optional adapter
- **When**: Called
- **Then**: Searches pages directory for matching file across all extensions, including dynamic routes
- **Edge cases**:
  - `.veryfront/` routes resolved from project root
  - `index`/empty slug resolved to pages/index
  - Dynamic route `[param].ext` files checked at each directory depth

### Behavior 5: Layout entity lookup (`getLayoutEntity`)
- **Given**: A project directory, layout name, optional adapter
- **When**: Called
- **Then**: Searches layouts/ then components/ directories for matching layout
- **Edge cases**:
  - `@components/` and `@/` prefixes resolved
  - Explicit extension paths don't fall back to convention search
  - Files in layouts/ are layouts by convention; files in components/ must match layout naming

### Behavior 6: Global type guards (`hasReactDOM`, `hasVeryFrontCache`)
- **Given**: An unknown value
- **When**: Guard is called
- **Then**: Returns `true` with type narrowing if the expected property exists
- **Edge cases**: null, undefined, and non-object values return false

## Constraints
- Do NOT change public API signatures
- Do NOT modify files outside src/types/
- Must pass: `deno fmt --check`, `deno lint`, `deno test`

## Error Handling
- `getEntityInfo` wraps errors via `createErrorScope` and returns null on failure
- `validateEntity` throws Zod `ZodError` on invalid input
- `safeValidateEntity` returns null instead of throwing
- Adapter fallback via `withFallback` logs and retries with local FS

## Side Effects
- `getEntityInfo` / `getEntityBySlug` / `getLayoutEntity` perform filesystem I/O
- Tracing spans emitted via `withSpan`
- Debug logging via `logger.debug`

## Performance Constraints
- `parallelMap` used for concurrent file resolution in `getEntityBySlug` and `getLayoutEntity`
- Entity lookup fans out to many file extensions; parallelism is critical

## Invariants
- Every exported branded type is a string with a unique brand tag
- `EntitySchema` enforces: id is UUID, path has valid extension, slug is non-empty
- `detectEntityType` flags are mutually exclusive: exactly one of isLayout/isComponent/isPage is true
- `HandlerPriority` enum values are ordered: CRITICAL(0) < EARLY(25) < HIGH(100) < MEDIUM(500) < LOW(1000) < FALLBACK(10000)
