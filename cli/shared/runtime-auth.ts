import { deleteEnv, deleteHostSecret, getEnv, setEnv, setHostSecret } from "#cli/process-env";
import { readToken } from "#cli/auth/token-store";
import { getEnvironmentConfig } from "veryfront/config";
import { refreshEnvironmentConfig } from "#cli/environment-config";
import {
  getEnvSource,
  markConfigFileSource,
  markEnvFileSource,
  markProcessEnvSource,
} from "veryfront/utils/env-loader";
import { join } from "veryfront/platform/path";
import {
  DEFAULT_API_URL,
  getApiUrl,
  isSameApiEndpoint,
  resolveRestApiBaseUrl,
} from "./constants.ts";
import {
  type ApiCredentialCandidate,
  type ApiTokenSource,
  assertApiUrlAcceptsNewCredential,
  readConfigFile,
  resolveApiCredentialCandidatesForAuth,
  resolveApiUrlTrust,
} from "./config.ts";
import { readProjectLink } from "./project-link.ts";
import { createVeryfrontApiOriginBoundOutboundFetch } from "#cli/outbound-fetch";
import { checkCredential } from "./credential-check.ts";
import { rememberAcceptedLogin, wasLoginAcceptedRecently } from "#cli/auth/token-store";

export interface RuntimeAuthOptions {
  linkedProjectSlug?: string;
  /** Prequalified credential, or null when no credential is authorized. */
  apiToken?: string | null;
  /** Provenance of the prequalified credential. */
  apiTokenSource?: ApiTokenSource;
  /** REST base paired with apiToken. */
  apiBaseUrl?: string;
}

export interface RuntimeAuthContext {
  apiToken?: string;
  apiTokenSource?: ApiTokenSource;
  apiBaseUrl?: string;
  projectSlug?: string;
  serviceLayer?: string;
}

// Captured before project code runs: `resolveRuntimeAuthContext` passes the
// stored login token through this normalizer before it is registered
// host-privately, so a project config that replaces `String.prototype.trim` —
// or `Reflect.apply` itself — must not observe the credential from the method
// receiver or the apply arguments.
const applyIntrinsic = Reflect.apply;
const stringTrim = String.prototype.trim;

function normalizeEnvValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = applyIntrinsic(stringTrim, value, []) as string;
  return normalized ? normalized : undefined;
}

function runtimeApiBaseUrl(
  value: string | undefined,
): string | undefined {
  const normalized = normalizeEnvValue(value);
  return normalized ? resolveRestApiBaseUrl(normalized, false) : undefined;
}

export async function resolveLinkedProjectSlug(
  projectDir: string,
  configuredProjectSlug?: string,
): Promise<string | undefined> {
  const configured = normalizeEnvValue(configuredProjectSlug);
  if (configured) return configured;

  const configProjectSlug = normalizeEnvValue((await readConfigFile(projectDir))?.projectSlug);
  if (configProjectSlug) return configProjectSlug;

  return normalizeEnvValue((await readProjectLink(projectDir))?.projectSlug);
}

export async function resolveRuntimeAuthContext(
  options: RuntimeAuthOptions,
): Promise<RuntimeAuthContext> {
  const suppliedToken = normalizeEnvValue(options.apiToken ?? undefined);
  const envToken = options.apiToken === undefined
    ? normalizeEnvValue(getEnv("VERYFRONT_API_TOKEN"))
    : undefined;
  const storedToken = options.apiToken === undefined && !envToken
    ? normalizeEnvValue(await readToken() ?? undefined)
    : undefined;
  const apiToken = suppliedToken ?? envToken ?? storedToken;
  const apiTokenSource = apiToken
    ? options.apiTokenSource ?? (storedToken ? "token-store" : "env")
    : undefined;
  const apiBaseUrl = normalizeEnvValue(options.apiBaseUrl);

  const envProjectSlug = normalizeEnvValue(getEnv("VERYFRONT_PROJECT_SLUG"));
  const projectSlug = envProjectSlug ?? normalizeEnvValue(options.linkedProjectSlug);
  const envServiceLayer = normalizeEnvValue(getEnv("VERYFRONT_SERVICE_LAYER"));
  const serviceLayer = envServiceLayer ?? (apiToken ? "cloud" : undefined);

  return {
    ...(apiToken ? { apiToken } : {}),
    ...(apiTokenSource ? { apiTokenSource } : {}),
    ...(apiToken && apiBaseUrl ? { apiBaseUrl } : {}),
    ...(projectSlug ? { projectSlug } : {}),
    ...(serviceLayer ? { serviceLayer } : {}),
  };
}

