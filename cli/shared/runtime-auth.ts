import { getEnv, setEnv } from "#cli/process-env";
import { getEnvironmentConfig } from "veryfront/config";
import { getEnvSource } from "veryfront/utils/env-loader";
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
  const requestEnv = getEnvSource("VERYFRONT_API_BASE_URL").source === "unset"
    ? env
    : { ...env, apiUrl: undefined };
  const candidates = await resolveApiCredentialCandidatesForAuth(requestEnv, projectDir, false);
  const candidate = candidates[0];
  const repositorySelectedApiEnvironment =
    getEnvSource("VERYFRONT_API_URL").source === "env-file" ||
    getEnvSource("VERYFRONT_API_BASE_URL").source === "env-file";
  if (
    !candidate &&
    resolveApiUrlTrust(requestEnv, await readConfigFile(projectDir)).repositorySteered
  ) {
    await assertApiUrlAcceptsNewCredential(requestEnv, projectDir);
  }
  return await applyRuntimeAuthContext({
    apiToken: candidate?.apiToken ?? null,
    apiBaseUrl: repositorySelectedApiEnvironment ? undefined : candidate?.validationEnv.apiBaseUrl,
    linkedProjectSlug,
  });
}
