import { getEnv, setEnv } from "#cli/process-env";
import { readToken } from "../auth/token-store.ts";
import { readConfigFile } from "./config.ts";
import { readProjectLink } from "./project-link.ts";

export interface RuntimeAuthOptions {
  linkedProjectSlug?: string;
  /** Prequalified credential, or null to suppress ambient stored-login fallback. */
  apiToken?: string | null;
}

export interface RuntimeAuthContext {
  apiToken?: string;
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
  const apiToken = options.apiToken === undefined
    ? normalizeEnvValue(getEnv("VERYFRONT_API_TOKEN")) ??
      normalizeEnvValue(await readToken() ?? undefined)
    : normalizeEnvValue(options.apiToken ?? undefined);

  const envProjectSlug = normalizeEnvValue(getEnv("VERYFRONT_PROJECT_SLUG"));
  const projectSlug = envProjectSlug ?? normalizeEnvValue(options.linkedProjectSlug);
  const envServiceLayer = normalizeEnvValue(getEnv("VERYFRONT_SERVICE_LAYER"));
  const serviceLayer = envServiceLayer ?? (apiToken ? "cloud" : undefined);

  return {
    ...(apiToken ? { apiToken } : {}),
    ...(projectSlug ? { projectSlug } : {}),
    ...(serviceLayer ? { serviceLayer } : {}),
  };
}

export async function applyRuntimeAuthContext(
  options: RuntimeAuthOptions,
): Promise<RuntimeAuthContext> {
  const context = await resolveRuntimeAuthContext(options);

  if (context.apiToken && !normalizeEnvValue(getEnv("VERYFRONT_API_TOKEN"))) {
    setEnv("VERYFRONT_API_TOKEN", context.apiToken);
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