export async function applyRuntimeAuthContext(
  options: RuntimeAuthOptions,
): Promise<RuntimeAuthContext> {
  const context = await resolveRuntimeAuthContext(options);

  // The token is registered host-privately rather than with `setEnv`. `dev`
  // and `start` import project route modules into this very process, so a
  // process-wide `VERYFRONT_API_TOKEN` would hand the developer's stored
  // Veryfront Cloud login token to any project-authored code that reads
  // `Deno.env.get()` or `getEnv()`. Framework code reads it back through
  // `getHostEnv()`/`getHostSecret()`, neither of which project code can reach.
  // A token the developer exported themselves stays in the environment.
  if (context.apiToken && context.apiTokenSource === "token-store") {
    setHostSecret("VERYFRONT_API_TOKEN", context.apiToken);
  } else if (context.apiToken) {
    deleteHostSecret("VERYFRONT_API_TOKEN");
    setEnv("VERYFRONT_API_TOKEN", context.apiToken);
  } else if (options.apiToken === null) {
    deleteHostSecret("VERYFRONT_API_TOKEN");
  }

  if (context.apiToken && context.apiBaseUrl) {
    setEnv("VERYFRONT_API_BASE_URL", context.apiBaseUrl);
  }

  if (
    context.apiToken && context.projectSlug && !normalizeEnvValue(getEnv("VERYFRONT_PROJECT_SLUG"))
  ) {
    setEnv("VERYFRONT_PROJECT_SLUG", context.projectSlug);
  }

  if (
    context.apiToken && context.serviceLayer &&
    !normalizeEnvValue(getEnv("VERYFRONT_SERVICE_LAYER"))
  ) {
    setEnv("VERYFRONT_SERVICE_LAYER", context.serviceLayer);
  }

  return context;
}

/** Resolve and apply one token together with the REST endpoint allowed to receive it. */
export async function applyQualifiedRuntimeAuth(
  projectDir: string,
  linkedProjectSlug?: string,
): Promise<RuntimeAuthContext> {
  const env = getEnvironmentConfig();
  const configPath = join(projectDir, "veryfront.json");
  const configFile = await readConfigFile(projectDir);
  const apiBaseSource = getEnvSource("VERYFRONT_API_BASE_URL");
  const apiTokenSource = getEnvSource("VERYFRONT_API_TOKEN");
  const staleConfigToken = apiTokenSource.source === "config-file" &&
    (apiTokenSource.file !== configPath || configFile?.apiToken === undefined ||
      normalizeEnvValue(getEnv("VERYFRONT_API_TOKEN")) !== normalizeEnvValue(configFile.apiToken));
  const staleConfigBase = apiBaseSource.source === "config-file" &&
    (apiBaseSource.file !== configPath || configFile?.apiUrl === undefined ||
      normalizeEnvValue(configFile.apiToken) === undefined ||
      !resolveApiUrlTrust(env, configFile, configPath).steeringConfigFile);
  let requestEnv = env;
  if (apiBaseSource.source !== "unset") requestEnv = { ...env, apiUrl: undefined };
  if (staleConfigBase) requestEnv = { ...env, apiBaseUrl: DEFAULT_API_URL, apiUrl: undefined };
  const candidates = await resolveApiCredentialCandidatesForAuth(requestEnv, projectDir, false);
  const candidate = candidates[0];
  const trust = resolveApiUrlTrust(requestEnv, configFile, configPath);
  if (
    !candidate &&
    trust.repositorySteered &&
    !staleConfigBase
  ) {
    await assertApiUrlAcceptsNewCredential(requestEnv, projectDir);
  }
  clearStaleRuntimeAuth(staleConfigBase, staleConfigToken);
  const runtimeCandidate = await dropRejectedStoredLogin(candidate, linkedProjectSlug);
  const candidateApiBaseUrl = runtimeApiBaseUrl(runtimeCandidate?.validationEnv.apiBaseUrl);
  const preservesImplicitDefault = candidateApiBaseUrl !== undefined &&
    isSameApiEndpoint(candidateApiBaseUrl, DEFAULT_API_URL) &&
    (apiBaseSource.source === "unset" || staleConfigBase) && env.apiUrl === undefined;
  const context = await applyRuntimeAuthContext({
    apiToken: runtimeCandidate?.apiToken ?? null,
    apiTokenSource: runtimeCandidate?.apiTokenSource,
    apiBaseUrl: preservesImplicitDefault ? undefined : candidateApiBaseUrl,
    linkedProjectSlug,
  });
  markTrustedRuntimeEndpoint(context, trust, runtimeCandidate?.apiTokenSource, projectDir);
  updateRuntimeAuthProvenance(
    apiBaseSource.source,
    runtimeCandidate?.apiTokenSource,
    configFile?.apiUrl,
    configPath,
    runtimeCandidate !== undefined,
  );
  refreshEnvironmentConfig();
  return context;
}

