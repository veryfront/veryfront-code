import type { RuntimeAdapter } from "#veryfront/platform";
import { detectPlatform } from "#veryfront/platform/core-platform.ts";
import * as pathHelper from "#veryfront/compat/path";
import { importModule } from "./transpiler.ts";

interface ImportDiscoveryModuleOptions {
  adapter: RuntimeAdapter;
  projectDir?: string;
}

function normalizeModulePath(filePath: string): string {
  return filePath.startsWith("file://") ? filePath : `file://${filePath}`;
}

function resolveModulePath(filePath: string, projectDir?: string): string {
  if (filePath.startsWith("file://")) return filePath;
  if (pathHelper.isAbsolute(filePath)) return normalizeModulePath(filePath);
  if (!projectDir || projectDir === "." || projectDir === "") {
    return normalizeModulePath(`/${filePath.replace(/^\/+/, "")}`);
  }

  return normalizeModulePath(pathHelper.join(projectDir, filePath));
}

export async function importDiscoveryModule(
  filePath: string,
  options: ImportDiscoveryModuleOptions,
): Promise<Record<string, unknown>> {
  const module = await importModule(resolveModulePath(filePath, options.projectDir), {
    platform: detectPlatform(),
    fsAdapter: options.adapter.fs,
    baseDir: options.projectDir || ".",
  });

  return module as Record<string, unknown>;
}
