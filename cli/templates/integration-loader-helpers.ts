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

export function mergeIntegrationFiles(
  integrations: Array<{ files: TemplateFile[] }>,
): TemplateFile[] {
  const fileMap = new Map<string, TemplateFile>();

  for (const integration of integrations) {
    for (const file of integration.files) {
      fileMap.set(file.path, file);
    }
  }

  return [...fileMap.values()].sort((a, b) => a.path.localeCompare(b.path));
}
