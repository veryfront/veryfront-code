import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { cliLogger, exitProcess, isVerbose } from "#cli/utils";
import { cwd } from "veryfront/platform";
import { createFileSystem } from "veryfront/platform";
import { brand, createNoopSpinner, dim } from "#cli/ui";
import { ensureAuthenticated } from "../../auth/index.ts";
import { type EnvironmentConfig, getEnvironmentConfig } from "veryfront/config";
import { createSpinner } from "#cli/ui";
import { isTTY, promptUser } from "#cli/utils";
import { logInfo, logSuccess, logWarning } from "#cli/utils";
import { CommonArgs, createArgParser } from "#cli/shared/args";
import {
  createApiClient,
  resolveConfigWithAuthDetails,
  type ResolvedConfig,
} from "#cli/shared/config";
import { reserveProjectSlug } from "#cli/shared/reserve-slug";
import { normalizeProjectSlug } from "#cli/shared/slug";
import {
  inferProjectSlugFromDirectory,
  resolveOrCreateProject,
} from "#cli/shared/project-resolution";
import { getProjectTarget } from "../../shared/deployment-provenance.ts";
import {
  createDeployProject,
  type DeployPlan,
  type DeployProject,
  type DeployProjectOutcome,
} from "../../shared/deployment/deploy-project.ts";
import { deployProgressText, initialDeployProgressText } from "../../shared/deployment/progress.ts";
import { buildStudioUrl } from "../studio/command.ts";
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
  | { type: "has-project"; config: ResolvedConfig }
  | { type: "has-code"; config: ResolvedConfig; suggestedSlug: string };

async function analyzeDirectory(
  projectDir: string,
  env: EnvironmentConfig,
): Promise<ProjectContext> {
  const fs = createFileSystem();

  const resolved = await resolveConfigWithAuthDetails(projectDir, env);
  if (resolved.projectReferenceSource.kind !== "inferred") {
    return {
      type: "has-project",
      config: resolved.config,
    };
  }

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

  return {
    type: "has-code",
    config: resolved.config,
    suggestedSlug: await inferProjectSlugFromDirectory(projectDir),
  };
}

export interface UpDependencies {
  /** Deploy Execution override for tests; production uses createDeployProject(). */
  deployProject?: DeployProject;
}

/**
 * Actions `up` reports for a dry run, derived from the Deploy Execution plan.
 *
 * Release creation and deployment are one user-visible step for `up`, which
 * only ever targets the preview environment.
 */
function plannedUpActions(plan: DeployPlan): string[] {
  return [
    ...(plan.plannedActions.includes("create-project") ? ["create-project"] : []),
    ...(plan.plannedActions.includes("push-source") ? ["push-source"] : []),
    "deploy-preview",
  ];
}

/**
 * The same plan in prose, for the humans `--dry-run` exists to inform.
 *
 * A dry run that only says it finished cannot be read before the real run, so
 * it names the project it resolved and every action the apply would take.
 * The name comes from the plan, not from the local link: a project renamed
 * after it was linked still resolves by id, and the plan carries the slug the
 * apply would actually target.
 * It never predicts a preview URL: `up` prints URLs it has verified, and the
 * hostname of a deployment that does not exist yet is not one of them.
 */
function formatUpDryRunPlan(plan: DeployPlan): string {
  const actions = [
    ...(plan.plannedActions.includes("create-project") ? ["create the project"] : []),
    ...(plan.plannedActions.includes("push-source") ? [`push source to "${plan.branch}"`] : []),
    "create release",
    `deploy to "${plan.environment}"`,
  ];
  const last = actions[actions.length - 1];
  const phrase = `${actions.slice(0, -1).join(", ")}, and ${last}`;
  return `Would ${phrase} for project ${plan.projectSlug}`;
}

