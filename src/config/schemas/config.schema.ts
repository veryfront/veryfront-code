import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferInput, InferSchema } from "#veryfront/extensions/schema/index.ts";
import { CONFIG_VALIDATION_FAILED } from "#veryfront/errors/error-registry.ts";
import { ALL_INTEGRATION_NAMES } from "#veryfront/integrations/schema.ts";
import type { SourceIntegrationPolicyConfig } from "#veryfront/integrations/source-policy.ts";
import { validateLegacyRenderRedisCacheKeyPrefix } from "#veryfront/cache/backends/redis-keyspace.ts";
import { MAX_CACHE_TTL_MILLISECONDS } from "#veryfront/cache/backends/ttl.ts";
import { MAX_PORT, MIN_PORT } from "#veryfront/utils/constants/network.ts";
import {
  HTTP_TOKEN_PATTERN,
  isBoundedCorsOrigin,
  isBoundedCorsOriginList,
  isBoundedCorsTokenList,
  MAX_CORS_MAX_AGE,
  MAX_CORS_ORIGIN_COUNT,
  MAX_CORS_ORIGIN_LENGTH,
  MAX_CORS_TOKEN_COUNT,
  MAX_CORS_TOKEN_LENGTH,
} from "#veryfront/utils/cors-policy-limits.ts";

const integrationNames = new Set<string>(ALL_INTEGRATION_NAMES);

function isSafeRenderRedisKeyPrefix(prefix: string): boolean {
  try {
    validateLegacyRenderRedisCacheKeyPrefix(prefix);
    return true;
  } catch {
    return false;
  }
}

// Sub-schemas
type CorsOriginValidator = (
  origin: string,
) => boolean | string;

const getCorsOriginSchema = defineSchema((v) =>
  v.union([
    v
      .string()
      .min(1)
      .max(MAX_CORS_ORIGIN_LENGTH)
      .refine(isBoundedCorsOrigin, "Expected a bounded CORS origin without control characters"),
    v
      .array(
        v
          .string()
          .min(1)
          .max(MAX_CORS_ORIGIN_LENGTH)
          .refine(isBoundedCorsOrigin, "Expected a CORS origin without control characters"),
      )
      .min(1)
      .max(MAX_CORS_ORIGIN_COUNT)
      .refine(isBoundedCorsOriginList, "CORS origin list exceeds its aggregate size limit"),
    v.custom<CorsOriginValidator>(
      (value) => typeof value === "function",
      "Expected a CORS origin, origin list, or origin validator",
    ),
  ])
);

const getCorsSchema = defineSchema((v) =>
  v.union([
    v.boolean(),
    v.object({
      origin: getCorsOriginSchema().optional(),
      credentials: v.boolean().optional(),
      methods: v
        .array(
          v.string().max(MAX_CORS_TOKEN_LENGTH).regex(
            HTTP_TOKEN_PATTERN,
            "Expected a valid HTTP method",
          ),
        )
        .min(1)
        .max(MAX_CORS_TOKEN_COUNT)
        .refine(isBoundedCorsTokenList, "CORS methods exceed their aggregate size limit")
        .optional(),
      allowedHeaders: v
        .array(
          v.string().max(MAX_CORS_TOKEN_LENGTH).regex(
            HTTP_TOKEN_PATTERN,
            "Expected a valid HTTP header name",
          ),
        )
        .min(1)
        .max(MAX_CORS_TOKEN_COUNT)
        .refine(isBoundedCorsTokenList, "CORS allowed headers exceed their aggregate size limit")
        .optional(),
      exposedHeaders: v
        .array(
          v.string().max(MAX_CORS_TOKEN_LENGTH).regex(
            HTTP_TOKEN_PATTERN,
            "Expected a valid HTTP header name",
          ),
        )
        .min(1)
        .max(MAX_CORS_TOKEN_COUNT)
        .refine(isBoundedCorsTokenList, "CORS exposed headers exceed their aggregate size limit")
        .optional(),
      maxAge: v.number().int().nonnegative().max(MAX_CORS_MAX_AGE).optional(),
    }).strict().refine(
      (cors) => !(cors.origin === "*" && cors.credentials),
      "Cannot use credentials with wildcard origin (*)",
    ),
  ])
);

const getBasicAuthSchema = defineSchema((v) =>
  v.object({
    username: v.string().min(1),
    password: v.string().min(1),
    realm: v.string().optional(),
  }).strict()
);

