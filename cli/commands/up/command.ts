import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { cliLogger, exitProcess } from "#cli/utils";
import { cwd } from "veryfront/platform";
import { join } from "veryfront/platform/path";
import { createFileSystem } from "veryfront/platform";
import { brand, createNoopSpinner, dim } from "#cli/ui";
import { ensureAuthenticated, readToken } from "../../auth/index.ts";
import { type EnvironmentConfig, getEnvironmentConfig } from "veryfront/config";
import { createSpinner } from "#cli/ui";
import { isTTY, promptUser } from "#cli/utils";
import { logSuccess, logWarning } from "#cli/utils";
import { CommonArgs, createArgParser } from "#cli/shared/args";
import { readConfigFile, type VeryfrontConfig } from "#cli/shared/config";
import { resolveCliApiUrl } from "#cli/shared/constants";
import { reserveProjectSlug } from "#cli/shared/reserve-slug";
import { normalizeProjectSlug } from "#cli/shared/slug";
import { pushCommand } from "../push/index.ts";
import { deployCommand } from "../deploy/index.ts";
import { buildPushUrls } from "../push/command.ts";
import { isInteractive } from "../../shared/interactive.ts";
import { createStreamErrorResult, isJsonMode, streamJsonLine } from "../../shared/json-output.ts";
import { AUTHENTICATION_REQUIRED, PROJECT_SOURCE_EMPTY } from "veryfront/errors";

export const getUpArgsSchema = defineSchema((v) =>
  v.object({
    projectDir: v.string().optional(),
    force: v.boolean().default(false),
    dryRun: v.boolean().default(false),
  })
);

export const UpArgsSchema = lazySchema(getUpArgsSchema);

export type UpOptions = InferSchema<ReturnType<typeof getUpArgsSchema>>;

export const parseUpArgs = createArgParser(UpArgsSchema, {
  projectDir: CommonArgs.projectDir,
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

  let suggestedSlug = normalizeProjectSlug(projectDir.split(/[/\\]/).pop() || "my-app");
  const packagePath = join(projectDir, "package.json");
  try {
    if (await fs.exists(packagePath)) {
      const pkg = JSON.parse(await fs.readTextFile(packagePath)) as { name?: string };
      if (pkg.name) suggestedSlug = normalizeProjectSlug(pkg.name);
    }
  } catch (error) {
    cliLogger.debug("Failed to read package.json for project slug:", error);
  }
  return { type: "has-code", suggestedSlug };
}

async function saveConfig(projectDir: string, config: VeryfrontConfig): Promise<void> {
  const fs = createFileSystem();
  await fs.writeTextFile(
    join(projectDir, "veryfront.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
}

export async function upCommand(
  options: Partial<UpOptions> = {},
  env: EnvironmentConfig = getEnvironmentConfig(),
): Promise<void> {
  const { projectDir = cwd(), force = false, dryRun = false } = options;
  const jsonOutput = isJsonMode();

  const userInfo = await ensureAuthenticated(env);
  if (!userInfo) {
    if (jsonOutput) {
      const message = "Not authenticated. Set VERYFRONT_API_TOKEN or run veryfront login.";
      const authError = AUTHENTICATION_REQUIRED.create({ detail: message });
      streamJsonLine(
        createStreamErrorResult({
          code: "RUNTIME_ERROR",
          slug: authError.slug,
          message,
        }),
      );
    }
    exitProcess(1);
    return;
  }

  const spinner = jsonOutput ? createNoopSpinner() : createSpinner("Analyzing project...");
  const context = await analyzeDirectory(projectDir);
  spinner.stop();

  if (context.type === "empty") {
    if (jsonOutput) {
      const message = "This folder is empty. Add project files or run veryfront init.";
      const sourceError = PROJECT_SOURCE_EMPTY.create({ detail: message });
      streamJsonLine(
        createStreamErrorResult({
          code: "RUNTIME_ERROR",
          slug: sourceError.slug,
          message,
        }),
      );
    } else {
      logWarning("This folder is empty.");
      cliLogger.info("");
      cliLogger.info("To get started, create your app files or run:");
      cliLogger.info(`  ${brand("veryfront init")}`);
      cliLogger.info("");
    }
    exitProcess(1);
    return;
  }

  let projectSlug: string;

  if (context.type === "has-project") {
    projectSlug = context.config.projectSlug!;
  } else {
    if (!jsonOutput) {
      console.log();
      console.log("  Creating project...");
    }

    let slug = context.suggestedSlug;

    if (!jsonOutput && isInteractive() && isTTY() && !force) {
      const response = await promptUser(`Project name [${slug}]:`);
      const trimmed = response.trim();
      if (trimmed) slug = normalizeProjectSlug(trimmed);
    }

    if (dryRun) {
      if (!jsonOutput) cliLogger.info(dim(`Would create project: ${slug}`));
    } else {
      const projectSpinner = jsonOutput
        ? createNoopSpinner()
        : createSpinner(`Creating project "${slug}"...`);

      try {
        const apiUrl = resolveCliApiUrl(env);
        const resolvedToken = env.apiToken ?? (await readToken(env));

        if (!resolvedToken) {
          projectSpinner.stop();
          throw new Error("Not authenticated");
        }

        const reserved = await reserveProjectSlug(slug, resolvedToken, env, apiUrl, {
          allowAlternativeSlug: false,
        });
        slug = reserved.slug;
        projectSpinner.stop();

        await saveConfig(projectDir, { projectSlug: slug });

        if (!jsonOutput) logSuccess(`Created project ${slug}`);
      } catch (error) {
        projectSpinner.stop();
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Project creation failed: ${message}`, { cause: error });
      }
    }

    projectSlug = slug;
  }

  if (!jsonOutput) cliLogger.info("");

  try {
    await pushCommand({
      projectDir,
      branch: "main",
      force: true,
      dryRun,
      quiet: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Push failed: ${message}`, { cause: error });
  }

  if (dryRun) {
    if (jsonOutput) {
      streamJsonLine({
        type: "result",
        success: true,
        data: {
          projectSlug,
          dryRun: true,
          plannedActions: [
            ...(context.type === "has-project" ? [] : ["create-project"]),
            "push-source",
            "deploy-preview",
          ],
        },
      });
    } else {
      logSuccess("Dry run complete");
    }
    return;
  }

  try {
    await deployCommand({
      projectDir,
      branch: "main",
      env: "preview",
      force: true,
      dryRun,
      quiet: true,
      skipSourcePush: true,
      suppressJsonOutput: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Preview deployment failed: ${message}`, { cause: error });
  }

  const urls = buildPushUrls(projectSlug, "main");
  if (jsonOutput) {
    streamJsonLine({
      type: "result",
      success: true,
      data: {
        projectSlug,
        dryRun: false,
        studioUrl: urls.studio,
        previewUrl: urls.preview,
        nextCommand: "veryfront deploy",
      },
    });
    return;
  }

  logSuccess(`${projectSlug} is ready`);
  console.log();
  console.log(`  Studio:  ${brand(urls.studio)}`);
  console.log(`  Preview: ${brand(urls.preview)}`);
  console.log();
  console.log(`  Deploy:  ${brand("veryfront deploy")}`);
  console.log();
}
