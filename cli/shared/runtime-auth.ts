import { deleteEnv, getEnv, setEnv } from "#cli/process-env";
import { getEnvironmentConfig } from "veryfront/config";
import { refreshEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import {
  getEnvSource,
  markConfigFileSource,
  markEnvFileSource,
  markProcessEnvSource,
} from "veryfront/utils/env-loader";
import { join } from "veryfront/platform/path";
import { DEFAULT_API_URL, isSameApiEndpoint, resolveRestApiBaseUrl } from "./constants.ts";
import {
  assertApiUrlAcceptsNewCredential,
  readConfigFile,
  resolveApiCredentialCandidatesForAuth,
  resolveApiUrlTrust,
} from "./config.ts";
import { readProjectLink } from "./project-link.ts";

export interface RuntimeAuthOptions {
  linkedProjectSlug?: string;
  /** Prequalified credential, or null when no credential is authorized. */
  apiToken: string | null;
  /** REST base paired with apiToken. */
  apiBaseUrl?: string;
}

export interface RuntimeAuthContext {
  apiToken?: string;
  apiBaseUrl?: string;
  projectSlug?: string;
  serviceLayer?: string;
}

function normalizeEnvValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
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
  const apiToken = normalizeEnvValue(options.apiToken ?? undefined);
  const apiBaseUrl = normalizeEnvValue(options.apiBaseUrl);

  const envProjectSlug = normalizeEnvValue(getEnv("VERYFRONT_PROJECT_SLUG"));
  const projectSlug = envProjectSlug ?? normalizeEnvValue(options.linkedProjectSlug);
  const envServiceLayer = normalizeEnvValue(getEnv("VERYFRONT_SERVICE_LAYER"));
  const serviceLayer = envServiceLayer ?? (apiToken ? "cloud" : undefined);

  return {
    ...(apiToken ? { apiToken } : {}),
    ...(apiToken && apiBaseUrl ? { apiBaseUrl } : {}),
    ...(projectSlug ? { projectSlug } : {}),
    ...(serviceLayer ? { serviceLayer } : {}),
  };
}

export async function applyRuntimeAuthContext(
  options: RuntimeAuthOptions,
): Promise<RuntimeAuthContext> {
  const context = await resolveRuntimeAuthContext(options);

  if (context.apiToken) {
    setEnv("VERYFRONT_API_TOKEN", context.apiToken);
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
      configFile.apiToken === undefined ||
      !resolveApiUrlTrust(env, configFile, configPath).steeringConfigFile);
  const requestEnv = apiBaseSource.source === "unset"
    ? env
    : staleConfigBase
    ? { ...env, apiBaseUrl: DEFAULT_API_URL, apiUrl: undefined }
    : { ...env, apiUrl: undefined };
  const candidates = await resolveApiCredentialCandidatesForAuth(requestEnv, projectDir, false);
  const candidate = candidates[0];
  const trust = resolveApiUrlTrust(requestEnv, configFile, configPath);
  if (
    !candidate &&
    trust.repositorySteered
  ) {
    await assertApiUrlAcceptsNewCredential(requestEnv, projectDir);
  }
  if (staleConfigBase) deleteEnv("VERYFRONT_API_BASE_URL");
  if (staleConfigToken) {
    deleteEnv("VERYFRONT_API_TOKEN");
    markProcessEnvSource("VERYFRONT_API_TOKEN");
  }
  const candidateApiBaseUrl = runtimeApiBaseUrl(candidate?.validationEnv.apiBaseUrl);
  const preservesImplicitDefault = candidateApiBaseUrl !== undefined &&
    isSameApiEndpoint(candidateApiBaseUrl, DEFAULT_API_URL) &&
    (apiBaseSource.source === "unset" || staleConfigBase) && env.apiUrl === undefined;
  const context = await applyRuntimeAuthContext({
    apiToken: candidate?.apiToken ?? null,
    apiBaseUrl: preservesImplicitDefault ? undefined : candidateApiBaseUrl,
    linkedProjectSlug,
  });
  if (context.apiBaseUrl && trust.repositorySteered) {
    const source = trust.steeringEnvFile ?? join(projectDir, "veryfront.json");
    if (trust.steeringConfigFile && candidate?.apiTokenSource === "config-file") {
      markConfigFileSource("VERYFRONT_API_BASE_URL", source);
      markConfigFileSource("VERYFRONT_API_TOKEN", source);
    } else if (trust.steeringEnvFile) {
      markEnvFileSource("VERYFRONT_API_BASE_URL", source);
    }
  }
  if (candidate?.apiTokenSource === "config-file") {
    markConfigFileSource("VERYFRONT_API_TOKEN", configPath);
  }
  if (
    apiBaseSource.source === "config-file" && candidate?.apiTokenSource === "config-file" &&
    configFile?.apiUrl === undefined
  ) {
    markProcessEnvSource("VERYFRONT_API_BASE_URL");
  }
  if (apiBaseSource.source === "config-file" && candidate?.apiTokenSource !== "config-file") {
    if (!candidate) {
      deleteEnv("VERYFRONT_API_BASE_URL");
      deleteEnv("VERYFRONT_API_TOKEN");
    }
    markProcessEnvSource("VERYFRONT_API_BASE_URL");
    markProcessEnvSource("VERYFRONT_API_TOKEN");
  }
  refreshEnvironmentConfig();
  return context;
}
