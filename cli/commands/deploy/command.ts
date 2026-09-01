/**
 * Deploy command - Create a release and deploy to an environment
 *
 * Creates a new release from the specified branch, or main when no branch is
 * specified, then deploys it to the target environment (default: production).
 *
 * @module cli/commands/deploy
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { cwd } from "veryfront/platform";
import { resolve } from "veryfront/platform/path";
import { CommonArgs, createArgParser } from "#cli/shared/args";
import { exitProcess, isVerbose, logInfo, logSuccess, logWarning } from "#cli/utils";
import { UNKNOWN_ERROR, VeryfrontError } from "veryfront/errors";
import { brand, createNoopSpinner, createSpinner, dim, formatDuration } from "#cli/ui";
import { createStreamErrorResult, isJsonMode, streamJsonLine } from "../../shared/json-output.ts";
import {
  createDeployProject,
  type DeployPlan,
  type DeployProject,
  type DeployProjectOutcome,
  type DeployStepName,
} from "../../shared/deployment/deploy-project.ts";
import { deployProgressText, initialDeployProgressText } from "../../shared/deployment/progress.ts";
import type { DeployResult } from "../../shared/deployment/result.ts";

/**
 * Schema factory for deploy command arguments
 */
export const getDeployArgsSchema = defineSchema((v) =>
  v.object({
    projectSlug: v.string().min(1).optional(),
    projectDir: v.string().optional(),
    branch: v.string().min(1).optional(),
    env: v.string().min(1).default("production"),
    releaseName: v.string().min(1).optional(),
    dryRun: v.boolean().default(false),
    /** Deprecated compatibility flag; invoking deploy already authorizes the operation. */
    force: v.boolean().default(false),
    /** Quiet mode - suppress spinner/progress output */
    quiet: v.boolean().default(false),
    /** Internal option used by commands that already pushed source. */
    skipSourcePush: v.boolean().default(false),
  })
);

export const DeployArgsSchema = lazySchema(getDeployArgsSchema);

/**
 * Deploy command options (inferred from schema)
 */
type ParsedDeployOptions = InferSchema<ReturnType<typeof getDeployArgsSchema>>;
export type DeployOptions = Omit<ParsedDeployOptions, "skipSourcePush"> & {
  skipSourcePush?: boolean;
  /** Deploy Execution override for tests; production uses createDeployProject(). */
  deployProject?: DeployProject;
};

/**
 * Parse CLI arguments into validated DeployOptions
 */
export const parseDeployArgs = createArgParser(DeployArgsSchema, {
  projectSlug: CommonArgs.projectSlug,
  projectDir: CommonArgs.projectDir,
  branch: CommonArgs.branch,
  env: CommonArgs.env,
  releaseName: CommonArgs.releaseName,
  dryRun: CommonArgs.dryRun,
  force: CommonArgs.force,
  quiet: CommonArgs.quiet,
});

/**
 * Environment from the API
 */
export type { DeployResult };

/**
 * Create a release and deploy to an environment
 */
export async function deployCommand(options: DeployOptions): Promise<DeployResult | null> {
  if (isJsonMode()) return deployCommandJson(options);
  return deployCommandHuman(options);
}

function deployRunner(options: DeployOptions): DeployProject {
  return options.deployProject ?? createDeployProject();
}

function toDeployRequest(options: DeployOptions) {
  // Naming a project promotes what that project already has. Deploy must never
  // upload the working directory into a project the caller only named by slug:
  // the directory is unrelated to that project by construction.
  const promoteOnly = options.skipSourcePush || options.projectSlug !== undefined;
  return {
    projectDir: resolve(options.projectDir ?? cwd()),
    ...(options.projectSlug === undefined ? {} : { projectSlug: options.projectSlug }),
    branch: options.branch,
    environment: options.env,
    releaseName: options.releaseName,
    mode: options.dryRun ? "dry-run" as const : "apply" as const,
    source: promoteOnly ? { kind: "already-pushed" as const } : { kind: "ensure-pushed" as const },
  };
}

function formatDryRunActions(plan: DeployPlan): string {
  return plan.plannedActions.includes("push-source")
    ? `push source to "${plan.branch}", create release, and deploy to "${plan.environment}"`
    : `create release and deploy to "${plan.environment}"`;
}

