import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import { isAbsolute } from "#veryfront/compat/path/index.ts";
import type { InferInput, InferSchema } from "#veryfront/extensions/schema/index.ts";
import { CONFIG_VALIDATION_FAILED } from "#veryfront/errors/error-registry.ts";
import {
  MAX_REMOTE_INTEGRATION_TOOL_NAME_LENGTH,
  MAX_SOURCE_INTEGRATION_POLICY_INTEGRATIONS,
  MAX_SOURCE_INTEGRATION_POLICY_SEGMENT_LENGTH,
  MAX_SOURCE_INTEGRATION_POLICY_TOOL_IDS,
} from "#veryfront/integrations/limits.ts";
import { ALL_INTEGRATION_NAMES } from "#veryfront/integrations/schema.ts";
import { SESSION_COOKIE_NAME } from "#veryfront/security/application-auth/cookies.ts";
import {
  EXAMPLE_CSP_DIRECTIVES,
  isCspDirectiveName,
} from "#veryfront/security/http/csp-directives.ts";
import {
  DEFAULT_CSRF_COOKIE_NAME,
  isReservedCsrfCookieName,
} from "#veryfront/security/csrf/names.ts";
import type {
  SourceIntegrationPolicyConfig,
  SourceIntegrationRestriction,
} from "#veryfront/integrations/source-policy.ts";
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
import {
  MAX_REMOTE_HOST_COUNT,
  MAX_REMOTE_HOST_URL_LENGTH,
} from "#veryfront/utils/remote-host-policy-limits.ts";
import {
  isValidRedirectOriginList,
  MAX_REDIRECT_ORIGIN_COUNT,
  MAX_REDIRECT_ORIGIN_LENGTH,
} from "#veryfront/utils/redirect-policy.ts";
import {
  MAX_FILE_LOG_FILES,
  MAX_GITHUB_FILESYSTEM_ATTEMPTS,
  MAX_VERYFRONT_FILESYSTEM_RETRIES,
} from "#veryfront/utils/config-resource-limits.ts";
import {
  MAX_CSRF_NAME_LENGTH,
  MAX_CSRF_TTL_SECONDS,
  MAX_PATH_LENGTH,
} from "#veryfront/utils/constants/security.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import { CSS_OPTIMIZATION, IMAGE_OPTIMIZATION } from "#veryfront/utils/constants/build.ts";
import {
  isProjectRelativeDiscoveryPath,
  MAX_PROJECT_DISCOVERY_DIRECTORIES,
} from "#veryfront/utils/discovery-path-policy.ts";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import { isCanonicalProjectRelativePath } from "#veryfront/utils/project-relative-path.ts";
import {
  hasUniqueServerExternalPackages,
  isValidServerExternalPackageName,
  MAX_SERVER_EXTERNAL_PACKAGE_COUNT,
  MAX_SERVER_EXTERNAL_PACKAGE_NAME_LENGTH,
} from "#veryfront/config/server-external-packages.ts";
import { isValidOAuthEnvironmentVariableName } from "#veryfront/oauth/config-validation.ts";
import { MAX_OAUTH_URL_LENGTH } from "#veryfront/oauth/limits.ts";
import {
  isForbiddenApplicationIdentityHeaderName,
  MAX_APPLICATION_AUTH_SCOPE_COUNT,
  MAX_APPLICATION_AUTH_SCOPE_LENGTH,
  MAX_APPLICATION_IDENTITY_HEADER_NAME_LENGTH,
} from "#veryfront/security/application-auth/policy.ts";
import { canonicalizePeerAddress } from "#veryfront/security/application-auth/trusted-proxy.ts";

const integrationNames = new Set<string>(ALL_INTEGRATION_NAMES);
const MAX_CSRF_EXCLUDE_PATH_COUNT = 64;
const MAX_CSRF_EXCLUDE_PATH_LIST_LENGTH = 16_384;
const CSRF_EXCLUDE_PATH_BASE_URL = "https://csrf-policy.invalid";
const MAX_AUTH_CLAIM_NAME_LENGTH = 128;
const MAX_AUTH_COOKIE_NAME_LENGTH = 128;
const MAX_AUTH_LIFETIME_SECONDS = 60 * 60 * 24 * 30;
const MAX_TRUSTED_PROXY_PEERS = 32;
const MAX_AUTH_MODE_COUNT = 4;
const OIDC_SCOPE_PATTERN = /^[\x21\x23-\x5B\x5D-\x7E]+$/;
const NON_CONTROL_CLAIM_WHITESPACE_PATTERN =
  /[ \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]/u;
