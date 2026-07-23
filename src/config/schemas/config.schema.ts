import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferInput, InferSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import { CONFIG_VALIDATION_FAILED } from "#veryfront/errors/error-registry.ts";
import { ALL_INTEGRATION_NAMES } from "#veryfront/integrations/schema.ts";
import type { SourceIntegrationPolicyConfig } from "#veryfront/integrations/source-policy.ts";
import type { ExtensionConfigEntry } from "#veryfront/extensions/types.ts";

const integrationNames = new Set<string>(ALL_INTEGRATION_NAMES);
const HTTP_TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const CSP_DIRECTIVE_PATTERN = /^[A-Za-z][A-Za-z0-9-]*$/;

type CorsOriginValidator = (origin: string) => boolean | string;

function isSafeHeaderValue(value: string): boolean {
  if (value.length === 0) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}

function isSafeHttpQuotedString(value: string): boolean {
  return isSafeHeaderValue(value) && !value.includes('"') && !value.includes("\\");
}

function isSafeCspSource(value: string): boolean {
  return isSafeHeaderValue(value) && !value.includes(";");
}

function isHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "";
  } catch {
    return false;
  }
}

function hasInvalidCorsOrigin(input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const security = (input as Record<string, unknown>).security;
  if (!security || typeof security !== "object" || Array.isArray(security)) return false;
  const cors = (security as Record<string, unknown>).cors;
  if (!cors || typeof cors !== "object" || Array.isArray(cors)) return false;
  const origin = (cors as Record<string, unknown>).origin;
  return origin !== undefined && typeof origin !== "string" && typeof origin !== "function" &&
    !Array.isArray(origin);
}

// Sub-schemas
const getHttpTokenSchema = defineSchema((v) =>
  v.string().regex(HTTP_TOKEN_PATTERN, "Expected a valid HTTP token")
);

const getCorsOriginEntrySchema = defineSchema((v) =>
  v.string().min(1).refine(isSafeHeaderValue, "CORS origins must not contain control characters")
);

const getCorsSchema = defineSchema((v) => {
  const corsObject = v
    .object({
      origin: v
        .union([
          getCorsOriginEntrySchema(),
          v.array(getCorsOriginEntrySchema()).min(1),
          v.custom<CorsOriginValidator>(
            (value) => typeof value === "function",
            "Expected a CORS origin validator function",
          ),
        ])
        .optional(),
      credentials: v.boolean().optional(),
      methods: v.array(getHttpTokenSchema()).min(1).optional(),
      allowedHeaders: v.array(getHttpTokenSchema()).min(1).optional(),
      exposedHeaders: v.array(getHttpTokenSchema()).min(1).optional(),
      maxAge: v.number().int().nonnegative().optional(),
    })
    .strict()
    .superRefine((cors, ctx) => {
      if (cors.origin === "*" && cors.credentials === true) {
        ctx.addIssue({
          code: "custom",
          message: "CORS wildcard origin cannot be combined with credentials",
          path: ["origin"],
        });
      }
    });

  return v.union([v.boolean(), corsObject]);
});

const getBasicAuthSchema = defineSchema((v) =>
  v.object({
    username: v.string().min(1),
    password: v.string().min(1),
    realm: v.string().min(1).refine(
      isSafeHttpQuotedString,
      "Basic authentication realm must be a safe HTTP quoted string",
    ).optional(),
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
              ttl: v.number().int().positive().optional(),
              maxEntries: v.number().int().positive().optional(),
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
          port: v.number().int().min(1).max(65_535).optional(),
          host: v.string().optional(),
          open: v.boolean().optional(),
          hmr: v.boolean().optional(),
          hmrPort: v.number().int().min(1).max(65_535).optional(),
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
          csp: v
            .record(
              v.string().regex(CSP_DIRECTIVE_PATTERN, "Expected a valid CSP directive name"),
              v.union([
                v.string().min(1).refine(
                  isSafeCspSource,
                  "CSP sources must not contain control characters or semicolons",
                ),
                v.array(
                  v.string().min(1).refine(
                    isSafeCspSource,
                    "CSP sources must not contain control characters or semicolons",
                  ),
                ),
              ]),
            )
            .optional(),
          remoteHosts: v
            .array(
              v.string().url().refine(isHttpOrigin, "Expected an HTTP or HTTPS origin"),
            )
            .optional(),
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
              cookieName: getHttpTokenSchema().optional(),
              headerName: getHttpTokenSchema().optional(),
              excludePaths: v
                .array(
                  v.string().refine(
                    (path) => path.startsWith("/"),
                    "CSRF excluded paths must start with a slash",
                  ),
                )
                .optional(),
              ttlSec: v.number().int().positive().optional(),
            }).strict(),
          ]).optional(),
          coop: v.enum(["same-origin", "same-origin-allow-popups", "unsafe-none"]).optional(),
          corp: v.enum(["same-origin", "same-site", "cross-origin"]).optional(),
          coep: v.enum(["require-corp", "unsafe-none"]).optional(),
          hsts: v
            .object({
              maxAge: v.number().int().nonnegative(),
              includeSubDomains: v.boolean().optional(),
              preload: v.boolean().optional(),
            })
            .strict()
            .optional(),
          headers: v.record(
            getHttpTokenSchema(),
            v.string().min(1).refine(
              isSafeHeaderValue,
              "HTTP header values must not contain control characters",
            ),
          ).optional(),
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
                  initialDelay: v.number().int().min(0).optional(),
                  maxDelay: v.number().int().min(0).optional(),
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
              token: v.string().min(1).max(4_096).optional(),
              /** Repository owner (user or organization) */
              owner: v.string().min(1).max(1_024).optional(),
              /** Repository name */
              repo: v.string().min(1).max(1_024).optional(),
              /** Branch, tag, or commit SHA (default: "main") */
              ref: v.string().min(1).max(1_024).optional(),
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
                  initialDelay: v.number().int().min(0).optional(),
                  maxDelay: v.number().int().min(0).optional(),
                  requestTimeout: v.number().int().positive().optional(),
                  totalTimeout: v.number().int().positive().optional(),
                  maxResponseBytes: v.number().int().positive().optional(),
                })
                .partial()
                .optional(),
            })
            .optional(),
        })
        .partial()
        .superRefine((fs, ctx) => {
          if (fs.type === "github" && !fs.github) {
            ctx.addIssue({
              code: "custom",
              message: "GitHub configuration is required when fs.type is github",
              path: ["github"],
            });
          }
        })
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
              port: v.number().int().min(1).max(65_535).optional(),
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
       * tightened at the `veryfront/extensions` barrel. Keep this as
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
type InferredVeryfrontConfig = InferSchema<ReturnType<typeof getVeryfrontConfigSchema>>;
type InferredVeryfrontConfigInput = InferInput<ReturnType<typeof getVeryfrontConfigSchema>>;

