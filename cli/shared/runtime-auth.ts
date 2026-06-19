import { getEnv, setEnv } from "veryfront/platform";
import { basename } from "veryfront/platform/path";
import { readToken } from "../auth/token-store.ts";

export interface RuntimeAuthOptions {
  projectDir: string;
  projectSlug?: string;
}

export interface RuntimeAuthContext {
  apiToken?: string;
  projectSlug?: string;
}

function normalizeEnvValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function inferRuntimeProjectSlug(projectDir: string): string | undefined {
  const dirName = basename(projectDir).replace(/^@[^/]+[/\\]/, "");
  const slug = dirName.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  return slug || undefined;
}

export async function resolveRuntimeAuthContext(
  options: RuntimeAuthOptions,
): Promise<RuntimeAuthContext> {
  const envToken = normalizeEnvValue(getEnv("VERYFRONT_API_TOKEN"));
  const storedToken = envToken ? undefined : normalizeEnvValue(await readToken() ?? undefined);
  const apiToken = envToken ?? storedToken;

  const envProjectSlug = normalizeEnvValue(getEnv("VERYFRONT_PROJECT_SLUG"));
  const projectSlug = envProjectSlug ?? normalizeEnvValue(options.projectSlug) ??
    inferRuntimeProjectSlug(options.projectDir);

  return {
    ...(apiToken ? { apiToken } : {}),
    ...(projectSlug ? { projectSlug } : {}),
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

  return context;
}
