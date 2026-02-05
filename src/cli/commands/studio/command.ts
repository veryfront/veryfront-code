/**
 * Open Veryfront Studio in browser
 * @module cli/commands/studio
 */

import { canOpenBrowser, openBrowser } from "../../auth/browser.ts";
import { readConfigFile } from "../../shared/config.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { join } from "#veryfront/platform/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { brand, dim, muted, success } from "../../ui/colors.ts";
import { getRuntimeEnv, type RuntimeEnv } from "#veryfront/config/runtime-env.ts";

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
async function resolveProjectSlug(
  projectDir: string,
  env: RuntimeEnv = getRuntimeEnv(),
): Promise<string> {
  if (env.projectSlug) return env.projectSlug;

  const config = await readConfigFile(projectDir);
  if (config?.projectSlug) return config.projectSlug;

  const fs = createFileSystem();
  const packagePath = join(projectDir, "package.json");

  try {
    if (await fs.exists(packagePath)) {
      const content = await fs.readTextFile(packagePath);
      const pkg = JSON.parse(content) as { name?: string } | null;
      const name = pkg?.name;
      if (name) return name.replace(/^@[^/]+\//, "").replace(/[^a-z0-9-]/gi, "-");
    }
  } catch {
    // Ignore errors
  }

  const dirName = projectDir.split(/[/\\]/).pop();
  if (dirName) return dirName.replace(/[^a-z0-9-]/gi, "-");

  throw new Error("Could not determine project slug");
}

/**
 * Open Veryfront Studio in browser
 */
export async function studioCommand(
  options: {
    project?: string;
    branch?: string;
    file?: string;
  } = {},
  env: RuntimeEnv = getRuntimeEnv(),
): Promise<{ url: string; opened: boolean }> {
  const project = options.project ?? (await resolveProjectSlug(cwd(), env));
  const url = buildStudioUrl(project, options);

  const opened = canOpenBrowser();

  console.log();

  if (!opened) {
    console.log("  " + muted("Open in browser:"));
    console.log();
    console.log("  " + brand(url));
    console.log();
    return { url, opened };
  }

  await openBrowser(url);
  console.log("  " + success("✓") + " Opening " + brand(project) + " in Studio");
  console.log();
  console.log("  " + dim(url));
  console.log();

  return { url, opened };
}