const ObjectEntries = Object.entries;
const OIDC_SIGNING_ALGORITHMS = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
] as const;

function isBoundedSourceIntegrationAllowlist(
  allow: Readonly<Record<string, SourceIntegrationRestriction>>,
): boolean {
  const entries = ObjectEntries(allow);
  if (entries.length > MAX_SOURCE_INTEGRATION_POLICY_INTEGRATIONS) return false;

  let totalToolIds = 0;
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    const entry = entries[entryIndex]!;
    const integration = entry[0];
    const restriction = entry[1];
    const allowedTools = restriction.allowedTools;
    if (!allowedTools) continue;
    if (allowedTools.length > MAX_SOURCE_INTEGRATION_POLICY_TOOL_IDS) return false;
    for (let toolIndex = 0; toolIndex < allowedTools.length; toolIndex++) {
      const toolId = allowedTools[toolIndex]!;
      if (
        ++totalToolIds > MAX_SOURCE_INTEGRATION_POLICY_TOOL_IDS ||
        integration.length + 2 + toolId.length > MAX_REMOTE_INTEGRATION_TOOL_NAME_LENGTH
      ) {
        return false;
      }
    }
  }
  return true;
}

function isCanonicalCsrfExcludePath(path: string): boolean {
  if (
    path.length === 0 ||
    path.length > MAX_PATH_LENGTH ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    (path.length > 1 && path.endsWith("/"))
  ) {
    return false;
  }

  try {
    const parsed = new URL(path, CSRF_EXCLUDE_PATH_BASE_URL);
    return parsed.origin === CSRF_EXCLUDE_PATH_BASE_URL &&
      parsed.pathname === path &&
      parsed.search === "" &&
      parsed.hash === "";
  } catch {
    return false;
  }
}

function isBoundedCsrfExcludePathList(paths: readonly string[]): boolean {
  let serializedLength = 0;
  for (const path of paths) {
    serializedLength += path.length;
    if (serializedLength > MAX_CSRF_EXCLUDE_PATH_LIST_LENGTH) return false;
  }
  return true;
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

const getCsrfSchema = defineSchema((v) =>
  v.union([
    v.boolean(),
    v.object({
      cookieName: v
        .string()
        .min(1)
        .max(MAX_CSRF_NAME_LENGTH)
        .regex(HTTP_TOKEN_PATTERN, "Expected a valid cookie name")
        .refine(
          (name) => !isReservedCsrfCookieName(name),
          "Expected a cookie name outside Veryfront's reserved CSRF namespaces",
        )
        .optional(),
      headerName: v
        .string()
        .min(1)
        .max(MAX_CSRF_NAME_LENGTH)
        .regex(HTTP_TOKEN_PATTERN, "Expected a valid HTTP header name")
        .optional(),
      excludePaths: v
        .array(
          v
            .string()
            .min(1)
            .max(MAX_PATH_LENGTH)
            .refine(
              isCanonicalCsrfExcludePath,
              "Expected a canonical absolute URL path without a query, fragment, or trailing slash",
            ),
        )
        .max(MAX_CSRF_EXCLUDE_PATH_COUNT)
        .refine(
          isBoundedCsrfExcludePathList,
          "CSRF exclusion paths exceed their aggregate size limit",
        )
        .optional(),
      ttlSec: v.number().int().positive().max(MAX_CSRF_TTL_SECONDS).optional(),
    }).strict(),
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

function hasRequiredOpenidScope(scopes: readonly string[]): boolean {
  return scopes.includes("openid");
}

function hasUniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function isSafeOidcScope(value: string): boolean {
  return OIDC_SCOPE_PATTERN.test(value);
}

function isSecureOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      value === url.origin;
  } catch {
    return false;
  }
}

function isValidClaimName(value: string): boolean {
  return value.length > 0 &&
    value.length <= MAX_AUTH_CLAIM_NAME_LENGTH &&
    value.trim() === value &&
    !hasControlCodeUnit(value) &&
    !NON_CONTROL_CLAIM_WHITESPACE_PATTERN.test(value);
}

function hasControlCodeUnit(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1F || codeUnit === 0x7F) return true;
  }
  return false;
}

