import { getEnv, setEnv, setHostSecret } from "#cli/process-env";
import { readToken } from "../auth/token-store.ts";
import { readConfigFile } from "./config.ts";
import { readProjectLink } from "./project-link.ts";

export interface RuntimeAuthOptions {
  linkedProjectSlug?: string;
}

export interface RuntimeAuthContext {
  apiToken?: string;
  apiTokenSource?: "environment" | "token-store";
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
  const envToken = normalizeEnvValue(getEnv("VERYFRONT_API_TOKEN"));
  const storedToken = envToken ? undefined : normalizeEnvValue(await readToken() ?? undefined);
  const apiToken = envToken ?? storedToken;

  const envProjectSlug = normalizeEnvValue(getEnv("VERYFRONT_PROJECT_SLUG"));
  const projectSlug = envProjectSlug ?? normalizeEnvValue(options.linkedProjectSlug);
  const envServiceLayer = normalizeEnvValue(getEnv("VERYFRONT_SERVICE_LAYER"));
  const serviceLayer = envServiceLayer ?? (apiToken ? "cloud" : undefined);

  return {
    ...(apiToken ? { apiToken } : {}),
    ...(apiToken ? { apiTokenSource: envToken ? "environment" : "token-store" as const } : {}),
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
  if (context.apiToken && !normalizeEnvValue(getEnv("VERYFRONT_API_TOKEN"))) {
    setHostSecret("VERYFRONT_API_TOKEN", context.apiToken);
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
