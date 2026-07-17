import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferInput, InferSchema } from "#veryfront/extensions/schema/index.ts";
import { type ConfigContext, createError, toError } from "#veryfront/errors/veryfront-error.ts";

// Sub-schemas
const getCorsSchema = defineSchema((v) =>
  v.union([v.boolean(), v.object({ origin: v.string().optional() }).strict()])
);

const getBasicAuthSchema = defineSchema((v) =>
  v.object({
    username: v.string(),
    password: v.string(),
    realm: v.string().optional(),
  })
);

const getBearerAuthSchema = defineSchema((v) =>
  v.object({
    token: v.string(),
  })
);

const getEmbeddingDimensionSchema = defineSchema((v) =>
  v.union([
    v.literal(768),
    v.literal(1024),
    v.literal(1536),
    v.literal(3072),
    v.literal(4096),
  ])
);

// Main config schema
export const getVeryfrontConfigSchema = defineSchema((v) =>
  v
    .object({
      projectSlug: v.string().optional(),
      title: v.string().optional(),
      description: v.string().optional(),
      react: v
        .object({
          /** React version to use (e.g., "18.3.1", "19.1.1"). Defaults to auto-detect from package.json or 19.1.1 */
          version: v.string().optional(),
        })
        .partial()
        .optional(),
      directories: v
        .object({
          app: v.string().optional(),
          pages: v.string().optional(),
          components: v.array(v.string()).optional(),
          ai: v.string().optional(),
        })
        .partial()
        .optional(),
      experimental: v
        .object({
          esmLayouts: v.boolean().optional(),
          precompileMDX: v.boolean().optional(),
          rsc: v.boolean().optional(),
        })
        .partial()
        .optional(),
      router: v.enum(["app", "pages"]).optional(),
      /** Path to the layout component (e.g., 'components/layout.tsx'), or false to disable */
      layout: v.union([v.string(), v.literal(false)]).optional(),
      /** Path to the app wrapper component (e.g., 'components/app.tsx'), or false to disable */
      app: v.union([v.string(), v.literal(false)]).optional(),
      theme: v.object({ colors: v.record(v.string(), v.string()).optional() }).partial().optional(),
      build: v
        .object({
          outDir: v.string().optional(),
          trailingSlash: v.boolean().optional(),
          esbuild: v
            .object({
              wasmURL: v.string().url().optional(),
              worker: v.boolean().optional(),
            })
            .partial()
            .optional(),
        })
        .partial()
        .optional(),
      cache: v
        .object({
          dir: v.string().optional(),
          bundleManifest: v
            .object({
              type: v.enum(["redis", "kv", "memory"]).optional(),
              redisUrl: v.string().optional(),
              keyPrefix: v.string().optional(),
              ttl: v.number().int().positive().optional(),
              enabled: v.boolean().optional(),
            })
            .partial()
            .optional(),
          render: v
            .object({
              type: v.enum(["memory", "filesystem", "kv", "redis"]).optional(),
              ttl: v.number().optional(),
              maxEntries: v.number().optional(),
              kvPath: v.string().optional(),
              redisUrl: v.string().optional(),
              redisKeyPrefix: v.string().optional(),
            })
            .partial()
            .optional(),
          /**
           * Query parameter handling for page cache keys.
           * Controls which URL query params affect cache key generation.
           *
           * Policies:
           * - "ignore-all": Ignore all query params (pages with ?utm_campaign=x share cache with /)
           * - "include-all": Include all query params (each unique query = separate cache)
           * - "include-list": Only include specified params in cache key
           * - "exclude-list": Exclude specified params (+ common tracking params like utm_*) (default)
           *
           * @example
           * // Ignore all marketing/tracking params (recommended for most sites)
           * cache: { queryParams: { policy: "exclude-list" } }
           *
           * @example
           * // Only vary cache by specific params
           * cache: { queryParams: { policy: "include-list", params: ["page", "sort"] } }
           */
          queryParams: v
            .object({
              policy: v.enum(["ignore-all", "include-all", "include-list", "exclude-list"])
                .optional(),
              params: v.array(v.string()).optional(),
            })
            .partial()
            .optional(),
        })
        .partial()
        .optional(),
      dev: v
        .object({
          port: v.number().int().positive().optional(),
          host: v.string().optional(),
          open: v.boolean().optional(),
          hmr: v.boolean().optional(),
          hmrPort: v.number().optional(),
          components: v.array(v.string()).optional(),
          moduleServerUrl: v.string().optional(),
        })
        .partial()
        .optional(),
      resolve: v
        .object({
          importMap: v
            .object({
              imports: v.record(v.string(), v.string()).optional(),
              scopes: v.record(v.string(), v.record(v.string(), v.string())).optional(),
            })
            .partial()
            .optional(),
        })
        .partial()
        .optional(),
      security: v
        .object({
          auth: v
            .object({
              basic: getBasicAuthSchema().optional(),
              bearer: getBearerAuthSchema().optional(),
            })
            .partial()
            .optional(),
          csp: v.record(v.string(), v.array(v.string())).optional(),
          remoteHosts: v.array(v.string().url()).optional(),
          cors: getCorsSchema().optional(),
          /**
           * CSRF protection using the double-submit cookie pattern.
           * Set `true` for defaults, or pass an object to customize.
           *
           * When enabled, POST/PUT/PATCH/DELETE requests must include
           * an `x-csrf-token` header matching the `__Host-vf_csrf` cookie.
           * The cookie is set automatically on HTML document responses.
           *
           * Server Actions (`/_veryfront/rsc/action`) are CSRF-protected;
           * client code must forward the cookie value as the header.
           */
          csrf: v.union([
            v.boolean(),
            v.object({
              cookieName: v.string().optional(),
              headerName: v.string().optional(),
              excludePaths: v.array(v.string()).optional(),
              ttlSec: v.number().int().positive().optional(),
            }).strict(),
          ]).optional(),
          coop: v.enum(["same-origin", "same-origin-allow-popups", "unsafe-none"]).optional(),
          corp: v.enum(["same-origin", "same-site", "cross-origin"]).optional(),
          coep: v.enum(["require-corp", "unsafe-none"]).optional(),
          /**
           * Restrict module imports to specific directories (opt-in security).
           * When not set, users can import from any directory in the project.
           * When set, only imports from these directories are allowed.
           * @example ["app", "pages", "components", "lib", "src", "utils"]
           */
          allowedImportDirs: v.array(v.string()).optional(),
        })
        .partial()
        .optional(),
      middleware: v
        .object({
          custom: v.array(v.any()).optional(),
        })
        .partial()
        .optional(),
      theming: v
        .object({
          brandName: v.string().optional(),
          logoHtml: v.string().optional(),
        })
        .partial()
        .optional(),
      assetPipeline: v
        .object({
          images: v
            .object({
              enabled: v.boolean().optional(),
              formats: v.array(v.enum(["webp", "avif", "jpeg", "png"])).optional(),
              sizes: v.array(v.number().int().positive()).optional(),
              quality: v.number().int().min(1).max(100).optional(),
              inputDir: v.string().optional(),
              outputDir: v.string().optional(),
              preserveOriginal: v.boolean().optional(),
            })
            .partial()
            .optional(),
          css: v
            .object({
              enabled: v.boolean().optional(),
              minify: v.boolean().optional(),
              autoprefixer: v.boolean().optional(),
              purge: v.boolean().optional(),
              criticalCSS: v.boolean().optional(),
              inputDir: v.string().optional(),
              outputDir: v.string().optional(),
              browsers: v.array(v.string()).optional(),
              purgeContent: v.array(v.string()).optional(),
              sourceMap: v.boolean().optional(),
            })
            .partial()
            .optional(),
        })
        .partial()
        .optional(),
      observability: v
        .object({
          tracing: v
            .object({
              enabled: v.boolean().optional(),
              exporter: v.enum(["jaeger", "zipkin", "otlp", "console"]).optional(),
              endpoint: v.string().optional(),
              serviceName: v.string().optional(),
              sampleRate: v.number().min(0).max(1).optional(),
            })
            .partial()
            .optional(),
          metrics: v
            .object({
              enabled: v.boolean().optional(),
              exporter: v.enum(["prometheus", "otlp", "console"]).optional(),
              endpoint: v.string().optional(),
              prefix: v.string().optional(),
              collectInterval: v.number().int().positive().optional(),
            })
            .partial()
            .optional(),
          logging: v
            .object({
              file: v
                .object({
                  enabled: v.boolean().optional(),
                  path: v.string().optional(),
                  maxSize: v.union([v.number().int().positive(), v.string()]).optional(),
                  maxFiles: v.number().int().positive().optional(),
                  level: v.enum(["debug", "info", "warn", "error"]).optional(),
                  format: v.enum(["json", "text"]).optional(),
                })
                .partial()
                .optional(),
            })
            .partial()
            .optional(),
        })
        .partial()
        .optional(),
      search: v
        .object({
          enabled: v.boolean().optional(),
          embedding: v
            .object({
              provider: v.enum(["openai", "cohere", "voyageai", "custom"]).optional(),
              model: v.string().optional(),
              dimension: getEmbeddingDimensionSchema().optional(),
              apiKey: v.string().optional(),
              batchSize: v.number().int().positive().optional(),
            })
            .partial()
            .optional(),
          chunking: v
            .object({
              maxTokens: v.number().int().positive().optional(),
              overlapTokens: v.number().int().min(0).optional(),
              include: v.array(v.string()).optional(),
              exclude: v.array(v.string()).optional(),
            })
            .partial()
            .optional(),
          autoIndex: v.boolean().optional(),
        })
        .partial()
        .optional(),
      fs: v
        .object({
          type: v.enum(["local", "veryfront-api", "memory", "github"]).optional(),
          local: v.object({ baseDir: v.string().optional() }).partial().optional(),
          veryfront: v
            .object({
              apiBaseUrl: v.string().url(),
              /** API token - optional in proxy mode (token provided per-request via headers) */
              apiToken: v.string().optional(),
              /** Project slug - optional in proxy mode (slug provided per-request via headers) */
              projectSlug: v.string().optional(),
              /** Enable proxy mode for multi-project handling (tokens/slugs from headers) */
              proxyMode: v.boolean().optional(),
              /** Production mode - fetch from releases instead of draft files */
              productionMode: v.boolean().optional(),
              cache: v
                .object({
                  enabled: v.boolean().optional(),
                  ttl: v.number().int().positive().optional(),
                  maxSize: v.number().int().positive().optional(),
                })
                .partial()
                .optional(),
              retry: v
                .object({
                  maxRetries: v.number().int().min(0).optional(),
                  initialDelay: v.number().int().positive().optional(),
                  maxDelay: v.number().int().positive().optional(),
                })
                .partial()
                .optional(),
            })
            .partial()
            .optional(),
          memory: v
            .object({
              files: v.record(v.string(), v.union([v.string(), v.instanceof(Uint8Array)]))
                .optional(),
            })
            .partial()
            .optional(),
          github: v
            .object({
              /** GitHub Personal Access Token */
              token: v.string(),
              /** Repository owner (user or organization) */
              owner: v.string(),
              /** Repository name */
              repo: v.string(),
              /** Branch, tag, or commit SHA (default: "main") */
              ref: v.string().optional(),
              cache: v
                .object({
                  enabled: v.boolean().optional(),
                  ttl: v.number().int().positive().optional(),
                  maxSize: v.number().int().positive().optional(),
                  maxMemory: v.number().int().positive().optional(),
                })
                .partial()
                .optional(),
              retry: v
                .object({
                  maxRetries: v.number().int().min(0).optional(),
                  initialDelay: v.number().int().positive().optional(),
                  maxDelay: v.number().int().positive().optional(),
                })
                .partial()
                .optional(),
            })
            .optional(),
        })
        .partial()
        .optional(),
      ai: v
        .object({
          enabled: v.boolean().optional(),
          providers: v.record(
            v.string(),
            v.object({
              apiKey: v.string().optional(),
              baseURL: v.string().optional(),
              defaultModel: v.string().optional(),
              organization: v.string().optional(),
            }).passthrough(),
          ).optional(),
          tools: v
            .object({
              discovery: v
                .object({
                  enabled: v.boolean().optional(),
                  paths: v.array(v.string()).optional(),
                })
                .partial()
                .optional(),
            })
            .partial()
            .optional(),
          agents: v
            .object({
              discovery: v
                .object({
                  enabled: v.boolean().optional(),
                  paths: v.array(v.string()).optional(),
                })
                .partial()
                .optional(),
            })
            .partial()
            .optional(),
          skills: v
            .object({
              discovery: v
                .object({
                  enabled: v.boolean().optional(),
                  paths: v.array(v.string()).optional(),
                })
                .partial()
                .optional(),
            })
            .partial()
            .optional(),
          resources: v
            .object({
              discovery: v
                .object({
                  enabled: v.boolean().optional(),
                  paths: v.array(v.string()).optional(),
                })
                .partial()
                .optional(),
            })
            .partial()
            .optional(),
          prompts: v
            .object({
              discovery: v
                .object({
                  enabled: v.boolean().optional(),
                  paths: v.array(v.string()).optional(),
                })
                .partial()
                .optional(),
            })
            .partial()
            .optional(),
          workflows: v
            .object({
              discovery: v
                .object({
                  enabled: v.boolean().optional(),
                  paths: v.array(v.string()).optional(),
                })
                .partial()
                .optional(),
            })
            .partial()
            .optional(),
          work: v
            .object({
              discovery: v
                .object({
                  enabled: v.boolean().optional(),
                  paths: v.array(v.string()).optional(),
                })
                .partial()
                .optional(),
            })
            .partial()
            .optional(),
          tasks: v
            .object({
              discovery: v
                .object({
                  enabled: v.boolean().optional(),
                  paths: v.array(v.string()).optional(),
                })
                .partial()
                .optional(),
            })
            .partial()
            .optional(),
          schedules: v
            .object({
              discovery: v
                .object({
                  enabled: v.boolean().optional(),
                  paths: v.array(v.string()).optional(),
                })
                .partial()
                .optional(),
            })
            .partial()
            .optional(),
          webhooks: v
            .object({
              discovery: v
                .object({
                  enabled: v.boolean().optional(),
                  paths: v.array(v.string()).optional(),
                })
                .partial()
                .optional(),
            })
            .partial()
            .optional(),
          evals: v
            .object({
              discovery: v
                .object({
                  enabled: v.boolean().optional(),
                  paths: v.array(v.string()).optional(),
                })
                .partial()
                .optional(),
            })
            .partial()
            .optional(),
          mcp: v
            .object({
              enabled: v.boolean().optional(),
              port: v.number().optional(),
              expose: v.array(v.string()).optional(),
            })
            .partial()
            .optional(),
        })
        .partial()
        .optional(),
      client: v
        .object({
          /** How to resolve veryfront client modules in browser */
          moduleResolution: v.enum(["cdn", "self-hosted", "bundled"]).optional(),
          /** CDN options when moduleResolution is 'cdn' */
          cdn: v
            .object({
              provider: v.enum(["esm.sh", "unpkg", "jsdelivr"]).optional(),
              /** 'auto' detects from package.json, or pin specific versions */
              versions: v
                .union([
                  v.literal("auto"),
                  v.object({
                    react: v.string().optional(),
                    veryfront: v.string().optional(),
                  }),
                ])
                .optional(),
            })
            .partial()
            .optional(),
        })
        .partial()
        .optional(),
      /** CLI generate command preferences */
      generate: v
        .object({
          /** Preferred router for generated pages */
          preferredRouter: v.enum(["app-router", "pages-router"]).optional(),
        })
        .partial()
        .optional(),
      tailwind: v
        .object({
          /** Path to the global stylesheet (default: "globals.css") */
          stylesheet: v.string().optional(),
          /** Enable built-in Tailwind CDN plugins (forms, typography, aspect-ratio, container-queries) */
          plugins: v.array(v.enum(["forms", "typography", "aspect-ratio", "container-queries"]))
            .optional(),
          /** Extend the Tailwind theme (merged with veryfront defaults) */
          theme: v
            .object({
              extend: v.record(v.string(), v.unknown()).optional(),
            })
            .partial()
            .optional(),
          /** Custom CSS content to add (for @layer, @apply directives, etc.) */
          customCSS: v.string().optional(),
        })
        .partial()
        .optional(),
      /**
       * Extensions registered for this project.
       *
       * Each entry is either a fully-materialized `Extension` object or a
       * disable directive `{ name, enabled: false }` that vetoes an extension
       * discovered from a lower-priority source. The runtime type is
       * tightened at the `veryfront/extensions` barrel — we keep this as
       * `v.unknown()` here to avoid pulling the extensions module into the
       * config layer (would introduce a circular import).
       */
      extensions: v.array(v.unknown()).optional(),
      /** OpenAPI documentation configuration */
      openapi: v
        .object({
          /** Enable OpenAPI endpoint (default: true) */
          enabled: v.boolean().optional(),
          /** Enable interactive docs page using Scalar (default: true) */
          docs: v.boolean().optional(),
          /** API title for OpenAPI info section */
          title: v.string().optional(),
          /** API version (default: "1.0.0") */
          version: v.string().optional(),
          /** API description */
          description: v.string().optional(),
          /** Custom path configuration */
          paths: v
            .object({
              /** Path for JSON spec (default: "/_openapi.json") */
              json: v.string().optional(),
              /** Path for YAML spec (default: "/_openapi.yaml") */
              yaml: v.string().optional(),
              /** Path for interactive docs (default: "/_docs") */
              docs: v.string().optional(),
            })
            .partial()
            .optional(),
          /** MCP integration configuration */
          mcp: v
            .object({
              /** Expose OpenAPI spec as MCP resource at openapi://spec (default: true) */
              resource: v.boolean().optional(),
              /** Auto-generate MCP tools from API routes (default: true) */
              tools: v.boolean().optional(),
              /** Tool naming prefix (default: "api") - tools named as prefix:operationId */
              toolPrefix: v.string().optional(),
            })
            .partial()
            .optional(),
        })
        .partial()
        .optional(),
    })
    .partial()
);
export const veryfrontConfigSchema = lazySchema(getVeryfrontConfigSchema);

