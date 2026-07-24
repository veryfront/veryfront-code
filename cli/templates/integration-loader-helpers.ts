import { join } from "veryfront/fs";
import type { IntegrationName, TemplateFile } from "./types.ts";

export function resolveIntegrationModuleDir(
  moduleUrl: string,
  platform = typeof process !== "undefined" ? process.platform : undefined,
): string {
  const normalizedModuleUrl = new URL(".", moduleUrl);

  if (normalizedModuleUrl.protocol !== "file:") return normalizedModuleUrl.href;

  let moduleDir = normalizedModuleUrl.pathname;
  if (platform === "win32" && moduleDir.startsWith("/")) {
    moduleDir = moduleDir.slice(1);
  }

  return moduleDir;
}

export function buildIntegrationDirectory(
  moduleDir: string,
  integrationName: string,
): string {
  return join(moduleDir, "integrations", integrationName);
}

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
 * Tool modules remain at the project `tools/` root so their existing relative
 * imports stay valid. Provider setup examples are retained outside the
 * generated root `.env.example`, which is synthesized from connector metadata.
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
      return {
        ...file,
        path: `examples/env/${integrationName}.env.example`,
      };
    }
    if (file.path.startsWith("tools/")) {
      const relativePath = file.path.slice("tools/".length);
      if (!relativePath || relativePath.includes("/")) {
        throw new Error(
          `Integration tool paths must be direct children of tools/: ${file.path}`,
        );
      }
      return {
        ...file,
        path: `tools/${integrationName}-${relativePath}`,
      };
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
        throw new Error(
          `Integration template file collision at ${file.path}`,
        );
      }
      fileMap.set(file.path, file);
    }
  }

  return [...fileMap.values()].sort((a, b) => a.path.localeCompare(b.path));
}