export async function upCommand(
  options: Partial<UpOptions> = {},
  env: EnvironmentConfig = getEnvironmentConfig(),
  dependencies: UpDependencies = {},
): Promise<void> {
  const { projectDir = cwd(), force = false, dryRun = false } = options;
  const jsonOutput = isJsonMode();

  const userInfo = await ensureAuthenticated(env, projectDir);
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
  const context = await analyzeDirectory(projectDir, env);
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
      console.log();
      cliLogger.info("To get started, create your app files or run:");
      cliLogger.info(`  ${brand("veryfront init")}`);
      console.log();
    }
    exitProcess(1);
    return;
  }

  let projectSlug: string;

  if (context.type === "has-project") {
    projectSlug = context.config.projectSlug;
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

    const projectSpinner = dryRun || jsonOutput
      ? createNoopSpinner()
      : createSpinner(`Creating project "${slug}"...`);

    try {
      if (!dryRun && !context.config.apiToken) {
        projectSpinner.stop();
        throw new Error("Not authenticated");
      }

      const outcome = await resolveOrCreateProject({
        projectDir,
        config: { ...context.config, projectSlug: slug },
        source: { kind: "inferred", name: "project files" },
        client: {
          getProject: (reference) =>
            getProjectTarget(
              createApiClient({ ...context.config, projectSlug: slug }),
              reference,
            ),
          reserveSlug: async (reserveSlug, options) => {
            const reserved = await reserveProjectSlug(
              reserveSlug,
              context.config.apiToken,
              env,
              context.config.apiUrl,
              options,
            );
            return { slug: reserved.slug, projectId: reserved.projectId };
          },
        },
        allowAlternativeSlug: false,
        dryRun,
      });
      projectSpinner.stop();

      if (outcome.kind === "planned-create") {
        if (!jsonOutput) cliLogger.info(dim(`Would create project: ${outcome.plannedSlug}`));
        slug = outcome.plannedSlug;
      } else {
        slug = outcome.project.slug;
        if (!jsonOutput) logSuccess(`Created project ${slug}`);
      }
    } catch (error) {
      projectSpinner.stop();
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Project creation failed: ${message}`, { cause: error });
    }

    projectSlug = slug;
  }

  // A blank separator is written straight to stdout: routed through the logger
  // it renders as a status glyph with no message.
  if (!jsonOutput) console.log();

  // Deploy Execution owns the rest: the bootstrap push, the release, the
  // deployment, and the readiness probe behind the URL printed below.
  const verbose = isVerbose();
  let progressText = initialDeployProgressText(verbose);
  const deploySpinner = jsonOutput ? createNoopSpinner() : createSpinner(progressText);
  let outcome: DeployProjectOutcome;

  try {
    outcome = await (dependencies.deployProject ?? createDeployProject()).execute({
      projectDir,
      branch: "main",
      environment: "preview",
      mode: dryRun ? "dry-run" : "apply",
      // up publishes what is on disk, so a receipt that no longer describes
      // this directory is refreshed rather than refused: refusing would leave
      // the preview serving source the operator already replaced.
      source: { kind: "ensure-pushed", refreshStaleSource: true },
    }, {
      onEvent(event) {
        if (event.kind !== "step") return;
        // A dry run resolves the target and stops. Narrating the steps of an
        // apply it never performs told users it was "Building release...".
        if (dryRun) return;
        const next = deployProgressText(event, "preview", verbose);
        if (!next || next === progressText) return;
        progressText = next;
        deploySpinner.update(next);
      },
    });
  } catch (error) {
    deploySpinner.stop();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Preview deployment failed: ${message}`, { cause: error });
  }
  deploySpinner.stop();

  if (outcome.kind === "dry-run") {
    if (jsonOutput) {
      streamJsonLine({
        type: "result",
        success: true,
        data: {
          projectSlug,
          dryRun: true,
          plannedActions: plannedUpActions(outcome.plan),
        },
      });
    } else {
      logInfo(formatUpDryRunPlan(outcome.plan));
      logSuccess("Dry run complete");
    }
    return;
  }

  const result = outcome.result;
  const studioUrl = buildStudioUrl(result.projectSlug, { branch: result.branch });

  if (jsonOutput) {
    streamJsonLine({
      type: "result",
      success: true,
      data: {
        projectSlug: result.projectSlug,
        dryRun: false,
        studioUrl,
        previewUrl: result.url,
        nextCommand: "veryfront deploy",
      },
    });
    return;
  }

  logSuccess(`${result.projectSlug} is ready`);
  console.log();
  console.log(`  Studio:  ${brand(studioUrl)}`);
  console.log(`  Preview: ${brand(result.url)}`);
  console.log();
  console.log(`  Deploy:  ${brand("veryfront deploy")}`);
  console.log();
}