/** Runtime schema for Veryfront project configuration. */
export const veryfrontConfigSchema: Schema<InferredVeryfrontConfig> = lazySchema(
  getVeryfrontConfigSchema,
);

/** Validated project configuration with catalog-backed integration authoring. */
export type VeryfrontConfig =
  & Omit<
    InferredVeryfrontConfig,
    "extensions" | "integrations"
  >
  & {
    extensions?: ExtensionConfigEntry[];
    integrations?: SourceIntegrationPolicyConfig;
  };
/** User-authored configuration accepted before schema transforms run. */
export type VeryfrontConfigInput =
  & Omit<
    InferredVeryfrontConfigInput,
    "extensions" | "integrations"
  >
  & {
    extensions?: ExtensionConfigEntry[];
    integrations?: SourceIntegrationPolicyConfig;
  };

/** Validate and normalize a user-authored project configuration. */
export function validateVeryfrontConfig(input: unknown): VeryfrontConfig {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const unknownKeys = findUnknownTopLevelKeys(input as Record<string, unknown>);
    if (unknownKeys.length > 0) {
      const displayedKeys = unknownKeys.slice(0, 10).map((key) => {
        const boundedKey = key.length > 128 ? `${key.slice(0, 125)}...` : key;
        return /^[A-Za-z_$][A-Za-z0-9_$.-]*$/.test(boundedKey)
          ? boundedKey
          : JSON.stringify(boundedKey);
      });
      const omittedCount = unknownKeys.length - displayedKeys.length;
      const suffix = omittedCount > 0 ? ` and ${omittedCount} more` : "";
      throw CONFIG_VALIDATION_FAILED.create({
        message: `Invalid veryfront.config: Unknown config keys: ${
          displayedKeys.join(", ")
        }${suffix}.`,
        context: {
          field: "<root>",
          expected: "Only documented top-level configuration fields are allowed.",
        },
      });
    }
  }

  const result = veryfrontConfigSchema.safeParse(input);
  if (result.success) return result.data as VeryfrontConfig;

  const issues = result.issues ?? [];
  const first = issues[0];
  const issuePath = first?.path?.length ? first.path.join(".") : "<root>";
  const invalidCorsOrigin = issuePath === "security.cors" && hasInvalidCorsOrigin(input);
  const path = invalidCorsOrigin ? "security.cors.origin" : issuePath;
  const expected = first?.message ?? String(first);
  const corsHint = !invalidCorsOrigin && path.includes("security.cors")
    ? " Expected a boolean or a CORS policy object."
    : "";
  const expectedWithHint = invalidCorsOrigin
    ? "security.cors.origin must be a string, string array, or validator function."
    : expected + corsHint;

  const context = {
    field: path,
    expected: expectedWithHint,
  };

  throw CONFIG_VALIDATION_FAILED.create({
    message: invalidCorsOrigin
      ? `Invalid veryfront.config: ${expectedWithHint}`
      : `Invalid veryfront.config at ${path}: ${expectedWithHint}${
        /[.!?]$/.test(expectedWithHint) ? "" : "."
      }`,
    context,
  });
}

/** Known top-level keys, checked by TypeScript against the inferred schema. */
const knownConfigKeys = {
  projectSlug: true,
  title: true,
  description: true,
  react: true,
  directories: true,
  experimental: true,
  router: true,
  layout: true,
  app: true,
  theme: true,
  build: true,
  cache: true,
  dev: true,
  resolve: true,
  security: true,
  middleware: true,
  theming: true,
  assetPipeline: true,
  observability: true,
  search: true,
  fs: true,
  ai: true,
  client: true,
  generate: true,
  tailwind: true,
  integrations: true,
  extensions: true,
  openapi: true,
} as const satisfies Readonly<Record<keyof InferredVeryfrontConfig, true>>;

/** Return unsupported top-level keys from a project configuration object. */
export function findUnknownTopLevelKeys(input: Record<string, unknown>): string[] {
  return Object.keys(input).filter((key) => !Object.hasOwn(knownConfigKeys, key));
}