const getBearerAuthSchema = defineSchema((v) =>
  v.object({
    token: v.string().min(1),
  }).strict()
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

const getAiDiscoveryContainerSchema = defineSchema((v) =>
  v
    .object({
      discovery: v
        .object({
          enabled: v.boolean().optional(),
          paths: v.array(v.string()).optional(),
        })
        .partial()
        .strict()
        .optional(),
    })
    .partial()
    .strict()
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
        .strict()
        .optional(),
      directories: v
        .object({
          app: v.string().optional(),
          pages: v.string().optional(),
          components: v.array(v.string()).optional(),
          ai: v.string().optional(),
        })
        .partial()
        .strict()
        .optional(),
      experimental: v
        .object({
          esmLayouts: v.boolean().optional(),
          precompileMDX: v.boolean().optional(),
          rsc: v.boolean().optional(),
        })
        .partial()
        .strict()
        .optional(),
      router: v.enum(["app", "pages"]).optional(),
      /** Path to the layout component (e.g., 'components/layout.tsx'), or false to disable */
      layout: v.union([v.string(), v.literal(false)]).optional(),
      /** Path to the app wrapper component (e.g., 'components/app.tsx'), or false to disable */
      app: v.union([v.string(), v.literal(false)]).optional(),
      theme: v
        .object({ colors: v.record(v.string(), v.string()).optional() })
        .partial()
        .strict()
        .optional(),
      build: v
        .object({
          outDir: v.string().optional(),
          trailingSlash: v.boolean().optional(),
          /**
           * Generate static HTML for all routes during `veryfront build`.
           * Defaults to true; disabling it produces no pages, so only turn it
           * off for builds that intentionally skip static generation.
           */
          ssg: v.boolean().optional(),
          esbuild: v
            .object({
              wasmURL: v.string().url().optional(),
              worker: v.boolean().optional(),
            })
            .partial()
            .strict()
            .optional(),
        })
        .partial()
        .strict()
        .optional(),
      cache: v
        .object({
          dir: v.string().optional(),
          bundleManifest: v
            .object({
              type: v.literal("memory").optional(),
              ttl: v.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
              enabled: v.boolean().optional(),
            })
            .partial()
            .strict()
            .optional(),
          render: v
            .object({
              type: v.enum(["memory", "filesystem", "kv", "redis"]).optional(),
              ttl: v.number().positive().max(MAX_CACHE_TTL_MILLISECONDS).optional(),
              maxEntries: v.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
              kvPath: v.string().optional(),
              redisUrl: v.string().optional(),
              /** Redis namespace; an omitted trailing colon is normalized at store construction. */
              redisKeyPrefix: v.string().refine(
                isSafeRenderRedisKeyPrefix,
                "Expected a non-blank, bounded Redis key prefix without control characters",
              ).optional(),
              /**
               * Explicit contract for caching SSR responses that execute
               * request-aware project data hooks. Disabled unless opted in.
               */
              public: v
                .object({
                  enabled: v.boolean().optional(),
                  /** Request headers whose values are part of the public response identity. */
                  varyHeaders: v
                    .array(
                      v.string().regex(
                        HTTP_TOKEN_PATTERN,
                        "Expected a valid HTTP header name",
                      ),
                    )
                    .max(32)
                    .optional(),
                })
                .partial()
                .strict()
                .optional(),
            })
            .partial()
            .strict()
            .refine(
              (config) => {
                const type = config.type ?? "memory";
                if (type === "memory" || type === "filesystem") {
                  return config.kvPath === undefined && config.redisUrl === undefined &&
                    config.redisKeyPrefix === undefined;
                }
                if (type === "kv") {
                  return config.maxEntries === undefined && config.redisUrl === undefined &&
                    config.redisKeyPrefix === undefined;
                }
                return config.maxEntries === undefined && config.kvPath === undefined;
              },
              "Render cache options must belong to the selected backend type",
            )
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
          queryParams: v.union([
            v.object({ policy: v.literal("ignore-all") }).strict(),
            v.object({ policy: v.literal("include-all") }).strict(),
            v.object({
              policy: v.literal("include-list"),
              params: v.array(v.string().min(1).max(256)).min(1).max(128),
            }).strict(),
            v.object({
              policy: v.literal("exclude-list").optional(),
              params: v.array(v.string().min(1).max(256)).max(128).optional(),
            }).strict(),
          ]).optional(),
        })
        .partial()
        .strict()
        .optional(),
      dev: v
        .object({
          port: v.number().int().min(MIN_PORT).max(MAX_PORT).optional(),
          host: v.string().optional(),
          open: v.boolean().optional(),
          hmr: v.boolean().optional(),
          hmrPort: v.number().int().min(MIN_PORT).max(MAX_PORT).optional(),
          components: v.array(v.string()).optional(),
          moduleServerUrl: v.string().optional(),
        })
        .partial()
        .strict()
        .optional(),
      resolve: v
        .object({
          importMap: v
            .object({
              imports: v.record(v.string(), v.string()).optional(),
              scopes: v.record(v.string(), v.record(v.string(), v.string())).optional(),
            })
            .partial()
            .strict()
            .optional(),
        })
        .partial()
        .strict()
        .optional(),
      security: v
        .object({
          auth: v
            .object({
              basic: getBasicAuthSchema().optional(),
              bearer: getBearerAuthSchema().optional(),
            })
            .partial()
            .strict()
            .refine(
              (auth) => !(auth.basic && auth.bearer),
              "Configure either basic or bearer authentication, not both",
            )
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
        .strict()
        .optional(),
      middleware: v
        .object({
          custom: v.array(v.any()).optional(),
        })
        .partial()
        .strict()
        .optional(),
      theming: v
        .object({
          brandName: v.string().optional(),
          logoHtml: v.string().optional(),
        })
        .partial()
        .strict()
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
            .strict()
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
            .strict()
            .optional(),
        })
        .partial()
        .strict()
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
            .strict()
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
            .strict()
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
                .strict()
                .optional(),
            })
            .partial()
            .strict()
            .optional(),
        })
        .partial()
        .strict()
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
            .strict()
            .optional(),
          chunking: v
            .object({
              maxTokens: v.number().int().positive().optional(),
              overlapTokens: v.number().int().min(0).optional(),
              include: v.array(v.string()).optional(),
              exclude: v.array(v.string()).optional(),
            })
            .partial()
            .strict()
            .optional(),
          autoIndex: v.boolean().optional(),
        })
        .partial()
        .strict()
        .optional(),
      fs: v
        .object({
          type: v.enum(["local", "veryfront-api", "memory", "github"]).optional(),
          local: v
            .object({ baseDir: v.string().optional() })
            .partial()
            .strict()
            .optional(),
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
                  ttl: v.number().int().positive().max(MAX_CACHE_TTL_MILLISECONDS).optional(),
                  maxSize: v.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
                  maxMemory: v.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
                })
                .partial()
                .strict()
                .optional(),
              retry: v
                .object({
                  maxRetries: v.number().int().min(0).optional(),
                  initialDelay: v.number().int().positive().optional(),
                  maxDelay: v.number().int().positive().optional(),
                })
                .partial()
                .strict()
                .optional(),
            })
            .partial()
            .strict()
            .optional(),
          memory: v
            .object({
              files: v.record(v.string(), v.union([v.string(), v.instanceof(Uint8Array)]))
                .optional(),
            })
            .partial()
            .strict()
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
                  ttl: v.number().int().positive().max(MAX_CACHE_TTL_MILLISECONDS).optional(),
                  maxSize: v.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
                  maxMemory: v.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
                })
                .partial()
                .strict()
                .optional(),
              retry: v
                .object({
                  maxRetries: v.number().int().min(0).optional(),
                  initialDelay: v.number().int().positive().optional(),
                  maxDelay: v.number().int().positive().optional(),
                })
                .partial()
                .strict()
                .optional(),
            })
            .strict()
            .optional(),
        })
        .partial()
        .strict()
        .refine(
          (config) => {
            const type = config.type ?? "local";
            if (type === "local") {
              return config.veryfront === undefined &&
                config.memory === undefined &&
                config.github === undefined;
            }
            if (type === "veryfront-api") {
              return config.veryfront !== undefined &&
                config.local === undefined &&
                config.memory === undefined &&
                config.github === undefined;
            }
            if (type === "memory") {
              return config.local === undefined &&
                config.veryfront === undefined &&
                config.github === undefined;
            }
            return config.github !== undefined &&
              config.local === undefined &&
              config.veryfront === undefined &&
              config.memory === undefined;
          },
          "Filesystem options must belong to the selected backend type",
        )
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
          tools: getAiDiscoveryContainerSchema().optional(),
          agents: getAiDiscoveryContainerSchema().optional(),
          skills: getAiDiscoveryContainerSchema().optional(),
          resources: getAiDiscoveryContainerSchema().optional(),
          prompts: getAiDiscoveryContainerSchema().optional(),
          workflows: getAiDiscoveryContainerSchema().optional(),
          work: getAiDiscoveryContainerSchema().optional(),
          tasks: getAiDiscoveryContainerSchema().optional(),
          schedules: getAiDiscoveryContainerSchema().optional(),
          webhooks: getAiDiscoveryContainerSchema().optional(),
          evals: getAiDiscoveryContainerSchema().optional(),
          mcp: v
            .object({
              enabled: v.boolean().optional(),
              port: v.number().int().min(MIN_PORT).max(MAX_PORT).optional(),
              expose: v.array(v.string()).optional(),
            })
            .partial()
            .strict()
            .optional(),
        })
        .partial()
        .strict()
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
                  }).strict(),
                ])
                .optional(),
            })
            .partial()
            .strict()
            .optional(),
        })
        .partial()
        .strict()
        .optional(),
      /** CLI generate command preferences */
      generate: v
        .object({
          /** Preferred router for generated pages */
          preferredRouter: v.enum(["app-router", "pages-router"]).optional(),
        })
        .partial()
        .strict()
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
            .strict()
            .optional(),
          /** Custom CSS content to add (for @layer, @apply directives, etc.) */
          customCSS: v.string().optional(),
        })
        .partial()
        .strict()
        .optional(),
      /**
       * Optional source-owned integration restrictions.
       *
       * This allowlist only narrows capabilities selected by the agent and
       * granted by the control plane. It does not enable integrations or
       * configure credential ownership.
       */
      integrations: v
        .object({
          allow: v.record(
            v.string().min(1).refine(
              (name) => integrationNames.has(name),
              { message: "Expected a canonical integration name from the connector catalog" },
            ),
            v
              .object({
                /** Exact connector-local tool IDs; omit to allow all tools. */
                allowedTools: v
                  .array(
                    v.string().regex(
                      /^(?!.*__)[a-z0-9][a-z0-9_-]*$/,
                      "Expected a canonical connector-local tool ID",
                    ),
                  )
                  .optional(),
              })
              .strict(),
          ),
        })
        .strict()
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
            .strict()
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
            .strict()
            .optional(),
        })
        .partial()
        .strict()
        .optional(),
    })
    .partial()
    .strict()
);
export const veryfrontConfigSchema = lazySchema(getVeryfrontConfigSchema);