/**
 * Key of the provider a run with no model uses once Cloud is off:
 * `DEFAULT_AGENT_MODEL` (src/agent/runtime/model-resolution.ts) is an OpenAI
 * model, and a key for another provider cannot serve it.
 */
const DEFAULT_MODEL_PROVIDER_KEY = "OPENAI_API_KEY";

/** Upper bound on the stored-login check, so a slow API cannot stall startup. */
const STORED_LOGIN_CHECK_TIMEOUT_MS = 5_000;

/**
 * Stored logins (API URL and token) the API rejected in this process. A
 * command may qualify its auth more than once; a later check that cannot
 * reach the API must not bring a rejected login back.
 */
const rejectedStoredLogins = new Set<string>();
// Captured before project code runs: the set holds stored login tokens.
const setHas = Set.prototype.has;
const setAdd = Set.prototype.add;

/**
 * Drop a stored login the API rejects when a direct provider key serves the
 * runs instead. Cloud would refuse every run anyway, and keeping the login
 * routes runs with no model through it. A login that is valid, cannot be
 * checked, or was chosen explicitly (an exported token or service layer) is
 * kept, and so is any login when no key serves the default model or the
 * project is linked: a linked project runs through Cloud and must prompt a
 * fresh login.
 */
async function dropRejectedStoredLogin(
  candidate: ApiCredentialCandidate | undefined,
  linkedProjectSlug: string | undefined,
): Promise<ApiCredentialCandidate | undefined> {
  if (
    candidate?.apiTokenSource !== "token-store" ||
    normalizeEnvValue(linkedProjectSlug) ||
    normalizeEnvValue(getEnv("VERYFRONT_PROJECT_SLUG")) ||
    normalizeEnvValue(getEnv("VERYFRONT_SERVICE_LAYER")) ||
    !normalizeEnvValue(getEnv(DEFAULT_MODEL_PROVIDER_KEY))
  ) {
    return candidate;
  }
  try {
    const apiUrl = getApiUrl(candidate.validationEnv);
    const loginKey = `${apiUrl}\n${candidate.apiToken}`;
    if (applyIntrinsic(setHas, rejectedStoredLogins, [loginKey])) return undefined;
    if (await wasLoginAcceptedRecently(apiUrl, candidate.apiToken)) return candidate;
    const transport = createVeryfrontApiOriginBoundOutboundFetch(apiUrl);
    const answer = await checkCredential(
      candidate.apiToken,
      apiUrl,
      transport,
      STORED_LOGIN_CHECK_TIMEOUT_MS,
    );
    if (answer === "accepted") await rememberAcceptedLogin(apiUrl, candidate.apiToken);
    if (answer !== "rejected") return candidate;
    applyIntrinsic(setAdd, rejectedStoredLogins, [loginKey]);
    return undefined;
  } catch {
    return candidate;
  }
}

function updateRuntimeAuthProvenance(
  apiBaseSource: string,
  tokenSource: string | undefined,
  configApiUrl: string | undefined,
  configPath: string,
  hasCandidate: boolean,
): void {
  if (tokenSource === "config-file") markConfigFileSource("VERYFRONT_API_TOKEN", configPath);
  if (apiBaseSource !== "config-file") return;
  if (tokenSource === "config-file" && configApiUrl === undefined) {
    markProcessEnvSource("VERYFRONT_API_BASE_URL");
    return;
  }
  if (tokenSource === "config-file") return;
  deleteEnv("VERYFRONT_API_BASE_URL");
  if (!hasCandidate) deleteEnv("VERYFRONT_API_TOKEN");
  markProcessEnvSource("VERYFRONT_API_BASE_URL");
  markProcessEnvSource("VERYFRONT_API_TOKEN");
}

function clearStaleRuntimeAuth(staleConfigBase: boolean, staleConfigToken: boolean): void {
  if (staleConfigBase) deleteEnv("VERYFRONT_API_BASE_URL");
  if (!staleConfigToken) return;
  deleteEnv("VERYFRONT_API_TOKEN");
  markProcessEnvSource("VERYFRONT_API_TOKEN");
}

function markTrustedRuntimeEndpoint(
  context: RuntimeAuthContext,
  trust: ReturnType<typeof resolveApiUrlTrust>,
  tokenSource: string | undefined,
  projectDir: string,
): void {
  if (!context.apiBaseUrl || !trust.repositorySteered) return;
  const source = trust.steeringEnvFile ?? join(projectDir, "veryfront.json");
  if (trust.steeringConfigFile && tokenSource === "config-file") {
    markConfigFileSource("VERYFRONT_API_BASE_URL", source);
    markConfigFileSource("VERYFRONT_API_TOKEN", source);
  } else if (trust.steeringEnvFile) {
    markEnvFileSource("VERYFRONT_API_BASE_URL", source);
  }
}
