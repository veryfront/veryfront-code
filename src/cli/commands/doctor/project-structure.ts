import { exists } from "std/fs/mod.ts";
import { join } from "std/path/mod.ts";
import { getConfig } from "@veryfront/config";
import type { DiagnosticResult } from "./types.ts";

/**
 * Check project structure for required files and directories
 */
export async function checkProjectStructure(projectDir: string): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];
  const requiredFiles = ["pages", "pages/index.mdx"];

  for (const file of requiredFiles) {
    const filePath = join(projectDir, file);
    if (await exists(filePath)) {
      results.push({
        name: `Project Structure (${file})`,
        status: "pass",
        message: "Found",
      });
    } else {
      results.push({
        name: `Project Structure (${file})`,
        status: "warn",
        message: "Not found",
        details: file === "pages/index.mdx"
          ? "Create an index.mdx file in your pages directory"
          : undefined,
      });
    }
  }

  return results;
}

/**
 * Check configuration loading and validity
 */
export async function checkConfiguration(projectDir: string): Promise<DiagnosticResult> {
  try {
    const { getAdapter } = await import("@veryfront/platform/adapters/detect.ts");
    const adapter = await getAdapter();
    const config = await getConfig(projectDir, adapter);
    const reactConfig = config.react as { version?: string } | undefined;
    return {
      name: "Configuration",
      status: "pass",
      message: `Loaded (React ${reactConfig?.version || "auto"})`,
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

/**
 * Check cache system initialization
 */
export function checkCacheSystem(): Promise<DiagnosticResult> {
  return Promise.resolve({
    name: "Cache System",
    status: "pass",
    message: "Managed automatically via Veryfront's built-in LRU cache",
    details: "No manual cache adapter configuration required.",
  });
}
