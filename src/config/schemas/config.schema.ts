import { z } from "zod";
import { type ConfigContext, createError, toError } from "#veryfront/errors/veryfront-error.ts";

// Sub-schemas
const corsSchema = z.union([z.boolean(), z.object({ origin: z.string().optional() }).strict()]);

const basicAuthSchema = z.object({
  username: z.string(),
  password: z.string(),
  realm: z.string().optional(),
});

const bearerAuthSchema = z.object({
  token: z.string(),
});

const embeddingDimensionSchema = z.union([
  z.literal(768),
  z.literal(1024),
  z.literal(1536),
  z.literal(3072),
  z.literal(4096),
]);

// Main config schema
export const veryfrontConfigSchema = z
  .object({
    projectSlug: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    react: z
      .object({
        /** React version to use (e.g., "18.3.1", "19.1.1"). Defaults to auto-detect from package.json or 19.1.1 */
        version: z.string().optional(),
      })
      .partial()
      .optional(),
    directories: z
      .object({
        app: z.string().optional(),
        pages: z.string().optional(),
        components: z.array(z.string()).optional(),
        ai: z.string().optional(),
      })
      .partial()
      .optional(),
    experimental: z
      .object({
        esmLayouts: z.boolean().optional(),
        precompileMDX: z.boolean().optional(),
        rsc: z.boolean().optional(),
      })
      .partial()
      .optional(),
    router: z.enum(["app", "pages"]).optional(),
    /** Path to the layout component (e.g., 'components/layout.tsx'), or false to disable */
    layout: z.union([z.string(), z.literal(false)]).optional(),
    /** Path to the app wrapper component (e.g., 'components/app.tsx'), or false to disable */
    app: z.union([z.string(), z.literal(false)]).optional(),
    theme: z.object({ colors: z.record(z.string()).optional() }).partial().optional(),
    build: z
      .object({
        outDir: z.string().optional(),
        trailingSlash: z.boolean().optional(),
        esbuild: z
          .object({
            wasmURL: z.string().url().optional(),
            worker: z.boolean().optional(),
          })
          .partial()
          .optional(),
      })
      .partial()
      .optional(),
    cache: z
      .object({
        dir: z.string().optional(),
        bundleManifest: z
          .object({
            type: z.enum(["redis", "kv", "memory"]).optional(),
            redisUrl: z.string().optional(),
            keyPrefix: z.string().optional(),
            ttl: z.number().int().positive().optional(),
            enabled: z.boolean().optional(),
          })
          .partial()
          .optional(),
        render: z
          .object({
            type: z.enum(["memory", "filesystem", "kv", "redis"]).optional(),
            ttl: z.number().optional(),
            maxEntries: z.number().optional(),
            kvPath: z.string().optional(),
            redisUrl: z.string().optional(),
            redisKeyPrefix: z.string().optional(),
          })
          .partial()
          .optional(),
        /**
         * Query parameter handling for page cache keys.
         * Controls which URL query params affect cache key generation.
         *
         * Policies:
         * - "ignore-all": Ignore all query params (pages with ?utm_campaign=x share cache with /)
         * - "include-all": Include all query params (default, each unique query = separate cache)
         * - "include-list": Only include specified params in cache key
         * - "exclude-list": Exclude specified params (+ common tracking params like utm_*)
         *
         * @example
         * // Ignore all marketing/tracking params (recommended for most sites)
         * cache: { queryParams: { policy: "exclude-list" } }
         *
         * @example
         * // Only vary cache by specific params
         * cache: { queryParams: { policy: "include-list", params: ["page", "sort"] } }
         */
        queryParams: z
          .object({
            policy: z.enum(["ignore-all", "include-all", "include-list", "exclude-list"])
              .optional(),
            params: z.array(z.string()).optional(),
          })
          .partial()
          .optional(),
      })
      .partial()
      .optional(),
    dev: z
      .object({
        port: z.number().int().positive().optional(),
        host: z.string().optional(),
        open: z.boolean().optional(),
        hmr: z.boolean().optional(),
        hmrPort: z.number().optional(),
        components: z.array(z.string()).optional(),
        moduleServerUrl: z.string().optional(),
      })
      .partial()
      .optional(),
    resolve: z
      .object({
        importMap: z
          .object({
            imports: z.record(z.string()).optional(),
            scopes: z.record(z.record(z.string())).optional(),
          })
          .partial()
          .optional(),
      })
      .partial()
      .optional(),
    security: z
      .object({
        auth: z
          .object({
            basic: basicAuthSchema.optional(),
            bearer: bearerAuthSchema.optional(),
          })
          .partial()
          .optional(),
        csp: z.record(z.array(z.string())).optional(),
        remoteHosts: z.array(z.string().url()).optional(),
        cors: corsSchema.optional(),
        /**
         * CSRF protection using the double-submit cookie pattern.
         * Set `true` for defaults, or pass an object to customize.
         *
         * When enabled, POST/PUT/PATCH/DELETE requests must include
         * an `x-csrf-token` header matching the `vf_csrf` cookie.
         * The cookie is set automatically on HTML document responses.
         *
         * Server Actions (`/_veryfront/rsc/action`) are CSRF-protected;
         * client code must forward the cookie value as the header.
         */
        csrf: z.union([
          z.boolean(),
          z.object({
            cookieName: z.string().optional(),
            headerName: z.string().optional(),
            excludePaths: z.array(z.string()).optional(),
            ttlSec: z.number().int().positive().optional(),
          }).strict(),
        ]).optional(),
        coop: z.enum(["same-origin", "same-origin-allow-popups", "unsafe-none"]).optional(),
        corp: z.enum(["same-origin", "same-site", "cross-origin"]).optional(),
        coep: z.enum(["require-corp", "unsafe-none"]).optional(),
        /**
         * Restrict module imports to specific directories (opt-in security).
         * When not set, users can import from any directory in the project.
         * When set, only imports from these directories are allowed.
         * @example ["app", "pages", "components", "lib", "src", "utils"]
         */
        allowedImportDirs: z.array(z.string()).optional(),
      })
      .partial()
      .optional(),
    middleware: z
      .object({
        custom: z.array(z.any()).optional(),
      })
      .partial()
      .optional(),
    theming: z
      .object({
        brandName: z.string().optional(),
        logoHtml: z.string().optional(),
      })
      .partial()
      .optional(),
    assetPipeline: z
      .object({
        images: z
          .object({
            enabled: z.boolean().optional(),
            formats: z.array(z.enum(["webp", "avif", "jpeg", "png"])).optional(),
            sizes: z.array(z.number().int().positive()).optional(),
            quality: z.number().int().min(1).max(100).optional(),
            inputDir: z.string().optional(),
            outputDir: z.string().optional(),
            preserveOriginal: z.boolean().optional(),
          })
          .partial()
          .optional(),
        css: z
          .object({
            enabled: z.boolean().optional(),
            minify: z.boolean().optional(),
            autoprefixer: z.boolean().optional(),
            purge: z.boolean().optional(),
            criticalCSS: z.boolean().optional(),
            inputDir: z.string().optional(),
            outputDir: z.string().optional(),
            browsers: z.array(z.string()).optional(),
            purgeContent: z.array(z.string()).optional(),
            sourceMap: z.boolean().optional(),
          })
          .partial()
          .optional(),
      })
      .partial()
      .optional(),
    observability: z
      .object({
        tracing: z
          .object({
            enabled: z.boolean().optional(),
            exporter: z.enum(["jaeger", "zipkin", "otlp", "console"]).optional(),
            endpoint: z.string().optional(),
            serviceName: z.string().optional(),
            sampleRate: z.number().min(0).max(1).optional(),
          })
          .partial()
          .optional(),
        metrics: z
          .object({
            enabled: z.boolean().optional(),
            exporter: z.enum(["prometheus", "otlp", "console"]).optional(),
            endpoint: z.string().optional(),
            prefix: z.string().optional(),
            collectInterval: z.number().int().positive().optional(),
          })
          .partial()
          .optional(),
      })
      .partial()
      .optional(),
    search: z
      .object({
        enabled: z.boolean().optional(),
        embedding: z
          .object({
            provider: z.enum(["openai", "cohere", "voyageai", "custom"]).optional(),
            model: z.string().optional(),
            dimension: embeddingDimensionSchema.optional(),
            apiKey: z.string().optional(),
            batchSize: z.number().int().positive().optional(),
          })
          .partial()
          .optional(),
        chunking: z
          .object({
            maxTokens: z.number().int().positive().optional(),
            overlapTokens: z.number().int().min(0).optional(),
            include: z.array(z.string()).optional(),
            exclude: z.array(z.string()).optional(),
          })
          .partial()
          .optional(),
        autoIndex: z.boolean().optional(),
      })
      .partial()
      .optional(),
    fs: z
      .object({
        type: z.enum(["local", "veryfront-api", "memory", "github"]).optional(),
        local: z.object({ baseDir: z.string().optional() }).partial().optional(),
        veryfront: z
          .object({
            apiBaseUrl: z.string().url(),
            /** API token - optional in proxy mode (token provided per-request via headers) */
            apiToken: z.string().optional(),
            /** Project slug - optional in proxy mode (slug provided per-request via headers) */
            projectSlug: z.string().optional(),
            /** Enable proxy mode for multi-project handling (tokens/slugs from headers) */
            proxyMode: z.boolean().optional(),
            /** Production mode - fetch from releases instead of draft files */
            productionMode: z.boolean().optional(),
            cache: z
              .object({
                enabled: z.boolean().optional(),
                ttl: z.number().int().positive().optional(),
                maxSize: z.number().int().positive().optional(),
              })
              .partial()
              .optional(),
            retry: z
              .object({
                maxRetries: z.number().int().min(0).optional(),
                initialDelay: z.number().int().positive().optional(),
                maxDelay: z.number().int().positive().optional(),
              })
              .partial()
              .optional(),
          })
          .partial()
          .optional(),
        memory: z
          .object({
            files: z.record(z.union([z.string(), z.instanceof(Uint8Array)])).optional(),
          })
          .partial()
          .optional(),
        github: z
          .object({
            /** GitHub Personal Access Token */
            token: z.string(),
            /** Repository owner (user or organization) */
            owner: z.string(),
            /** Repository name */
            repo: z.string(),
            /** Branch, tag, or commit SHA (default: "main") */
            ref: z.string().optional(),
            cache: z
              .object({
                enabled: z.boolean().optional(),
                ttl: z.number().int().positive().optional(),
                maxSize: z.number().int().positive().optional(),
                maxMemory: z.number().int().positive().optional(),
              })
              .partial()
              .optional(),
            retry: z
              .object({
                maxRetries: z.number().int().min(0).optional(),
                initialDelay: z.number().int().positive().optional(),
                maxDelay: z.number().int().positive().optional(),
              })
              .partial()
              .optional(),
          })
          .optional(),
      })
      .partial()
      .optional(),
    ai: z
      .object({
        enabled: z.boolean().optional(),
        providers: z.record(
          z.object({
            apiKey: z.string().optional(),
            baseURL: z.string().optional(),
            defaultModel: z.string().optional(),
            organization: z.string().optional(),
          }).passthrough(),
        ).optional(),
        tools: z
          .object({
            discovery: z
              .object({
                enabled: z.boolean().optional(),
                paths: z.array(z.string()).optional(),
              })
              .partial()
              .optional(),
          })
          .partial()
          .optional(),
        agents: z
          .object({
            discovery: z
              .object({
                enabled: z.boolean().optional(),
                paths: z.array(z.string()).optional(),
              })
              .partial()
              .optional(),
          })
          .partial()
          .optional(),
        skills: z
          .object({
            discovery: z
              .object({
                enabled: z.boolean().optional(),
                paths: z.array(z.string()).optional(),
              })
              .partial()
              .optional(),
          })
          .partial()
          .optional(),
        mcp: z
          .object({
            enabled: z.boolean().optional(),
            port: z.number().optional(),
            expose: z.array(z.string()).optional(),
          })
          .partial()
          .optional(),
      })
      .partial()
      .optional(),
    client: z
      .object({
        /** How to resolve veryfront client modules in browser */
        moduleResolution: z.enum(["cdn", "self-hosted", "bundled"]).optional(),
        /** CDN options when moduleResolution is 'cdn' */
        cdn: z
          .object({
            provider: z.enum(["esm.sh", "unpkg", "jsdelivr"]).optional(),
            /** 'auto' detects from package.json, or pin specific versions */
            versions: z
              .union([
                z.literal("auto"),
                z.object({
                  react: z.string().optional(),
                  veryfront: z.string().optional(),
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
    generate: z
      .object({
        /** Preferred router for generated pages */
        preferredRouter: z.enum(["app-router", "pages-router"]).optional(),
      })
      .partial()
      .optional(),
    tailwind: z
      .object({
        /** Path to the global stylesheet (default: "globals.css") */
        stylesheet: z.string().optional(),
        /** Enable built-in Tailwind CDN plugins (forms, typography, aspect-ratio, container-queries) */
        plugins: z.array(z.enum(["forms", "typography", "aspect-ratio", "container-queries"]))
          .optional(),
        /** Extend the Tailwind theme (merged with veryfront defaults) */
        theme: z
          .object({
            extend: z.record(z.unknown()).optional(),
          })
          .partial()
          .optional(),
        /** Custom CSS content to add (for @layer, @apply directives, etc.) */
        customCSS: z.string().optional(),
      })
      .partial()
      .optional(),
    /** Third-party integration configuration (e.g., Slack, GitHub) */
    integrations: z
      .record(
        z.string(),
        z
          .object({
            /** Enable per-user tokens (pass endUserId). Default: project-level token. */
            perUser: z.boolean().optional(),
            /** Allowlist of tool IDs to expose. When set, only these tools are registered.
             * This keeps the MCP context narrow by excluding unused tools.
             * @example ["list-issues", "create-issue"] */
            tools: z.array(z.string()).optional(),
          })
          .partial()
          .optional(),
      )
      .optional(),
    /** OpenAPI documentation configuration */
    openapi: z
      .object({
        /** Enable OpenAPI endpoint (default: true) */
        enabled: z.boolean().optional(),
        /** Enable interactive docs page using Scalar (default: true) */
        docs: z.boolean().optional(),
        /** API title for OpenAPI info section */
        title: z.string().optional(),
        /** API version (default: "1.0.0") */
        version: z.string().optional(),
        /** API description */
        description: z.string().optional(),
        /** Custom path configuration */
        paths: z
          .object({
            /** Path for JSON spec (default: "/_openapi.json") */
            json: z.string().optional(),
            /** Path for YAML spec (default: "/_openapi.yaml") */
            yaml: z.string().optional(),
            /** Path for interactive docs (default: "/_docs") */
            docs: z.string().optional(),
          })
          .partial()
          .optional(),
        /** MCP integration configuration */
        mcp: z
          .object({
            /** Expose OpenAPI spec as MCP resource at openapi://spec (default: true) */
            resource: z.boolean().optional(),
            /** Auto-generate MCP tools from API routes (default: true) */
            tools: z.boolean().optional(),
            /** Tool naming prefix (default: "api") - tools named as prefix:operationId */
            toolPrefix: z.string().optional(),
          })
          .partial()
          .optional(),
      })
      .partial()
      .optional(),
  })
  .partial();

// Inferred types
export type VeryfrontConfig = z.infer<typeof veryfrontConfigSchema>;
export type VeryfrontConfigInput = z.input<typeof veryfrontConfigSchema>;

// Validation function
export function validateVeryfrontConfig(input: unknown): VeryfrontConfig {
  const parsed = veryfrontConfigSchema.safeParse(input);
  if (parsed.success) return parsed.data;

  const first = parsed.error.issues[0];
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
 * Get known top-level keys from the schema definition.
 * Uses the schema's shape to avoid duplicating the list of keys.
 */
const knownConfigKeys = new Set(Object.keys(veryfrontConfigSchema.shape));

export function findUnknownTopLevelKeys(input: Record<string, unknown>): string[] {
  return Object.keys(input).filter((key) => !knownConfigKeys.has(key));
}
