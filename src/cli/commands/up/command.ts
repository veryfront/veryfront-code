import { z } from "zod";
import { cliLogger } from "#veryfront/utils";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { join } from "#veryfront/platform/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { cyan, dim, green, red, yellow } from "#veryfront/compat/console";
import { ensureAuthenticated, readToken } from "../../auth/index.ts";
import {
  type EnvironmentConfig,
  getEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { getColorEnabled, isTTY, promptUser } from "../../utils/index.ts";
import { createSpinner } from "../../ui/progress.ts";
import { CommonArgs, createArgParser } from "../../shared/args.ts";
import { readConfigFile, type VeryfrontConfig } from "../../shared/config.ts";
import { pushCommand } from "../push/index.ts";
import { deployCommand } from "../deploy/index.ts";

export const UpArgsSchema = z.object({
  force: z.boolean().default(false),
  dryRun: z.boolean().default(false),
});

export type UpOptions = z.infer<typeof UpArgsSchema>;

export const parseUpArgs = createArgParser(UpArgsSchema, {
  force: CommonArgs.force,
  dryRun: CommonArgs.dryRun,
});

type ProjectContext =
  | { type: "empty" }
  | { type: "has-project"; config: VeryfrontConfig }
  | { type: "has-code"; suggestedSlug: string };

async function analyzeDirectory(projectDir: string): Promise<ProjectContext> {
  const fs = createFileSystem();

  const config = await readConfigFile(projectDir);
  if (config?.projectSlug) return { type: "has-project", config };

  const entries: string[] = [];
  for await (const entry of fs.readDir(projectDir)) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    entries.push(entry.name);
  }

  const hasCode = entries.some(
    (name) =>
      name === "package.json" ||
      name === "deno.json" ||
      name === "app" ||
      name === "src" ||
      name.endsWith(".tsx") ||
      name.endsWith(".ts") ||
      name.endsWith(".jsx") ||
      name.endsWith(".js"),
  );

  if (!hasCode) return { type: "empty" };

  const dirName = projectDir.split(/[/\\]/).pop() || "my-app";
  const suggestedSlug = dirName.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  return { type: "has-code", suggestedSlug };
}

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

    if (response.ok) return await response.json();

    const error = await response.json().catch(() => ({}));
    const message = (error as { message?: string }).message ?? `HTTP ${response.status}`;
    throw new Error(message);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create project: ${message}`);
  }
}

async function saveConfig(projectDir: string, config: VeryfrontConfig): Promise<void> {
  const fs = createFileSystem();
  await fs.writeTextFile(join(projectDir, ".veryfrontrc"), `${JSON.stringify(config, null, 2)}\n`);
}

export async function upCommand(
  options: Partial<UpOptions> = {},
  env: EnvironmentConfig = getEnvironmentConfig(),
): Promise<void> {
  const { force = false, dryRun = false } = options;

  const useColor = getColorEnabled();
  const c = (fn: (s: string) => string, s: string): string => (useColor ? fn(s) : s);

  const projectDir = cwd();

  const userInfo = await ensureAuthenticated();
  if (!userInfo) return;

  const spinner = createSpinner("Analyzing project...");
  const context = await analyzeDirectory(projectDir);
  spinner.stop();

  if (context.type === "empty") {
    cliLogger.info("");
    cliLogger.info(c(yellow, "This folder is empty."));
    cliLogger.info("");
    cliLogger.info("To get started, create your app files or run:");
    cliLogger.info(c(dim, "  veryfront init"));
    cliLogger.info("");
    return;
  }

  let projectSlug: string;

  if (context.type === "has-project") {
    projectSlug = context.config.projectSlug!;
    cliLogger.info("");
    cliLogger.info(`Deploying ${c(cyan, projectSlug)}...`);
  } else {
    cliLogger.info("");
    cliLogger.info(c(cyan, "Creating new project..."));

    let slug = context.suggestedSlug;

    if (isTTY() && !force) {
      const response = await promptUser(`Project name [${slug}]:`);
      const trimmed = response.trim();
      if (trimmed) slug = trimmed.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    }

    if (dryRun) {
      cliLogger.info(c(dim, `Would create project: ${slug}`));
    } else {
      const projectSpinner = createSpinner(`Creating project "${slug}"...`);

      try {
        const apiUrl = env.apiUrl ?? "https://api.veryfront.com";
        const resolvedToken = env.apiToken ?? (await readToken());

        if (!resolvedToken) {
          projectSpinner.stop();
          cliLogger.error("Not authenticated");
          return;
        }

        await createProject(apiUrl, resolvedToken, slug);
        projectSpinner.stop();

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
  }

  cliLogger.info("");

  try {
    await pushCommand({
      projectDir,
      branch: "main",
      force: true,
      dryRun,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    cliLogger.info(`${c(red, "✗")} Push failed: ${message}`);
    return;
  }

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

  cliLogger.info("");
  cliLogger.info(`  ${c(green, "✓")} ${c(cyan, `${projectSlug}.preview.veryfront.com`)}`);
  cliLogger.info("");
}
