/**
 * Shared CLI configuration for pull/push commands
 *
 * Handles API URL, authentication tokens, and project resolution.
 * @module cli/shared/config
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { join } from "veryfront/platform/path";
import { createFileSystem, cwd, getEnv } from "veryfront/platform";
import { type EnvironmentConfig, getEnvironmentConfig } from "veryfront/config";
import { getEnvSource } from "veryfront/utils/env-loader";
import { cliLogger, VERSION } from "#cli/utils";
import { readToken } from "../auth/token-store.ts";
import { ensureAuthenticated } from "../auth/login.ts";
import { resolveCliApiUrl } from "./constants.ts";
import { isRetryableConnectionError } from "../../src/proxy/retry.ts";

// Delays for exponential backoff with jitter: attempt 1 = ~300ms, 2 = ~1s, 3 = ~3s
const API_RETRY_DELAYS_MS = [300, 1000, 3000] as const;
const API_MAX_RETRIES = 3;

/** Returns true for HTTP status codes that indicate a transient gateway failure. */
function isTransientStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

/** Returns true when the connection error is a refused connection (request never reached server). */
function isConnectionRefused(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes("connection refused") || msg.includes("os error 111");
}

/** Sleep for `ms` milliseconds plus a random jitter up to 20% of `ms`. */
function sleepWithJitter(ms: number): Promise<void> {
  const jitter = Math.floor(ms * 0.2 * Math.random());
  return new Promise<void>((resolve) => setTimeout(resolve, ms + jitter));
}

export const getVeryfrontConfigSchema = defineSchema((v) =>
  v.object({
    projectSlug: v.string().optional(),
    /** List of project slugs for multi-project pull */
    projects: v.array(v.string()).optional(),
    apiToken: v.string().optional(),
    apiUrl: v.string().optional(),
  })
);
export const VeryfrontConfigSchema = lazySchema(getVeryfrontConfigSchema);
export type VeryfrontConfig = InferSchema<ReturnType<typeof getVeryfrontConfigSchema>>;

export const getResolvedConfigSchema = defineSchema((v) =>
  v.object({
    apiUrl: v.string(),
    apiToken: v.string(),
    apiTokenSource: v.enum(["env", "env-file", "config-file", "token-store"]).optional(),
    projectSlug: v.string(),
  })
);
export const ResolvedConfigSchema = lazySchema(getResolvedConfigSchema);
export type ResolvedConfig = InferSchema<ReturnType<typeof getResolvedConfigSchema>>;
type ApiTokenSource = NonNullable<ResolvedConfig["apiTokenSource"]>;

export async function readConfigFile(projectDir: string): Promise<VeryfrontConfig | null> {
  const fs = createFileSystem();

  let moduleProjectSlug: string | undefined;
  for (const ext of [".ts", ".js"]) {
    const configPath = join(projectDir, `veryfront.config${ext}`);

    try {
      if (!(await fs.exists(configPath))) continue;

      const module = await import(`file://${configPath}`);
      const config = module.default ?? module;

      if (config?.projectSlug) {
        moduleProjectSlug = config.projectSlug;
        break;
      }
    } catch (error) {
      cliLogger.debug(`Failed to import config file ${configPath}:`, error);
    }
  }

  // veryfront.json is always merged in: veryfront.config.ts owns the
  // projectSlug when both define one, but apiUrl/apiToken only live in
  // veryfront.json and must not be dropped because a TS config exists.
  const configJsonPath = join(projectDir, "veryfront.json");
  let jsonConfig: VeryfrontConfig | null = null;

  try {
    if (await fs.exists(configJsonPath)) {
      const content = await fs.readTextFile(configJsonPath);
      const parsed = VeryfrontConfigSchema.safeParse(JSON.parse(content));
      jsonConfig = parsed.success ? parsed.data : null;
    }
  } catch (error) {
    cliLogger.debug(`Failed to read veryfront.json:`, error);
  }

  if (!moduleProjectSlug && !jsonConfig) return null;
  return {
    ...jsonConfig,
    ...(moduleProjectSlug ? { projectSlug: moduleProjectSlug } : {}),
  };
}