// Inferred types
type InferredVeryfrontConfig = InferSchema<ReturnType<typeof getVeryfrontConfigSchema>>;
type InferredVeryfrontConfigInput = InferInput<ReturnType<typeof getVeryfrontConfigSchema>>;

/** Validated project configuration with catalog-backed integration authoring. */
export type VeryfrontConfig = Omit<InferredVeryfrontConfig, "integrations"> & {
  integrations?: SourceIntegrationPolicyConfig;
};
/** User-authored configuration accepted before schema transforms run. */
export type VeryfrontConfigInput = Omit<InferredVeryfrontConfigInput, "integrations"> & {
  integrations?: SourceIntegrationPolicyConfig;
};

// Validation function
export function validateVeryfrontConfig(input: unknown): VeryfrontConfig {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const unknown = findUnknownTopLevelKeys(input as Record<string, unknown>);
    if (unknown.length > 0) {
      throw CONFIG_VALIDATION_FAILED.create({
        detail: `Unknown config keys: ${unknown.join(", ")}. Check for typos in veryfront.config.`,
        context: {
          field: unknown.join(", "),
          expected: "known top-level configuration keys",
        },
      });
    }
  }

  const result = veryfrontConfigSchema.safeParse(input);
  if (result.success) return result.data as VeryfrontConfig;

  const issues = result.issues ?? [];
  const first = issues[0];
  const path = first?.path?.length ? first.path.join(".") : "<root>";
  const expected = first?.message ?? String(first);
  const corsHint = path.includes("security.cors")
    ? " Expected boolean or a CORS object with origin, credentials, methods, allowedHeaders, exposedHeaders, or maxAge."
    : "";
  const expectedWithHint = expected + corsHint;

  const context = {
    field: path,
    expected: expectedWithHint,
  };

  throw CONFIG_VALIDATION_FAILED.create({
    detail: `Invalid veryfront.config at ${path}: ${expectedWithHint}.`,
    context,
  });
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
  "integrations",
  "extensions",
  "openapi",
]);

export function findUnknownTopLevelKeys(input: Record<string, unknown>): string[] {
  return Object.keys(input).filter((key) => !knownConfigKeys.has(key));
}
