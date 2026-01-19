import { z } from "zod";
import type { VeryfrontConfig } from "./types.ts";
import { type ConfigContext, createError, toError } from "../errors/veryfront-error.ts";

const corsSchema = z.union([z.boolean(), z.object({ origin: z.string().optional() }).strict()]);
const basicAuthSchema = z.object({
  username: z.string(),
  password: z.string(),
  realm: z.string().optional(),
});
const bearerAuthSchema = z.object({
  token: z.string(),
});

export const veryfrontConfigSchema = z
  .object({
    projectSlug: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    experimental: z.object({
      esmLayouts: z.boolean().optional(),
      precompileMDX: z.boolean().optional(),
      rsc: z.boolean().optional(),
    }).partial().optional(),
    router: z.enum(["app", "pages"]).optional(),
    defaultLayout: z.string().optional(),
    layout: z.string().optional(),
    provider: z.string().optional(),
    app: z.string().optional(),
    theme: z
      .object({ colors: z.record(z.string()).optional() })
      .partial()
      .optional(),
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
      })
      .partial()
      .optional(),
    dev: z
      .object({
        port: z.number().int().positive().optional(),
        host: z.string().optional(),
        open: z.boolean().optional(),
        hmr: z.boolean().optional(),
        components: z.array(z.string()).optional(),
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
        coop: z.enum(["same-origin", "same-origin-allow-popups", "unsafe-none"]).optional(),
        corp: z.enum(["same-origin", "same-site", "cross-origin"]).optional(),
        coep: z.enum(["require-corp", "unsafe-none"]).optional(),
      })
      .partial()
      .optional(),
    middleware: z
      .object({
        custom: z.array(z.function()).optional(),
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
    fs: z
      .object({
        type: z.enum(["local", "veryfront-api", "memory", "github"]).optional(),
        local: z
          .object({
            baseDir: z.string().optional(),
          })
          .partial()
          .optional(),
        veryfront: z
          .object({
            apiBaseUrl: z.string().url(),
            apiToken: z.string(),
            projectSlug: z.string(),
            proxyMode: z.boolean().optional(),
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
            token: z.string(),
            owner: z.string(),
            repo: z.string(),
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
          .partial()
          .optional(),
      })
      .partial()
      .optional(),
    client: z
      .object({
        moduleResolution: z.enum(["cdn", "self-hosted", "bundled"]).optional(),
        cdn: z
          .object({
            provider: z.enum(["esm.sh", "unpkg", "jsdelivr"]).optional(),
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
  })
  .partial();

export type VeryfrontConfigInput = z.input<typeof veryfrontConfigSchema>;

export function validateVeryfrontConfig(input: unknown): VeryfrontConfig {
  const parsed = veryfrontConfigSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path?.length ? first.path.join(".") : "<root>";
    const expected = first?.message || String(first);
    let hint = "";
    if (String(path).includes("security.cors")) {
      hint = " Expected boolean or { origin?: string }.";
    }

    const context: ConfigContext = {
      field: path,
      expected: expected + hint,
      value: input,
    };

    throw toError(
      createError({
        type: "config",
        message: `Invalid veryfront.config at ${path}: ${expected}.${hint}`,
        context,
      }),
    );
  }
  return parsed.data as VeryfrontConfig;
}

/**
 * Get known top-level keys from the schema definition.
 * Uses the schema's shape to avoid duplicating the list of keys.
 */
const knownConfigKeys = new Set(Object.keys(veryfrontConfigSchema.shape));

export function findUnknownTopLevelKeys(input: Record<string, unknown>): string[] {
  return Object.keys(input).filter((k) => !knownConfigKeys.has(k));
}