function isValidAuthCookieName(value: string): boolean {
  return value.length > 0 &&
    value.length <= MAX_AUTH_COOKIE_NAME_LENGTH &&
    value.startsWith("__Host-") &&
    HTTP_TOKEN_PATTERN.test(value);
}

function isTrustedProxyPeerAddress(value: string): boolean {
  return canonicalizePeerAddress(value) !== null;
}

function hasUniqueTrustedProxyPeerAddresses(values: readonly string[]): boolean {
  const canonical = values.map(canonicalizePeerAddress);
  return canonical.every((value): value is string => value !== null) &&
    new Set(canonical).size === canonical.length;
}

const getOidcClaimMappingSchema = defineSchema((v) =>
  v.object({
    email: v
      .string()
      .max(MAX_AUTH_CLAIM_NAME_LENGTH)
      .refine(isValidClaimName, "Expected a bounded claim name")
      .optional(),
    name: v
      .string()
      .max(MAX_AUTH_CLAIM_NAME_LENGTH)
      .refine(isValidClaimName, "Expected a bounded claim name")
      .optional(),
    groups: v
      .string()
      .max(MAX_AUTH_CLAIM_NAME_LENGTH)
      .refine(isValidClaimName, "Expected a bounded claim name")
      .optional(),
    roles: v
      .string()
      .max(MAX_AUTH_CLAIM_NAME_LENGTH)
      .refine(isValidClaimName, "Expected a bounded claim name")
      .optional(),
  }).partial().strict()
);

const getOidcAuthSchema = defineSchema((v) =>
  v.object({
    issuerEnvVar: v.string().refine(
      isValidOAuthEnvironmentVariableName,
      "Invalid environment variable name",
    ),
    clientIdEnvVar: v.string().refine(
      isValidOAuthEnvironmentVariableName,
      "Invalid environment variable name",
    ),
    clientSecretEnvVar: v.string().refine(
      isValidOAuthEnvironmentVariableName,
      "Invalid environment variable name",
    ),
    sessionSecretEnvVar: v.string().refine(
      isValidOAuthEnvironmentVariableName,
      "Invalid environment variable name",
    ),
    scopes: v
      .array(
        v.string()
          .min(1)
          .max(MAX_APPLICATION_AUTH_SCOPE_LENGTH)
          .refine(isSafeOidcScope, "Expected an OAuth scope token"),
      )
      .min(1)
      .max(MAX_APPLICATION_AUTH_SCOPE_COUNT)
      .refine(hasRequiredOpenidScope, "OIDC scopes must include openid")
      .refine(hasUniqueStrings, "OIDC scopes must not contain duplicates"),
    claims: getOidcClaimMappingSchema().optional(),
    signingAlgorithms: v
      .array(v.enum(OIDC_SIGNING_ALGORITHMS))
      .min(1)
      .max(OIDC_SIGNING_ALGORITHMS.length)
      .refine(hasUniqueStrings, "OIDC signing algorithms must be unique")
      .optional(),
    trustedEndpointOrigins: v
      .array(
        v.string()
          .min(1)
          .max(MAX_OAUTH_URL_LENGTH)
          .refine(isSecureOrigin, "Expected a canonical HTTPS origin"),
      )
      .min(1)
      .max(MAX_REMOTE_HOST_COUNT)
      .refine(hasUniqueStrings, "OIDC trusted endpoint origins must be unique")
      .optional(),
    sessionTtlSeconds: v.number().int().positive().max(MAX_AUTH_LIFETIME_SECONDS).optional(),
    discoveryCacheTtlSeconds: v.number().int().positive().max(MAX_AUTH_LIFETIME_SECONDS)
      .optional(),
    cookieName: v.string().refine(
      isValidAuthCookieName,
      "Expected a __Host- HTTP cookie name",
    ).optional(),
  }).strict()
);

const getApplicationIdentityHeaderNameSchema = defineSchema((v) =>
  v.string()
    .min(1)
    .max(MAX_APPLICATION_IDENTITY_HEADER_NAME_LENGTH)
    .regex(HTTP_TOKEN_PATTERN, "Expected a valid HTTP header name")
    .refine(
      (value) => !isForbiddenApplicationIdentityHeaderName(value),
      "Expected a non-reserved HTTP header name",
    )
);

