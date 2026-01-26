import { exists } from "../../../../deps/deno.land/std@0.220.0/fs/mod.js";
import { join } from "../../../platform/compat/path/index.js";
import { getConfig } from "../../../config/index.js";
import type { DiagnosticResult } from "./types.js";

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
    const { runtime } = await import("../../../platform/adapters/detect.js");
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
