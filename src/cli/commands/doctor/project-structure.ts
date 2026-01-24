import { exists } from "#std/fs.ts";
import { join } from "#veryfront/platform/compat/path/index.ts";
import { getConfig } from "#veryfront/config";
import type { DiagnosticResult } from "./types.ts";

export async function checkProjectStructure(projectDir: string): Promise<DiagnosticResult[]> {
  const requiredFiles = ["pages", "pages/index.mdx"];
  const results: DiagnosticResult[] = [];

  for (const file of requiredFiles) {
    const filePath = join(projectDir, file);
    const found = await exists(filePath);

    results.push({
      name: `Project Structure (${file})`,
      status: found ? "pass" : "warn",
      message: found ? "Found" : "Not found",
      details: !found && file === "pages/index.mdx"
        ? "Create an index.mdx file in your pages directory"
        : undefined,
    });
  }

  return results;
}

export async function checkConfiguration(projectDir: string): Promise<DiagnosticResult> {
  try {
    const { runtime } = await import("#veryfront/platform/adapters/detect.ts");
    const adapter = await runtime.get();
    const config = await getConfig(projectDir, adapter);
    const reactVersion = (config as { react?: { version?: string } }).react?.version ?? "auto";

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