const getTrustedProxyHeadersSchema = defineSchema((v) =>
  v.object({
    subject: getApplicationIdentityHeaderNameSchema(),
    email: getApplicationIdentityHeaderNameSchema().optional(),
    name: getApplicationIdentityHeaderNameSchema().optional(),
    groups: getApplicationIdentityHeaderNameSchema().optional(),
    roles: getApplicationIdentityHeaderNameSchema().optional(),
  }).strict()
);

const getTrustedProxyAuthSchema = defineSchema((v) =>
  v.object({
    trustedPeers: v
      .array(
        v.string()
          .min(1)
          .max(MAX_REMOTE_HOST_URL_LENGTH)
          .refine(isTrustedProxyPeerAddress, "Expected an IP address"),
      )
      .min(1)
      .max(MAX_TRUSTED_PROXY_PEERS)
      .refine(hasUniqueTrustedProxyPeerAddresses, "Trusted proxy peers must be unique"),
    headers: getTrustedProxyHeadersSchema(),
  }).strict()
);

type SecurityObjectForCookieCollisionCheck = {
  readonly auth?: {
    readonly oidc?: {
      readonly cookieName?: string;
    };
  };
  readonly csrf?: boolean | {
    readonly cookieName?: string;
  };
};

function effectiveConfiguredCsrfCookieName(
  csrf: SecurityObjectForCookieCollisionCheck["csrf"],
): string | null {
  if (csrf === false) return null;
  if (typeof csrf === "object" && csrf.cookieName !== undefined) return csrf.cookieName;
  return DEFAULT_CSRF_COOKIE_NAME;
}

function hasNoOidcCsrfCookieCollision(
  security: SecurityObjectForCookieCollisionCheck,
): boolean {
  const oidc = security.auth?.oidc;
  if (oidc === undefined) return true;
  const csrfCookieName = effectiveConfiguredCsrfCookieName(security.csrf);
  if (csrfCookieName === null) return true;
  if (oidc.cookieName !== undefined) return oidc.cookieName !== csrfCookieName;
  return csrfCookieName !== SESSION_COOKIE_NAME &&
    !csrfCookieName.startsWith(`${SESSION_COOKIE_NAME}_`);
}

function hasExactlyOneAuthMode(
  auth: Partial<Record<"basic" | "bearer" | "oidc" | "trustedProxy", unknown>>,
): boolean {
  let count = 0;
  if (auth.basic !== undefined) count += 1;
  if (auth.bearer !== undefined) count += 1;
  if (auth.oidc !== undefined) count += 1;
  if (auth.trustedProxy !== undefined) count += 1;
  return count === 1 && count <= MAX_AUTH_MODE_COUNT;
}

function defineFilesystemRetrySchema(maxConfiguredCount: number) {
  return defineSchema((v) =>
    v
      .object({
        maxRetries: v.number().int().min(0).max(maxConfiguredCount).optional(),
        initialDelay: v.number().int().min(0).max(MAX_TIMER_DELAY_MS).optional(),
        maxDelay: v.number().int().min(0).max(MAX_TIMER_DELAY_MS).optional(),
      })
      .partial()
      .strict()
      .refine(
        (retry) =>
          retry.initialDelay === undefined ||
          retry.maxDelay === undefined ||
          retry.initialDelay <= retry.maxDelay,
        "Filesystem retry initialDelay must not exceed maxDelay",
      )
  );
}

