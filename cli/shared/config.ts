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
import { readProjectLinkForControlPlane } from "./project-link.ts";
import { isConnectionRefusedError, isRetryableConnectionError } from "../../src/proxy/retry.ts";

// Delays for exponential backoff with jitter: attempt 1 = ~300ms, 2 = ~1s, 3 = ~3s
const API_RETRY_DELAYS_MS = [300, 1000, 3000] as const;
const API_MAX_RETRIES = 3;

/** Returns true for HTTP status codes that indicate a transient gateway failure. */
function isTransientStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

/**
 * Classify failures from an idempotent API read conservatively.
 *
 * A structured HTTP status is authoritative: authentication, validation, and
 * other client failures must not become retryable merely because an attached
 * cause resembles a connection error.
 */
export function isRetryableApiReadError(error: unknown): boolean {
  const status = typeof error === "object" && error !== null
    ? (error as { status?: unknown }).status
    : undefined;
  return typeof status === "number" ? isTransientStatus(status) : isRetryableConnectionError(error);
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
    projectId: v.string().optional(),
  })
);
export const ResolvedConfigSchema = lazySchema(getResolvedConfigSchema);
export type ResolvedConfig = InferSchema<ReturnType<typeof getResolvedConfigSchema>>;
export type ApiTokenSource = NonNullable<ResolvedConfig["apiTokenSource"]>;

export interface ApiCredentialCandidate {
  apiToken: string;
  apiTokenSource: ApiTokenSource;
  validationEnv: EnvironmentConfig;
  authoritative: boolean;
}

interface ConfigFileResolution {
  config: VeryfrontConfig | null;
  jsonProjectSlug?: string;
  moduleProjectSlug?: string;
  moduleProjectSlugFile?: string;
}

export type ProjectReferenceSource =
  | { kind: "argument"; name: "--project" }
  | { kind: "environment"; name: "environment configuration" }
  | { kind: "module-config"; name: string }
  | { kind: "json-config"; name: "veryfront.json" }
  | { kind: "tenant-environment"; name: string }
  | { kind: "local-link"; name: ".veryfront/project.json" }
  | { kind: "inferred"; name: "project files" };

export interface ResolvedConfigDetails {
  config: ResolvedConfig;
  projectReferenceSource: ProjectReferenceSource;
}

export const ENVIRONMENT_PROJECT_REFERENCE_NAMES = [
  "VERYFRONT_PROJECT_SLUG",
  "TENANT_PROJECT_SLUG",
  "VERYFRONT_PROJECT_ID",
  "TENANT_PROJECT_ID",
] as const;

export type EnvironmentProjectReferenceName = typeof ENVIRONMENT_PROJECT_REFERENCE_NAMES[number];

async function readConfigFileResolution(projectDir: string): Promise<ConfigFileResolution> {
  const fs = createFileSystem();

  let moduleProjectSlug: string | undefined;
  let moduleProjectSlugFile: string | undefined;
  for (const ext of [".ts", ".js"]) {
    const configPath = join(projectDir, `veryfront.config${ext}`);

    try {
      if (!(await fs.exists(configPath))) continue;

      const module = await import(`file://${configPath}`);
      const config = module.default ?? module;

      if (config?.projectSlug) {
        moduleProjectSlug = config.projectSlug;
        moduleProjectSlugFile = `veryfront.config${ext}`;
        break;
      }
    } catch (error) {
      cliLogger.debug(`Failed to import config file ${configPath}:`, error);
    }
  }

  // veryfront.json is always merged in: veryfront.config.ts owns the
  // projectSlug when both define one, but apiUrl/apiToken only live in
  // veryfront.json and must not be dropped because a TS config exists.
  const jsonConfig = await readConfigJsonFile(projectDir);

  const config = !moduleProjectSlug && !jsonConfig ? null : {
    ...jsonConfig,
    ...(moduleProjectSlug ? { projectSlug: moduleProjectSlug } : {}),
  };
  return {
    config,
    jsonProjectSlug: jsonConfig?.projectSlug,
    moduleProjectSlug,
    moduleProjectSlugFile,
  };
}