function logDryRunPlan(plan: DeployPlan, quiet: boolean): void {
  if (quiet) return;
  // A dry run exists to be read before the real one, so it always names the
  // project it resolved: which project is what an operator gets wrong.
  logInfo(`Would ${formatDryRunActions(plan)} for project ${plan.projectSlug}`);
}

function commandStepName(stepName: DeployStepName): string {
  return stepName === "create-deployment" ? "deploy" : stepName;
}

async function deployCommandHuman(options: DeployOptions): Promise<DeployResult | null> {
  const { env, quiet = false } = options;
  const startedAt = Date.now();
  const verbose = isVerbose();
  let progressText = initialDeployProgressText(verbose);
  const spinner = quiet ? createNoopSpinner() : createSpinner(progressText);
  const updateProgress = (next: string | null): void => {
    if (!next) return;
    if (next === progressText) return;
    progressText = next;
    spinner.update(next);
  };
  // Collected, not overwritten: a deploy can raise more than one warning, and
  // the one an operator most needs is not reliably the last.
  const warnings: string[] = [];
  let outcome: DeployProjectOutcome;
  try {
    outcome = await deployRunner(options).execute(toDeployRequest(options), {
      onEvent(event) {
        if (event.kind === "warning") {
          warnings.push(event.message);
          return;
        }
        updateProgress(deployProgressText(event, env, verbose));
      },
    });
  } catch (error) {
    spinner.stop();
    throw error;
  }
  spinner.stop();

  if (outcome.kind === "dry-run") {
    logDryRunPlan(outcome.plan, quiet);
    return null;
  }

  const result = outcome.result;

  if (quiet) return result;

  logSuccess(
    `Deployed ${result.projectSlug} to ${env} in ${formatDuration(Date.now() - startedAt)}`,
  );
  console.log();
  console.log(`  ${brand(result.url)}`);
  console.log(
    `  ${
      dim(
        `${result.protected ? "Protected" : "Public"} · Release ${result.release.version}`,
      )
    }`,
  );
  console.log();

  if (verbose) {
    logInfo(`  Project: ${result.projectSlug} (${result.projectId})`);
    logInfo(`  Environment: ${env} (${result.environmentId})`);
    logInfo(
      `  Release: ${result.release.name} (${result.release.version}, ${result.release.id})`,
    );
    logInfo(`  Deployment: ${result.deploymentId}`);
    if (result.routingConvergence?.status === "converged") {
      logInfo(
        `  Data plane: ${result.routingConvergence.acknowledged}/${result.routingConvergence.recipients} proxy replicas converged`,
      );
    }
    logInfo(
      result.commitSha
        ? `  Commit: ${result.commitSha}`
        : "  Commit: unavailable (source digest verified)",
    );
    logInfo(`  Source digest: ${result.sourceDigest}`);
    logInfo(`  Control plane: ${result.controlPlane}`);
  }

  for (const message of warnings) logWarning(message);

  if (verbose) {
    const { getPostDeployTips } = await import("../../help/tips.ts");
    console.log(getPostDeployTips());
  }

  return result;
}

async function deployCommandJson(options: DeployOptions): Promise<DeployResult | null> {
  try {
    const outcome = await deployRunner(options).execute(toDeployRequest(options), {
      onEvent(event) {
        if (event.kind === "warning") {
          streamJsonLine({
            type: "warning",
            code: event.code,
            message: event.message,
          });
          return;
        }
        streamJsonLine({
          type: "step",
          name: commandStepName(event.step),
          status: event.phase,
        });
      },
    });

    if (outcome.kind === "dry-run") {
      streamJsonLine({
        type: "result",
        success: true,
        data: { dryRun: true, ...outcome.plan },
      });
      return null;
    }

    const result = outcome.result;
    streamJsonLine({
      type: "result",
      success: true,
      data: result,
    });
    return result;
  } catch (error) {
    const vfErr = error instanceof VeryfrontError ? error : UNKNOWN_ERROR.create({
      detail: error instanceof Error ? error.message : String(error),
      cause: error instanceof Error ? error : undefined,
    });
    streamJsonLine(
      createStreamErrorResult({
        code: "RUNTIME_ERROR",
        slug: vfErr.slug,
        message: vfErr.detail ?? vfErr.message,
      }),
    );
    exitProcess(1);
    return null;
  }
}