export async function writeProjectSlug(projectDir: string, slug: string): Promise<void> {
  const fs = createFileSystem();
  const configJsonPath = join(projectDir, "veryfront.json");

  let existing: VeryfrontConfig = {};
  try {
    const content = await fs.readTextFile(configJsonPath);
    const parsed = VeryfrontConfigSchema.safeParse(JSON.parse(content));
    if (parsed.success) existing = parsed.data;
  } catch { /* file doesn't exist yet */ }

  existing.projectSlug = slug;
  await fs.writeTextFile(configJsonPath, JSON.stringify(existing, null, 2) + "\n");
}

function slugify(value: string): string {
  return value.replace(/[^a-z0-9-]/gi, "-");
}

async function inferProjectSlug(projectDir: string): Promise<string | null> {
  const fs = createFileSystem();
  const packagePath = join(projectDir, "package.json");

  try {
    if (await fs.exists(packagePath)) {
      const content = await fs.readTextFile(packagePath);
      const pkg = JSON.parse(content) as { name?: string };
      const name = pkg.name?.replace(/^@[^/]+\//, "");
      if (name) return slugify(name);
    }
  } catch (error) {
    cliLogger.debug("Failed to read package.json for project slug:", error);
  }

  const dirName = projectDir.split(/[/\\]/).pop();
  return dirName ? slugify(dirName) : null;
}

function resolveTenantProjectReference(): string | undefined {
  return getEnv("VERYFRONT_PROJECT_SLUG") ||
    getEnv("TENANT_PROJECT_SLUG") ||
    getEnv("VERYFRONT_PROJECT_ID") ||
    getEnv("TENANT_PROJECT_ID") ||
    undefined;
}

async function resolveApiTokenForMode(
  env: EnvironmentConfig,
  configFile: VeryfrontConfig | null,
  interactive: boolean,
): Promise<{ apiToken: string | null; apiTokenSource?: ApiTokenSource }> {
  const envToken = env.apiToken;
  const envSource = envToken ? getEnvSource("VERYFRONT_API_TOKEN") : { source: "unset" as const };
  const storedToken = await readToken(env);

  if (envToken && envSource.source !== "env-file") {
    return {
      apiToken: envToken,
      apiTokenSource: "env",
    };
  }

  if (configFile?.apiToken) {
    return { apiToken: configFile.apiToken, apiTokenSource: "config-file" };
  }

  if (interactive && envToken && envSource.source === "env-file" && storedToken) {
    return { apiToken: storedToken, apiTokenSource: "token-store" };
  }

  if (envToken) {
    return {
      apiToken: envToken,
      apiTokenSource: envSource.source === "env-file" ? "env-file" : "env",
    };
  }

  if (storedToken) {
    return { apiToken: storedToken, apiTokenSource: "token-store" };
  }

  return { apiToken: null };
}

async function resolveConfigBase(
  projectDir: string | undefined,
  env: EnvironmentConfig,
  interactive: boolean,
): Promise<ResolvedConfig> {
  const dir = projectDir ?? cwd();
  const configFile = await readConfigFile(dir);

  const apiUrl = resolveCliApiUrl(env, configFile?.apiUrl);

  let { apiToken, apiTokenSource } = await resolveApiTokenForMode(env, configFile, interactive);

  if (!apiToken && interactive) {
    const userInfo = await ensureAuthenticated(env);
    if (!userInfo) throw new Error("Authentication required for this operation.");
    apiToken = (await readToken(env)) ?? null;
    apiTokenSource = apiToken ? "token-store" : undefined;
    if (!apiToken) throw new Error("Authentication failed. Please try again.");
  }

  if (!apiToken) {
    throw new Error(
      "Missing API token. Run 'veryfront login' or set VERYFRONT_API_TOKEN environment variable",
    );
  }

  const projectSlug = env.projectSlug ??
    configFile?.projectSlug ??
    resolveTenantProjectReference() ??
    (await inferProjectSlug(dir));
  if (!projectSlug) {
    throw new Error(
      "Could not determine project reference. Set VERYFRONT_PROJECT_SLUG, TENANT_PROJECT_SLUG, VERYFRONT_PROJECT_ID, or add projectSlug to veryfront.config.ts",
    );
  }

  return { apiUrl, apiToken, ...(apiTokenSource ? { apiTokenSource } : {}), projectSlug };
}

function createConfigResolver(interactive: boolean) {
  return (projectDir?: string, env?: EnvironmentConfig): Promise<ResolvedConfig> =>
    resolveConfigByMode(projectDir, env, interactive);
}

export const resolveConfig = createConfigResolver(false);

/**
 * Resolve config with interactive authentication.
 *
 * If no token is available, prompts the user to login interactively.
 * Use this for commands that require authentication (push, pull, deploy).
 */
export const resolveConfigWithAuth = createConfigResolver(true);

function resolveConfigByMode(
  projectDir: string | undefined,
  env: EnvironmentConfig | undefined,
  interactive: boolean,
): Promise<ResolvedConfig> {
  return resolveConfigBase(projectDir, env ?? getEnvironmentConfig(), interactive);
}

export interface ApiClient {
  get<T>(path: string, params?: Record<string, string>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

export const getApiErrorSchema = defineSchema((v) =>
  v.object({
    error: v.string(),
    message: v.string().optional(),
    code: v.string().optional(),
  })
);
export const ApiErrorSchema = lazySchema(getApiErrorSchema);
export type ApiError = InferSchema<ReturnType<typeof getApiErrorSchema>>;

export function createApiClient(config: ResolvedConfig): ApiClient {
  const { apiUrl, apiToken } = config;

  function addTokenSourceHint(message: string, status: number): string {
    if (config.apiTokenSource !== "env-file") return message;
    if (status !== 401 && status !== 403 && status !== 404) return message;

    return `${message}. VERYFRONT_API_TOKEN was loaded from a project .env file. For management commands, run 'veryfront login' and remove or rename the project runtime token, or pass a management token explicitly in the shell.`;
  }

  async function requestOnce<T>(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-veryfront-client-version": VERSION,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      let errorMessage = `API request failed: ${response.status} ${response.statusText}`;

      try {
        const parsed = ApiErrorSchema.safeParse(await response.json());
        if (parsed.success) {
          errorMessage = parsed.data.message || parsed.data.error || errorMessage;
        }
      } catch {
        // Keep default error message if JSON parsing fails
      }

      errorMessage = addTokenSourceHint(errorMessage, response.status);
      const err = new Error(errorMessage) as Error & { status: number };
      err.status = response.status;
      throw err;
    }

    if (response.status === 204) return undefined as T;

    return response.json() as Promise<T>;
  }

  /** Returns true for request methods that are safe to retry on any transient failure. */
  function isIdempotent(method: string): boolean {
    return method === "GET" || method === "HEAD";
  }

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${apiUrl}${path}`);

    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, value);
    }

    const urlStr = url.toString();
    let lastError: unknown;

    for (let attempt = 0; attempt < API_MAX_RETRIES; attempt++) {
      try {
        return await requestOnce<T>(method, urlStr, body);
      } catch (error) {
        lastError = error;

        const status = (error as { status?: number }).status;
        const isTransient = status !== undefined
          ? isTransientStatus(status)
          : isRetryableConnectionError(error);
        const isRefused = isConnectionRefused(error);

        // Idempotent: retry on transient HTTP status or any retryable connection error.
        // Non-idempotent: retry only on connection-refused (request never reached server).
        const shouldRetry = isIdempotent(method)
          ? (isTransient || isRetryableConnectionError(error))
          : isRefused;

        if (!shouldRetry || attempt >= API_MAX_RETRIES - 1) {
          throw error;
        }

        await sleepWithJitter(API_RETRY_DELAYS_MS[attempt as 0 | 1 | 2]);
        cliLogger.debug(
          `API request ${method} ${path} failed (attempt ${attempt + 1}), retrying...`,
          error,
        );
      }
    }

    throw lastError;
  }

  return {
    get<T>(path: string, params?: Record<string, string>): Promise<T> {
      return request<T>("GET", path, undefined, params);
    },
    post<T>(path: string, body?: unknown): Promise<T> {
      return request<T>("POST", path, body);
    },
    put<T>(path: string, body?: unknown): Promise<T> {
      return request<T>("PUT", path, body);
    },
    patch<T>(path: string, body?: unknown): Promise<T> {
      return request<T>("PATCH", path, body);
    },
    delete<T>(path: string): Promise<T> {
      return request<T>("DELETE", path);
    },
  };
}
