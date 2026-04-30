/**
 * Extension validate command — check an extension for shape and capability issues.
 *
 * @module cli/commands/extension/validate-command
 */

import { validateExtension } from "veryfront/extensions";

export interface ValidationReport {
  valid: boolean;
  issues: string[];
}

/**
 * Validate an extension at the given directory path.
 */
export async function validateExtensionAtPath(
  extensionPath: string,
): Promise<ValidationReport> {
  const issues: string[] = [];

  const candidates = [
    `${extensionPath}/src/index.ts`,
    `${extensionPath}/index.ts`,
  ];

  let entryPoint: string | undefined;
  for (const candidate of candidates) {
    try {
      const stat = await Deno.stat(candidate);
      if (stat.isFile) {
        entryPoint = candidate;
        break;
      }
    } catch { /* next candidate */ }
  }

  if (!entryPoint) {
    issues.push(`No entry point found. Expected src/index.ts or index.ts in ${extensionPath}`);
    return { valid: false, issues };
  }

  try {
    const mod = await import(`file://${await Deno.realPath(entryPoint)}`);
    const factory = mod.default;

    if (typeof factory !== "function") {
      issues.push("Default export must be a function (ExtensionFactory).");
      return { valid: false, issues };
    }

    const ext = factory();
    issues.push(...validateExtension(ext));
  } catch (err) {
    issues.push(`Failed to import extension: ${(err as Error).message}`);
  }

  return { valid: issues.length === 0, issues };
}

/**
 * CLI entry point for `veryfront extension validate <path>`.
 */
export async function runExtensionValidate(extensionPath: string): Promise<void> {
  const report = await validateExtensionAtPath(extensionPath);

  if (report.valid) {
    console.log("Extension is valid.");
  } else {
    console.error("Extension validation failed:");
    for (const issue of report.issues) {
      console.error(`  - ${issue}`);
    }
    Deno.exit(1);
  }
}