export async function readConfigFile(projectDir: string): Promise<VeryfrontConfig | null> {
  return (await readConfigFileResolution(projectDir)).config;
}

export async function readConfigJsonFile(projectDir: string): Promise<VeryfrontConfig | null> {
  const fs = createFileSystem();
  const configJsonPath = join(projectDir, "veryfront.json");

  try {
    if (await fs.exists(configJsonPath)) {
      const content = await fs.readTextFile(configJsonPath);
      const parsed = VeryfrontConfigSchema.safeParse(JSON.parse(content));
      return parsed.success ? parsed.data : null;
    }
  } catch (error) {
    cliLogger.debug(`Failed to read veryfront.json:`, error);
  }

  return null;
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

export function resolveEnvironmentProjectReference():
  | { reference: string; name: EnvironmentProjectReferenceName }
  | undefined {
  for (const name of ENVIRONMENT_PROJECT_REFERENCE_NAMES) {
    const reference = getEnv(name);
    if (reference) return { reference, name };
  }
  return undefined;
}

async function resolveApiTokenForMode(
  env: EnvironmentConfig,
  configFile: VeryfrontConfig | null,
  interactive: boolean,
  configFileApiUrlActive: boolean,
): Promise<{ apiToken: string | null; apiTokenSource?: ApiTokenSource }> {
  const candidates = await resolveApiCredentialCandidates(env, configFile, interactive, env);
  // A checked-in veryfront.json apiUrl must never receive credentials the
  // config file did not also supply: pairing it with an environment, .env,
  // or token-store token would let a cloned repository exfiltrate the
  // developer's Veryfront credential to an attacker-controlled host.
  const eligible = configFileApiUrlActive
    ? candidates.filter((entry) => entry.apiTokenSource === "config-file")
    : candidates;
  const [candidate] = eligible;
  if (candidate) {
    return {
      apiToken: candidate.apiToken,
      apiTokenSource: candidate.apiTokenSource,
    };
  }

  return { apiToken: null };
}

async function resolveApiCredentialCandidates(
  env: EnvironmentConfig,
  configFile: VeryfrontConfig | null,
  interactive: boolean,
  validationEnv: EnvironmentConfig,
): Promise<ApiCredentialCandidate[]> {
  const envToken = env.apiToken;
  const envSource = envToken ? getEnvSource("VERYFRONT_API_TOKEN") : { source: "unset" as const };
  const storedToken = await readToken(env);
  const candidates: ApiCredentialCandidate[] = [];

  const shellEnvToken = envToken && envSource.source !== "env-file";
  const projectEnvTokenAfterStored = interactive && envToken && envSource.source === "env-file" &&
    storedToken;

  if (shellEnvToken) {
    candidates.push({
      apiToken: envToken,
      apiTokenSource: "env",
      validationEnv,
      authoritative: true,
    });
  }

  if (configFile?.apiToken) {
    candidates.push({
      apiToken: configFile.apiToken,
      apiTokenSource: "config-file",
      validationEnv,
      authoritative: true,
    });
  }

  if (projectEnvTokenAfterStored) {
    candidates.push({
      apiToken: storedToken,
      apiTokenSource: "token-store",
      validationEnv,
      authoritative: false,
    });
  }

  if (envToken && !shellEnvToken) {
    candidates.push({
      apiToken: envToken,
      apiTokenSource: envSource.source === "env-file" ? "env-file" : "env",
      validationEnv,
      authoritative: envSource.source !== "env-file",
    });
  }

  if (storedToken && !projectEnvTokenAfterStored) {
    candidates.push({
      apiToken: storedToken,
      apiTokenSource: "token-store",
      validationEnv,
      authoritative: false,
    });
  }

  return candidates;
}

export async function resolveApiCredentialCandidatesForAuth(
  env: EnvironmentConfig = getEnvironmentConfig(),
  projectDir: string = cwd(),
  interactive = true,
): Promise<ApiCredentialCandidate[]> {
  const configFile = await readConfigJsonFile(projectDir);
  const validationEnv = {
    ...env,
    apiUrl: resolveCliApiUrl(env, configFile?.apiUrl),
  };

  return resolveApiCredentialCandidates(env, configFile, interactive, validationEnv);
}

async function resolveConfigBase(
  projectDir: string | undefined,
  env: EnvironmentConfig,
  interactive: boolean,
): Promise<ResolvedConfigDetails> {
  const dir = projectDir ?? cwd();
  const configFileResolution = await readConfigFileResolution(dir);
  const configFile = configFileResolution.config;

  const apiUrl = resolveCliApiUrl(env, configFile?.apiUrl);
  // True when the checked-in config file supplied the effective API host
  // (no VERYFRONT_API_URL / non-default VERYFRONT_API_BASE_URL override).
  const configFileApiUrlActive = configFile?.apiUrl !== undefined &&
    apiUrl !== resolveCliApiUrl(env);

  let { apiToken, apiTokenSource } = await resolveApiTokenForMode(
    env,
    configFile,
    interactive,
    configFileApiUrlActive,
  );

  if (!apiToken && configFileApiUrlActive) {
    throw new Error(
      `veryfront.json sets apiUrl to ${apiUrl}; refusing to send credentials from the environment or 'veryfront login' to it. ` +
        `Add a matching apiToken to veryfront.json, or set VERYFRONT_API_URL=${apiUrl} to confirm this API host.`,
    );
  }

  if (!apiToken && interactive) {
    const userInfo = await ensureAuthenticated(env, dir);
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

  let projectSlug: string | null | undefined;
  let projectId: string | undefined;
  let projectReferenceSource: ProjectReferenceSource;
  if (env.projectSlug !== undefined) {
    projectSlug = env.projectSlug;
    projectReferenceSource = { kind: "environment", name: "environment configuration" };
  } else if (configFileResolution.moduleProjectSlug !== undefined) {
    projectSlug = configFileResolution.moduleProjectSlug;
    projectReferenceSource = {
      kind: "module-config",
      name: configFileResolution.moduleProjectSlugFile ?? "veryfront.config.ts",
    };
  } else if (configFileResolution.jsonProjectSlug !== undefined) {
    projectSlug = configFileResolution.jsonProjectSlug;
    projectReferenceSource = { kind: "json-config", name: "veryfront.json" };
  } else {
    const tenantReference = resolveEnvironmentProjectReference();
    if (tenantReference) {
      projectSlug = tenantReference.reference;
      if (
        tenantReference.name === "VERYFRONT_PROJECT_ID" ||
        tenantReference.name === "TENANT_PROJECT_ID"
      ) {
        projectId = tenantReference.reference;
      }
      projectReferenceSource = { kind: "tenant-environment", name: tenantReference.name };
    } else {
      const projectLink = await readProjectLinkForControlPlane(dir, apiUrl);
      if (projectLink) {
        projectSlug = projectLink.projectSlug;
        projectId = projectLink.projectId;
        projectReferenceSource = { kind: "local-link", name: ".veryfront/project.json" };
      } else {
        projectSlug = await inferProjectSlug(dir);
        projectReferenceSource = { kind: "inferred", name: "project files" };
      }
    }
  }
  if (!projectSlug) {
    throw new Error(
      "Could not determine project reference. Set VERYFRONT_PROJECT_SLUG, TENANT_PROJECT_SLUG, VERYFRONT_PROJECT_ID, or add projectSlug to veryfront.config.ts",
    );
  }

  return {
    config: {
      apiUrl,
      apiToken,
      ...(apiTokenSource ? { apiTokenSource } : {}),
      projectSlug,
      ...(projectId ? { projectId } : {}),
    },
    projectReferenceSource,
  };
}

function createConfigResolver(interactive: boolean) {
  return async (projectDir?: string, env?: EnvironmentConfig): Promise<ResolvedConfig> =>
    (await resolveConfigByMode(projectDir, env, interactive)).config;
}

export const resolveConfig = createConfigResolver(false);

/**
 * Resolve config with interactive authentication.
 *
 * If no token is available, prompts the user to login interactively.
 * Use this for commands that require authentication (push, pull, deploy).
 */
export const resolveConfigWithAuth = createConfigResolver(true);

export function resolveConfigWithAuthDetails(
  projectDir?: string,
  env?: EnvironmentConfig,
): Promise<ResolvedConfigDetails> {
  return resolveConfigByMode(projectDir, env, true);
}

function resolveConfigByMode(
  projectDir: string | undefined,
  env: EnvironmentConfig | undefined,
  interactive: boolean,
): Promise<ResolvedConfigDetails> {
  return resolveConfigBase(projectDir, env ?? getEnvironmentConfig(), interactive);
}

export interface ApiReadOptions {
  /** Abort the in-flight HTTP request when this signal fires. */
  signal?: AbortSignal;
  /** Use `none` when a caller owns retry timing or replaying a write would be ambiguous. */
  retryPolicy?: "default" | "none";
}

export interface ApiClient {
  get<T>(
    path: string,
    params?: Record<string, string>,
    options?: ApiReadOptions,
  ): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown, options?: ApiReadOptions): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

export const getApiErrorSchema = defineSchema((v) =>
  v.object({
    error: v.string().optional(),
    message: v.string().optional(),
    detail: v.string().optional(),
    title: v.string().optional(),
    suggestion: v.string().optional(),
    code: v.string().optional(),
    slug: v.string().optional(),
  })
);
export const ApiErrorSchema = lazySchema(getApiErrorSchema);
export type ApiError = InferSchema<ReturnType<typeof getApiErrorSchema>>;

export function formatApiError(data: ApiError, fallback: string): string {
  const message = data.message || data.detail || data.error || data.title || fallback;
  return data.suggestion ? `${message.replace(/[.?!]+$/, "")}. ${data.suggestion}` : message;
}

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
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(url, {
      method,
      ...(signal ? { signal } : {}),
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
          errorMessage = formatApiError(parsed.data, errorMessage);
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
    return method === "GET" || method === "HEAD" || method === "PUT";
  }

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string>,
    options: ApiReadOptions = {},
  ): Promise<T> {
    const url = new URL(`${apiUrl}${path}`);

    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, value);
    }

    const urlStr = url.toString();
    let lastError: unknown;
    const maxAttempts = options.retryPolicy === "none" ? 1 : API_MAX_RETRIES;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await requestOnce<T>(method, urlStr, body, options.signal);
      } catch (error) {
        lastError = error;

        const isRefused = isConnectionRefusedError(error);

        // Idempotent: retry on transient HTTP status or status-less retryable connection errors.
        // Non-idempotent: retry only on connection-refused (request never reached server).
        const shouldRetry = isIdempotent(method) ? isRetryableApiReadError(error) : isRefused;

        if (!shouldRetry || attempt >= maxAttempts - 1) {
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
    get<T>(
      path: string,
      params?: Record<string, string>,
      options?: ApiReadOptions,
    ): Promise<T> {
      return request<T>("GET", path, undefined, params, options);
    },
    post<T>(path: string, body?: unknown): Promise<T> {
      return request<T>("POST", path, body);
    },
    put<T>(path: string, body?: unknown, options?: ApiReadOptions): Promise<T> {
      return request<T>("PUT", path, body, undefined, options);
    },
    patch<T>(path: string, body?: unknown): Promise<T> {
      return request<T>("PATCH", path, body);
    },
    delete<T>(path: string): Promise<T> {
      return request<T>("DELETE", path);
    },
  };
}
