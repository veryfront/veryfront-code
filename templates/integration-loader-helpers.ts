import type { EnvVarConfig, IntegrationName, ResolvedIntegration, TemplateFile } from "./types.ts";

export function buildUnknownIntegrationErrors(
  integrations: IntegrationName[],
  availableIntegrations: readonly IntegrationName[],
): string[] {
  const availableList = availableIntegrations.join(", ");
  return integrations
    .filter((integration) => !availableIntegrations.includes(integration))
    .map((integration) => `Unknown integration: ${integration}. Available: ${availableList}`);
}

/**
 * Give integration-owned output files stable, collision-free project paths.
 *
 * Tool modules stay directly under the project `tools/` root — prefixed with the
 * owning integration — so their `../lib/...` imports keep resolving. Provider env
 * examples move under `examples/env/`, because the root `.env.example` is
 * synthesized from connector metadata and would otherwise be claimed by whichever
 * integration merged last.
 */
export function namespaceIntegrationTemplateFiles(
  integrationName: IntegrationName,
  files: readonly TemplateFile[],
): TemplateFile[] {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(integrationName)) {
    throw new Error(`Invalid integration template namespace: ${integrationName}`);
  }

  return files.map((file) => {
    if (file.path === ".env.example" || file.path === "_env.example") {
      return { ...file, path: `examples/env/${integrationName}.env.example` };
    }

    if (file.path.startsWith("tools/")) {
      const relativePath = file.path.slice("tools/".length);
      if (!relativePath || relativePath.includes("/")) {
        throw new Error(`Integration tool paths must be direct children of tools/: ${file.path}`);
      }
      return { ...file, path: `tools/${integrationName}-${relativePath}` };
    }

    return { ...file };
  });
}

export function mergeIntegrationFiles(
  integrations: Array<{ files: TemplateFile[] }>,
): TemplateFile[] {
  const fileMap = new Map<string, TemplateFile>();

  for (const integration of integrations) {
    for (const file of integration.files) {
      if (fileMap.has(file.path)) {
        throw new Error(`Integration template file collision at ${file.path}`);
      }
      fileMap.set(file.path, file);
    }
  }

  return [...fileMap.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function hasOAuthRoute(integration: Pick<ResolvedIntegration, "config" | "files">): boolean {
  const authRoute = `app/api/auth/${integration.config.name}/route.ts`;
  return integration.files.some((file) => file.path === authRoute);
}

const OAUTH_CLIENT_ENV_VAR = /_CLIENT_(ID|SECRET)$/;

/**
 * The env contract of an integration's local scaffold. `scaffoldRequired`,
 * when set, overrides the hosted connector's `required`: the local client may
 * need a variable the hosted connector does not read, or the reverse. An OAuth
 * client credential is not required when the scaffold has no OAuth route.
 */
export function scaffoldEnvVars(
  integration: Pick<ResolvedIntegration, "config" | "files">,
): EnvVarConfig[] {
  // Without scaffold files there is no local client to read any variable.
  if (!integration.files.length) return [];
  const usesOAuth = hasOAuthRoute(integration);
  return (integration.config.envVars ?? []).map(({ scaffoldRequired, ...envVar }) => ({
    ...envVar,
    required: scaffoldRequired ??
      (envVar.required && (usesOAuth || !OAUTH_CLIENT_ENV_VAR.test(envVar.name))),
  }));
}

/**
 * Env vars that make an env-backed scaffold usable, or null when the scaffold
 * connects through its own `/api/auth/<id>` OAuth route.
 */
export function requiredSetupEnvVars(
  integration: Pick<ResolvedIntegration, "config" | "files">,
): string[] | null {
  if (hasOAuthRoute(integration)) return null;
  return scaffoldEnvVars(integration)
    .filter((envVar) => envVar.required && envVar.default === undefined)
    .map((envVar) => envVar.name);
}
