/**
 * Open Veryfront Studio in browser
 * @module cli/commands/studio
 */

import { openBrowser, canOpenBrowser } from "../auth/browser.ts";
import { readConfigFile } from "../shared/config.ts";
import { cwd, getEnv } from "@veryfront/platform/compat/process.ts";
import { join } from "@veryfront/platform/compat/path/index.ts";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
import { cliLogger } from "@veryfront/utils";

/**
 * Build Studio URL with optional query params
 */
export function buildStudioUrl(
  project: string,
  options: { branch?: string; file?: string } = {},
): string {
  const base = `https://veryfront.com/projects/${encodeURIComponent(project)}`;
  const params = new URLSearchParams();
  if (options.branch) params.set("branch", options.branch);
  if (options.file) params.set("path", options.file);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/**
 * Resolve project slug from environment, config, or directory
 */
async function resolveProjectSlug(projectDir: string): Promise<string> {
  // 1. Environment variable
  const envSlug = getEnv("VERYFRONT_PROJECT_SLUG");
  if (envSlug) return envSlug;

  // 2. Config file
  const config = await readConfigFile(projectDir);
  if (config?.projectSlug) return config.projectSlug;

  // 3. Infer from package.json or directory
  const fs = createFileSystem();
  const packagePath = join(projectDir, "package.json");
  try {
    if (await fs.exists(packagePath)) {
      const content = await fs.readTextFile(packagePath);
      const pkg = JSON.parse(content) as { name?: string };
      if (pkg.name) {
        return pkg.name.replace(/^@[^/]+\//, "").replace(/[^a-z0-9-]/gi, "-");
      }
    }
  } catch {
    // Ignore errors
  }

  // 4. Fall back to directory name
  const dirName = projectDir.split("/").pop() || projectDir.split("\\").pop();
  if (dirName) {
    return dirName.replace(/[^a-z0-9-]/gi, "-");
  }

  throw new Error("Could not determine project slug");
}

/**
 * Open Veryfront Studio in browser
 */
export async function studioCommand(options: {
  project?: string;
  branch?: string;
  file?: string;
} = {}): Promise<{ url: string; opened: boolean }> {
  // Resolve project (explicit or auto-detect)
  const project = options.project ?? (await resolveProjectSlug(cwd()));
  const url = buildStudioUrl(project, options);

  // Open browser or print URL
  const opened = canOpenBrowser();
  if (opened) {
    await openBrowser(url);
    cliLogger.info(`Opening Studio: ${url}`);
  } else {
    cliLogger.info(`Open in browser:\n${url}`);
  }

  return { url, opened };
}