// Inferred types
export type VeryfrontConfig = InferSchema<ReturnType<typeof getVeryfrontConfigSchema>>;
/** User-authored configuration accepted before schema transforms run. */
export type VeryfrontConfigInput = InferInput<ReturnType<typeof getVeryfrontConfigSchema>>;

// Validation function
export function validateVeryfrontConfig(input: unknown): VeryfrontConfig {
  const result = veryfrontConfigSchema.safeParse(input);
  if (result.success) return result.data;

  const issues = result.issues ?? [];
  const first = issues[0];
  const path = first?.path?.length ? first.path.join(".") : "<root>";
  const expected = first?.message ?? String(first);
  const corsHint = path.includes("security.cors")
    ? " Expected boolean or { origin?: string }."
    : "";
  const expectedWithHint = expected + corsHint;

  const context: ConfigContext = {
    field: path,
    expected: expectedWithHint,
    value: input,
  };

  throw toError(
    createError({
      type: "config",
      message: `Invalid veryfront.config at ${path}: ${expectedWithHint}.`,
      context,
    }),
  );
}

/**
 * Known top-level keys from the config schema definition.
 * Maintained in sync with the `getVeryfrontConfigSchema` shape above.
 */
const knownConfigKeys = new Set([
  "projectSlug",
  "title",
  "description",
  "react",
  "directories",
  "experimental",
  "router",
  "layout",
  "app",
  "theme",
  "build",
  "cache",
  "dev",
  "resolve",
  "security",
  "middleware",
  "theming",
  "assetPipeline",
  "observability",
  "search",
  "fs",
  "ai",
  "client",
  "generate",
  "tailwind",
  "extensions",
  "openapi",
]);

export function findUnknownTopLevelKeys(input: Record<string, unknown>): string[] {
  return Object.keys(input).filter((key) => !knownConfigKeys.has(key));
}
