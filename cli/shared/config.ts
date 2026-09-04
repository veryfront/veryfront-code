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
  API_URL_ENV_KEYS,
  type ApiUrlEnvKey,
  DEFAULT_API_URL,
  isSameApiEndpoint,
  resolveCliApiUrl,
  resolveCliApiUrlWithOrigin,
  resolveRestApiBaseUrl,
} from "./constants.ts";
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
  /** Set when the effective endpoint came from this project's veryfront.json. */
  steeringConfigFile?: string;
}

/** Classify the effective API URL and who chose it. */
export function resolveApiUrlTrust(
  env: EnvironmentConfig,
  configFile: VeryfrontConfig | null,
  configFilePath = "veryfront.json",
): ApiUrlTrust {
  const { apiUrl, origin } = resolveCliApiUrlWithOrigin(env, configFile?.apiUrl);

  if (origin.source === "env") {
    // The same variable means different things depending on where it was read.
    // Set in the operator's own shell it confirms the host; read out of a
    // project `.env` file it is just more repository content.
    const source = getEnvSource(origin.key);
    if (source.source === "config-file") {
      const matchesCurrentConfig = source.file === configFilePath &&
        configFile?.apiUrl !== undefined &&
        (isSameApiEndpoint(apiUrl, configFile.apiUrl) ||
          isSameApiEndpoint(apiUrl, apiBaseUrlForRequest(configFile.apiUrl)) ||
          isSameApiEndpoint(apiUrl, `${apiBaseUrlForRequest(configFile.apiUrl)}/api`));
      return {
        apiUrl,
        repositorySteered: !isSameApiEndpoint(apiUrl, DEFAULT_API_URL),
        ...(matchesCurrentConfig ? { steeringConfigFile: configFilePath } : {}),
      };
    }
    // Compare a project .env value with the endpoint selected after removing
    // EVERY repository-controlled override, not just the one that happened to
    // win. `apiBaseUrl` falls back to `apiUrl.replace("/graphql", "/api")`
    // (src/config/environment-config.ts), so clearing `apiUrl` alone leaves the
    // same attacker host as the fallback and the comparison comes out equal —
    // marking a repository-steered endpoint trusted. A project `.env` that sets
    // VERYFRONT_API_BASE_URL directly has the same problem. An operator's own
    // shell value is preserved: only keys whose source is a repository `.env`
    // file are stripped.
    const operatorEnv = { ...env };
    for (const key of API_URL_ENV_KEYS) {
      if (getEnvSource(key).source !== "env-file") continue;
      if (key === "VERYFRONT_API_URL") operatorEnv.apiUrl = undefined;
      // `apiBaseUrl` is required, so reset it to the hosted default rather than
      // clearing it: keeping the repository value would let the comparison
      // succeed against the very host being judged.
      else operatorEnv.apiBaseUrl = DEFAULT_API_URL;
    }
    // apiBaseUrl also derives from apiUrl when unset, so a repository
    // VERYFRONT_API_URL reaches the baseline through it even when the file
    // never set VERYFRONT_API_BASE_URL. Keep a real operator shell value.
    if (
      operatorEnv.apiUrl === undefined &&
      getEnvSource("VERYFRONT_API_BASE_URL").source !== "process"
    ) {
      operatorEnv.apiBaseUrl = DEFAULT_API_URL;
    }
    const operatorApiUrl = source.source === "env-file" ? resolveCliApiUrl(operatorEnv) : apiUrl;
    if (source.source === "env-file" && !isSameApiEndpoint(apiUrl, operatorApiUrl)) {
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
    steeringConfigFile: configFilePath,
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

/**
 * Explain the refusal to the developer running the command.
 *
 * Repository-controlled URL text is never echoed. Project `.env` values can
 * expand any process variable, including credentials the resolver does not
 * know about, and an expanded secret can land in any URL component or in an
 * unparseable value. Only the env file's name is shown, never its path.
 */
function describeUntrustedApiUrl(trust: ApiUrlTrust): string {
  const steer = trust.steeringEnvFile === undefined
    ? "veryfront.json selects a repository-configured API endpoint"
    : `The project ${
      basename(trust.steeringEnvFile)
    } file sets ${trust.steeringEnvKey} to a repository-configured API endpoint`;

  const endpointSource = trust.steeringEnvKey ? getEnvSource(trust.steeringEnvKey) : undefined;
  const endpointExpandedFromProcess = endpointSource?.source === "env-file" &&
    endpointSource.expandedFromProcessEnv;
  const repositoryCredential = trust.steeringEnvFile === undefined
    ? "Add a matching apiToken to the same veryfront.json"
    : `Add a literal VERYFRONT_API_TOKEN to the same ${basename(trust.steeringEnvFile)} file`;
  const confirmationKey = trust.steeringEnvKey ?? "VERYFRONT_API_URL";
  const remedy = endpointExpandedFromProcess
    ? `Replace ${confirmationKey} with a literal endpoint in the same file, or, if you trust the `
    : `${repositoryCredential}, or, if you trust the `;
  return `${steer}. Veryfront does not send credentials from your shell environment or ` +
    `'veryfront login' to that endpoint. ${remedy}` +
    `configured endpoint, set ${confirmationKey} in your shell to the complete API endpoint ` +
    `to confirm it.`;
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
  if (candidate.apiTokenSource === "config-file") return trust.steeringConfigFile !== undefined;
  if (candidate.apiTokenSource !== "env-file" || trust.steeringEnvFile === undefined) return false;

  const endpointSource = trust.steeringEnvKey ? getEnvSource(trust.steeringEnvKey) : undefined;
  if (endpointSource?.source === "env-file" && endpointSource.expandedFromProcessEnv) return false;

  const tokenSource = getEnvSource("VERYFRONT_API_TOKEN");
  if (tokenSource.source !== "env-file" || tokenSource.file !== trust.steeringEnvFile) return false;

  // `loadEnv` expands `$NAME` against the real process environment, so an entry
  // such as `VERYFRONT_API_TOKEN=$GITHUB_TOKEN` looks like it came from the
  // file while its value is the operator's shell secret. The repository chose
  // which secret to name; it never owned the secret itself.
  return !tokenSource.expandedFromProcessEnv;
}

function apiBaseUrlForRequest(apiUrl: string): string {
  return apiUrl.replace(/\/(?:graphql|api)\/?$/, "").replace(/\/+$/, "");
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
  configFileValidationEnv: EnvironmentConfig = validationEnv,
): Promise<ApiCredentialCandidate[]> {
  const envToken = env.apiToken;
  const envSource = envToken ? getEnvSource("VERYFRONT_API_TOKEN") : { source: "unset" as const };
  const storedToken = await readToken(env);
  const candidates: ApiCredentialCandidate[] = [];

  const shellEnvToken = envToken && envSource.source !== "env-file" &&
    envSource.source !== "config-file";
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
      validationEnv: configFileValidationEnv,
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

  if (envToken && envSource.source === "env-file") {
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
  const trust = resolveApiUrlTrust(env, configFile, join(projectDir, "veryfront.json"));
  // A checked-in veryfront.json apiUrl only steers the credential that came
  // from that same file. Shell-environment, .env-file, and token-store
  // credentials validate against the environment-derived API URL, so a
  // malicious repository config cannot redirect their Authorization headers
  // to an attacker-controlled host.
  const validationEnv = {
    ...env,
    apiUrl: resolveCliApiUrl(env),
  };
  const configEndpoint = resolveCliApiUrlWithOrigin(env, configFile?.apiUrl);
  const configFileValidationEnv = {
    ...env,
    apiUrl: configEndpoint.apiUrl,
    ...(configFile?.apiUrl
      ? {
        apiBaseUrl: configEndpoint.origin.source === "env" &&
            configEndpoint.origin.key === "VERYFRONT_API_BASE_URL"
          ? resolveRestApiBaseUrl(configEndpoint.apiUrl, false)
          : resolveRestApiBaseUrl(configEndpoint.apiUrl, false),
      }
      : {}),
  };

  const candidates = await resolveApiCredentialCandidates(
    env,
    configFile,
    interactive,
    validationEnv,
    configFileValidationEnv,
  );

  const apiBaseSource = getEnvSource("VERYFRONT_API_BASE_URL");
  if (
    trust.repositorySteered && apiBaseSource.source === "config-file" &&
    (trust.steeringConfigFile === undefined ||
      (configFile?.apiToken === undefined && isSameApiEndpoint(env.apiBaseUrl, trust.apiUrl)))
  ) {
    return [];
  }

  if (trust.repositorySteered && trust.steeringConfigFile) {
    const configCandidates = candidates.filter((entry) => entry.apiTokenSource === "config-file");
    const otherCandidates = candidates.filter((entry) => entry.apiTokenSource !== "config-file");
    return [...configCandidates, ...otherCandidates];
  }

  // `login`, `whoami`, and `up` validate a candidate by sending it to
  // `validationEnv.apiUrl`, so these preflights reach the repository-supplied
  // host before any call to `resolveConfig`. They need the same rule: a
  // repository-steered host may only receive credentials the repository itself
  // supplied, never a shell, stored-login, or unrelated .env token.
  if (!trust.repositorySteered || trust.steeringEnvFile === undefined) return candidates;
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
  const trust = resolveApiUrlTrust(env, configFile, join(projectDir, "veryfront.json"));
  if (!trust.repositorySteered) return;
  const configEndpointHydrated = getEnvSource("VERYFRONT_API_URL").source === "config-file" ||
    getEnvSource("VERYFRONT_API_BASE_URL").source === "config-file";
  if (trust.steeringEnvFile === undefined && !configEndpointHydrated) return;

  throw new UntrustedApiUrlCredentialError(
    describeUntrustedApiUrl(trust),
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
      describeUntrustedApiUrl(trust),
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

  const trust = resolveApiUrlTrust(env, configFile, join(dir, "veryfront.json"));
  const apiUrl = trust.apiUrl;

  let { apiToken, apiTokenSource } = await resolveApiTokenForMode(
    env,
    configFile,
    interactive,
    trust,
  );

  if (!apiToken && trust.repositorySteered) {
    throw new UntrustedApiUrlCredentialError(
      describeUntrustedApiUrl(trust),
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