const getVeryfrontFilesystemRetrySchema = defineFilesystemRetrySchema(
  MAX_VERYFRONT_FILESYSTEM_RETRIES,
);
const getGitHubFilesystemRetrySchema = defineFilesystemRetrySchema(
  MAX_GITHUB_FILESYSTEM_ATTEMPTS,
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

const getProjectDiscoveryPathSchema = defineSchema((v) =>
  v
    .string()
    .min(1)
    .max(MAX_PATH_LENGTH_CHARS)
    .refine(
      isProjectRelativeDiscoveryPath,
      "Expected a canonical project-relative discovery path",
    )
);

const getAiDiscoveryContainerSchema = defineSchema((v) =>
  v
    .object({
      discovery: v
        .object({
          enabled: v.boolean().optional(),
          paths: v
            .array(getProjectDiscoveryPathSchema())
            .max(MAX_PROJECT_DISCOVERY_DIRECTORIES)
            .optional(),
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
          esmLayouts: v.literal(true).optional(),
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
          /** Bare npm package roots that the runtime resolves instead of bundling. */
          serverExternalPackages: v
            .array(
              v
                .string()
                .min(1)
                .max(MAX_SERVER_EXTERNAL_PACKAGE_NAME_LENGTH)
                .refine(
                  isValidServerExternalPackageName,
                  "Expected a bare npm package name without a version or subpath",
                ),
            )
            .min(1)
            .max(MAX_SERVER_EXTERNAL_PACKAGE_COUNT)
            .refine(
              hasUniqueServerExternalPackages,
              "Server external package names must be unique",
            )
            .optional(),
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
              type: v.enum(["redis", "kv", "memory"]).optional(),
              redisUrl: v.string().optional(),
              keyPrefix: v.string().max(512).optional(),
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
              /** Legacy Redis connection settings retained for the built-in Redis backend. */
              redisUrl: v.string().optional(),
              redisKeyPrefix: v.string().max(512).optional(),
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
                  return config.kvPath === undefined &&
                    config.redisUrl === undefined &&
                    config.redisKeyPrefix === undefined;
                }
                if (type === "kv") {
                  return config.maxEntries === undefined &&
                    config.redisUrl === undefined &&
                    config.redisKeyPrefix === undefined;
                }
                if (type === "redis") {
                  return config.maxEntries === undefined &&
                    config.kvPath === undefined;
                }
                return false;
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
              oidc: getOidcAuthSchema().optional(),
              trustedProxy: getTrustedProxyAuthSchema().optional(),
            })
            .partial()
            .strict()
            .refine(
              hasExactlyOneAuthMode,
              "Configure exactly one authentication mode",
            )
            .optional(),
          /**
           * Extra CSP sources, merged into the platform's baseline policy.
           *
           * Additive: `{ fontSrc: ["https://fonts.gstatic.com"] }` keeps every
           * default and adds that origin. `null` drops the platform's optional
           * sources for one directive (e.g. `styleSrc: null` removes
           * `'unsafe-inline'`) while keeping the ones the renderer requires.
           */
          csp: v
            .record(v.string(), v.union([v.array(v.string()), v.null()]))
            .superRefine((csp, ctx) => {
              for (const key of Object.keys(csp)) {
                if (isCspDirectiveName(key)) continue;
                // Browsers ignore unknown directives silently, so a typo would
                // otherwise read as configured and protect nothing.
                ctx.addIssue({
                  message: `Unknown Content-Security-Policy directive "${key}". ` +
                    `Use a directive name such as ${
                      EXAMPLE_CSP_DIRECTIVES.join(", ")
                    } (camelCase or kebab-case).`,
                  // Relative to the refined value, which is already
                  // `security.csp`. Prefixing "csp" would report
                  // `security.csp.csp.<key>`.
                  path: [key],
                });
              }
            })
            .optional(),
          remoteHosts: v
            .array(v.string().max(MAX_REMOTE_HOST_URL_LENGTH).url())
            .max(MAX_REMOTE_HOST_COUNT)
            .optional(),
          /**
           * Restrict project redirects to the request origin and exact allowed
           * HTTP(S) origins. Omit this policy to preserve unrestricted redirect
           * behavior. An empty allowlist permits same-origin redirects only.
           */
          redirects: v
            .object({
              allowedOrigins: v
                .array(v.string().min(1).max(MAX_REDIRECT_ORIGIN_LENGTH))
                .max(MAX_REDIRECT_ORIGIN_COUNT)
                .refine(
                  isValidRedirectOriginList,
                  "Redirect origins must be unique canonical HTTP(S) origins within the policy limits",
                ),
            })
            .strict()
            .optional(),
          cors: getCorsSchema().optional(),
          /**
           * CSRF protection using the double-submit cookie pattern.
           * On by default in every environment, local development included.
           * Pass an object to customize it, or `false` to switch it off.
           *
           * Every request that is not GET, HEAD, or OPTIONS must include an
           * `x-csrf-token` header matching the origin's default CSRF cookie.
           * Veryfront uses `__Host-vf_csrf` on HTTPS and loopback origins, and
           * `vf_csrf` on plain-HTTP non-loopback origins. The cookie is set
           * automatically on HTML document responses.
           * Custom names must use HTTP token syntax. Exclusions must be
           * canonical absolute URL paths without queries, fragments, or
           * trailing slashes.
           *
           * Server Actions (`/_veryfront/rsc/action`) are CSRF-protected;
           * client code must forward the cookie value as the header. CSRF is
           * separate from the required `RscActionAuthorizationProvider`
           * extension contract and does not replace action authorization.
           */
          csrf: getCsrfSchema().optional(),
          coop: v.enum(["same-origin", "same-origin-allow-popups", "unsafe-none"]).optional(),
          corp: v.enum(["same-origin", "same-site", "cross-origin"]).optional(),
          coep: v.enum(["require-corp", "unsafe-none"]).optional(),
          /**
           * Restrict module imports to specific directories (opt-in security).
           * When not set, users can import from any directory in the project.
           * When set, only imports from these directories are allowed; an
           * explicit empty array denies imports from every project directory.
           * @example ["app", "pages", "components", "lib", "src", "utils"]
           */
          allowedImportDirs: v.array(v.string()).optional(),
        })
        .partial()
        .strict()
        .superRefine((security, ctx) => {
          if (hasNoOidcCsrfCookieCollision(security)) return;
          ctx.addIssue({
            message: "OIDC auth cookieName must not match the effective CSRF cookie name",
            path: ["auth", "oidc", "cookieName"],
          });
        })
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
              projectDir: v
                .string()
                .min(1)
                .max(MAX_PATH_LENGTH_CHARS)
                .refine(
                  isAbsolute,
                  "Image projectDir must be an absolute path",
                )
                .optional(),
              formats: v
                .array(v.enum(["webp", "avif", "jpeg", "png"]))
                .min(1)
                .max(4)
                .refine(
                  (formats) => new Set(formats).size === formats.length,
                  "Image formats must be unique",
                )
                .optional(),
              sizes: v
                .array(
                  v.number().int().positive().max(
                    IMAGE_OPTIMIZATION.MAX_DIMENSION,
                  ),
                )
                .min(1)
                .max(IMAGE_OPTIMIZATION.MAX_OUTPUT_SIZES)
                .refine(
                  (sizes) => new Set(sizes).size === sizes.length,
                  "Image sizes must be unique",
                )
                .optional(),
              quality: v.number().int().min(1).max(100).optional(),
              inputDir: v.string().min(1).max(MAX_PATH_LENGTH_CHARS).optional(),
              outputDir: v.string().min(1).max(MAX_PATH_LENGTH_CHARS).optional(),
              preserveOriginal: v.boolean().optional(),
            })
            .partial()
            .strict()
            .optional(),
          css: v
            .object({
              enabled: v.boolean().optional(),
              projectDir: v
                .string()
                .min(1)
                .max(MAX_PATH_LENGTH_CHARS)
                .refine(
                  isAbsolute,
                  "CSS projectDir must be an absolute path",
                )
                .optional(),
              minify: v.boolean().optional(),
              autoprefixer: v.boolean().optional(),
              purge: v.boolean().optional(),
              criticalCSS: v.boolean().optional(),
              inputFiles: v
                .array(v.string().min(1).max(MAX_PATH_LENGTH_CHARS))
                .max(CSS_OPTIMIZATION.MAX_FILES)
                .optional(),
              inputDir: v.string().min(1).max(MAX_PATH_LENGTH_CHARS).optional(),
              outputDir: v.string().min(1).max(MAX_PATH_LENGTH_CHARS).optional(),
              browsers: v
                .array(
                  v.string().min(1).max(
                    CSS_OPTIMIZATION.MAX_BROWSER_QUERY_CHARACTERS,
                  ),
                )
                .min(1)
                .max(CSS_OPTIMIZATION.MAX_BROWSER_QUERIES)
                .optional(),
              purgeContent: v
                .array(v.string().min(1).max(MAX_PATH_LENGTH_CHARS))
                .max(CSS_OPTIMIZATION.MAX_PURGE_PATTERNS)
                .optional(),
              purgeSafelist: v
                .array(v.string().min(1).max(MAX_PATH_LENGTH_CHARS))
                .max(CSS_OPTIMIZATION.MAX_PURGE_SAFELIST_ENTRIES)
                .optional(),
              sourceMap: v.boolean().optional(),
            })
            .partial()
            .strict()
            .refine(
              (options) => options.criticalCSS !== true,
              "Batch criticalCSS is unsupported; call extractCriticalCSS explicitly",
            )
            .refine(
              (options) => !(options.purge === true && options.sourceMap === true),
              "CSS purge and sourceMap cannot be enabled together",
            )
            .refine(
              (options) =>
                options.purge !== true ||
                options.purgeContent === undefined ||
                options.purgeContent.length > 0,
              "Enabled CSS purge requires non-empty purgeContent",
            )
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
                  /** Total retained files, including the active file. */
                  maxFiles: v.number().int().positive().max(MAX_FILE_LOG_FILES).optional(),
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
              retry: getVeryfrontFilesystemRetrySchema().optional(),
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
              retry: getGitHubFilesystemRetrySchema().optional(),
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
      /** Provider-neutral stylesheet selection for CSS processor extensions. */
      styles: v
        .object({
          /** Path to the global stylesheet (default: "globals.css") */
          stylesheet: v
            .string()
            .min(1)
            .max(MAX_PATH_LENGTH_CHARS)
            .refine(
              isCanonicalProjectRelativePath,
              "Expected a canonical project-relative stylesheet path",
            )
            .optional(),
        })
        .partial()
        .strict()
        .optional(),
      /**
       * Tailwind-specific authoring retained for existing projects. New
       * provider-neutral stylesheet selection should use `styles`.
       */
      tailwind: v
        .object({
          stylesheet: v.string().optional(),
          plugins: v
            .array(v.enum(["forms", "typography", "aspect-ratio", "container-queries"]))
            .optional(),
          theme: v
            .object({
              extend: v.record(v.string(), v.unknown()).optional(),
            })
            .partial()
            .strict()
            .optional(),
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
            v.string().min(1).max(MAX_SOURCE_INTEGRATION_POLICY_SEGMENT_LENGTH).refine(
              (name) => integrationNames.has(name),
              { message: "Expected a canonical integration name from the connector catalog" },
            ),
            v
              .object({
                /** Exact connector-local tool IDs; omit to allow all tools. */
                allowedTools: v
                  .array(
                    v.string()
                      .max(MAX_SOURCE_INTEGRATION_POLICY_SEGMENT_LENGTH)
                      .regex(
                        /^(?!.*__)[a-z0-9][a-z0-9_-]*$/,
                        "Expected a canonical connector-local tool ID",
                      ),
                  )
                  .max(MAX_SOURCE_INTEGRATION_POLICY_TOOL_IDS)
                  .optional(),
              })
              .strict(),
          ).refine(isBoundedSourceIntegrationAllowlist, {
            message: "Source integration allowlist exceeds resource limits",
          }),
        })
        .strict()
        .optional(),
      /**
       * Extensions registered for this project.
       *
       * Each entry is a fully-materialized `Extension` object, a disable
       * directive `{ name, enabled: false }` that vetoes an extension
       * discovered from a lower-priority source, or a first-party declaration
       * `{ name }` — the inert marker a hosted declarative config produces
       * for an imported `@veryfront/ext-*` factory call, accepted and ignored
       * with a warning because the platform provides the capability itself
       * (veryfront-issue-inbox#688). The runtime type is tightened at the
       * `veryfront/extensions` barrel — we keep this as `v.unknown()` here to
       * avoid pulling the extensions module into the config layer (would
       * introduce a circular import).
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
  const result = veryfrontConfigSchema.safeParse(input);
  if (result.success) return result.data as VeryfrontConfig;

  const issues = result.issues ?? [];
  const first = issues[0];
  const path = first?.path?.length ? first.path.join(".") : "<root>";
  const expected = first?.message ?? String(first);
  const corsHint = path.includes("security.cors")
    ? " Expected boolean or a CORS object with origin, credentials, methods, allowedHeaders, exposedHeaders, or maxAge."
    : "";
  const esmLayoutsHint = path === "experimental.esmLayouts"
    ? " The esmLayouts opt-out was removed; layout rendering always uses the ESM path." +
      " Remove the setting. See the Experimental features section in docs/guides/configuration.md."
    : "";
  const expectedWithHint = expected + corsHint + esmLayoutsHint;

  const context = {
    field: path,
    expected: expectedWithHint,
  };

  throw CONFIG_VALIDATION_FAILED.create({
    detail: `Invalid veryfront.config at ${path}: ${expectedWithHint}.`,
    context,
  });
}

/** Top-level project config keys recognized by the public schema. */
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
  "styles",
  "tailwind",
  "integrations",
  "extensions",
  "openapi",
]);

export function findUnknownTopLevelKeys(input: Record<string, unknown>): string[] {
  return Object.keys(input).filter((key) => !knownConfigKeys.has(key));
}
