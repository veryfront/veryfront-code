/**
 * Up command - The unified Veryfront CLI experience
 *
 * One command that handles:
 * - Authentication (if not logged in)
 * - Project scaffolding (if empty folder)
 * - Project creation (if code exists but no project)
 * - Push & Deploy (to preview environment)
 *
 * @module cli/commands/up
 */

import { z } from "zod";
import { cliLogger } from "@veryfront/utils";
import { cwd } from "@veryfront/platform/compat/process.ts";
import { join } from "@veryfront/platform/compat/path/index.ts";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
import { cyan, dim, green, red, yellow } from "@veryfront/compat/console";
import { ensureAuthenticated, readToken } from "../auth/index.ts";
import { getRuntimeEnv, type RuntimeEnv } from "@veryfront/config/runtime-env.ts";
import { createSpinner, getColorEnabled, isTTY, promptUser } from "../utils/index.ts";
import { CommonArgs, createArgParser } from "../shared/args.ts";
import { readConfigFile, type VeryfrontConfig } from "../shared/config.ts";
import { pushCommand } from "./push.ts";
import { deployCommand } from "./deploy.ts";

/**
 * Zod schema for up command arguments
 */
export const UpArgsSchema = z.object({
  force: z.boolean().default(false),
  dryRun: z.boolean().default(false),
});

/**
 * Up command options
 */
export type UpOptions = z.infer<typeof UpArgsSchema>;

/**
 * Parse CLI arguments
 */
export const parseUpArgs = createArgParser(UpArgsSchema, {
  force: CommonArgs.force,
  dryRun: CommonArgs.dryRun,
});

/**
 * Project context types
 */
type ProjectContext =
  | { type: "empty" }
  | { type: "has-project"; config: VeryfrontConfig }
  | { type: "has-code"; suggestedSlug: string };

/**
 * Analyze the current directory to determine project context
 */
async function analyzeDirectory(projectDir: string): Promise<ProjectContext> {
  const fs = createFileSystem();

  // Check for .veryfrontrc (existing project)
  const config = await readConfigFile(projectDir);
  if (config?.projectSlug) {
    return { type: "has-project", config };
  }

  // Check if directory has code
  const entries: string[] = [];
  for await (const entry of fs.readDir(projectDir)) {
    // Skip hidden files and common non-code directories
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") continue;
    entries.push(entry.name);
  }

  // Check for common project indicators
  const hasCode = entries.some((name) =>
    name === "package.json" ||
    name === "deno.json" ||
    name === "app" ||
    name === "src" ||
    name.endsWith(".tsx") ||
    name.endsWith(".ts") ||
    name.endsWith(".jsx") ||
    name.endsWith(".js")
  );

  if (hasCode) {
    // Infer project slug from directory name
    const dirName = projectDir.split("/").pop() || projectDir.split("\\").pop() || "my-app";
    const suggestedSlug = dirName.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    return { type: "has-code", suggestedSlug };
  }

  return { type: "empty" };
}

/**
 * Create a new project via API
 */
async function createProject(
  apiUrl: string,
  token: string,
  slug: string,
): Promise<{ id: string; slug: string } | null> {
  try {
    const response = await fetch(`${apiUrl}/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ slug }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error((error as { message?: string }).message || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create project: ${message}`);
  }
}

/**
 * Save .veryfrontrc configuration
 */
async function saveConfig(projectDir: string, config: VeryfrontConfig): Promise<void> {
  const fs = createFileSystem();
  const configPath = join(projectDir, ".veryfrontrc");
  await fs.writeTextFile(configPath, JSON.stringify(config, null, 2) + "\n");
}

/**
 * The main up command
 */
export async function upCommand(
  options: Partial<UpOptions> = {},
  env: RuntimeEnv = getRuntimeEnv(),
): Promise<void> {
  const { force = false, dryRun = false } = options;

  const useColor = getColorEnabled();
  const c = (fn: (s: string) => string, s: string) => (useColor ? fn(s) : s);

  const projectDir = cwd();

  // Step 1: Ensure authenticated
  const userInfo = await ensureAuthenticated();
  if (!userInfo) {
    return;
  }

  // Step 2: Analyze directory
  const spinner = createSpinner("Analyzing project...");
  spinner.start();

  const context = await analyzeDirectory(projectDir);
  spinner.stop();

  // Step 3: Handle based on context
  let projectSlug: string;

  switch (context.type) {
    case "empty": {
      cliLogger.info("");
      cliLogger.info(c(yellow, "This folder is empty."));
      cliLogger.info("");
      cliLogger.info("To get started, create your app files or run:");
      cliLogger.info(c(dim, "  veryfront init"));
      cliLogger.info("");
      return;
    }

    case "has-project": {
      projectSlug = context.config.projectSlug!;
      cliLogger.info("");
      cliLogger.info(`Deploying ${c(cyan, projectSlug)}...`);
      break;
    }

    case "has-code": {
      // Create new project
      cliLogger.info("");
      cliLogger.info(c(cyan, "Creating new project..."));

      let slug = context.suggestedSlug;

      // Confirm project name in interactive mode
      if (isTTY() && !force) {
        const response = await promptUser(`Project name [${slug}]:`);
        if (response.trim()) {
          slug = response.trim().replace(/[^a-z0-9-]/gi, "-").toLowerCase();
        }
      }

      if (dryRun) {
        cliLogger.info(c(dim, `Would create project: ${slug}`));
      } else {
        const projectSpinner = createSpinner(`Creating project "${slug}"...`);
        projectSpinner.start();

        try {
          // Use configured API URL (env var or default)
          const apiUrl = env.apiUrl || "https://api.veryfront.com";
          // Check env var first (for CI), then stored token
          const resolvedToken = env.apiToken || await readToken();

          if (!resolvedToken) {
            projectSpinner.stop();
            cliLogger.error("Not authenticated");
            return;
          }

          await createProject(apiUrl, resolvedToken, slug);
          projectSpinner.stop();

          // Save config
          await saveConfig(projectDir, { projectSlug: slug });

          cliLogger.info(`${c(green, "✓")} Created project ${c(cyan, slug)}`);
        } catch (error) {
          projectSpinner.stop();
          const message = error instanceof Error ? error.message : String(error);
          cliLogger.info(`${c(red, "✗")} ${message}`);
          return;
        }
      }

      projectSlug = slug;
      break;
    }
  }

  // Step 4: Push files
  cliLogger.info("");

  try {
    await pushCommand({
      projectDir,
      branch: "main",
      force: true, // Skip confirmation since we already authenticated
      dryRun,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    cliLogger.info(`${c(red, "✗")} Push failed: ${message}`);
    return;
  }

  // Step 5: Deploy to preview
  if (!dryRun) {
    cliLogger.info("");

    try {
      await deployCommand({
        branch: "main",
        env: "preview",
        force: true,
        dryRun,
        quiet: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      cliLogger.info(`${c(red, "✗")} Deploy failed: ${message}`);
      return;
    }
  }

  // Step 6: Output success URL
  cliLogger.info("");
  cliLogger.info(`  ${c(green, "✓")} ${c(cyan, `${projectSlug}.preview.veryfront.com`)}`);
  cliLogger.info("");
}
