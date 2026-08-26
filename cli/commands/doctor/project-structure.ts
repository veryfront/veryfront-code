import { exists } from "#std/fs.ts";
import { join } from "veryfront/platform/path";
import { getConfig } from "veryfront/config";
import type { DiagnosticResult } from "./types.ts";
import { loadConfigOrNull } from "./project-config.ts";

/**
 * Reports which router directory the project uses.
 *
 * Route discovery accepts either router (`app/` or `pages/`, honoring
 * `directories` overrides), so the check passes when either one is present and
 * warns only when the project has no routes at all.
 */
export async function checkProjectStructure(projectDir: string): Promise<DiagnosticResult[]> {
  const config = await loadConfigOrNull(projectDir);
  const appDir = config?.directories?.app ?? "app";
  const pagesDir = config?.directories?.pages ?? "pages";

  const [hasApp, hasPages] = await Promise.all([
    exists(join(projectDir, appDir)),
    exists(join(projectDir, pagesDir)),
  ]);

  const routers: string[] = [];
  if (hasApp) routers.push(`${appDir}/`);
  if (hasPages) routers.push(`${pagesDir}/`);

  if (routers.length === 0) {
    return [{
      name: "Project Structure",
      status: "warn",
      message: `No ${appDir}/ or ${pagesDir}/ directory found`,
      details: `Add ${appDir}/page.tsx to create your first route`,
    }];
  }

  return [{
    name: "Project Structure",
    status: "pass",
    message: `Found ${routers.join(", ")}`,
  }];
}

export async function checkConfiguration(projectDir: string): Promise<DiagnosticResult> {
  try {
    const { runtime } = await import("#cli/runtime-adapter");
    const adapter = await runtime.get();
    const config = await getConfig(projectDir, adapter);
    const reactVersion = config?.react?.version ?? "auto";

    return {
      name: "Configuration",
      status: "pass",
      message: `Loaded (React ${reactVersion})`,
    };
  } catch (error) {
    return {
      name: "Configuration",
      status: "warn",
      message: "Using defaults",
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

export function checkCacheSystem(): Promise<DiagnosticResult> {
  return Promise.resolve({
    name: "Cache System",
    status: "pass",
    message: "Managed automatically via Veryfront's built-in LRU cache",
    details: "No manual cache adapter configuration required.",
  });
}
