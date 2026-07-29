import { createFileSystem } from "veryfront/platform";
import { join } from "veryfront/platform/path";
import { isNotFoundError } from "veryfront/fs";
import { cliLogger } from "#cli/utils";
import type { ResolvedConfig } from "#cli/shared/config";
import { clearProjectLink, readProjectLink, writeProjectLink } from "../../shared/project-link.ts";
import { normalizeControlPlane, type ProjectTarget } from "../../shared/deployment-provenance.ts";
import { createPackageJson, createTypeScriptConfig } from "../init/config-generator.ts";

const PACKAGE_JSON_PATH = "package.json";
const TSCONFIG_PATH = "tsconfig.json";
const PROJECT_LINK_PATH = ".veryfront/project.json";
const LOCAL_BOOTSTRAP_PATHS = new Set([
  PACKAGE_JSON_PATH,
  TSCONFIG_PATH,
  PROJECT_LINK_PATH,
]);

export interface PulledProjectBootstrapPlan {
  projectLinkAction: "create" | "update" | null;
  createPackageJson: boolean;
  createTsconfig: boolean;
  writeCount: number;
}

export interface PulledProjectBootstrapOptions {
  projectDir: string;
  config: ResolvedConfig;
  project: ProjectTarget;
  pulledPaths: ReadonlySet<string>;
  deletedPaths: ReadonlySet<string>;
  dryRun: boolean;
  quiet: boolean;
  plan?: PulledProjectBootstrapPlan;
}

export interface PulledProjectBootstrapPreflightOptions {
  projectDir: string;
}

async function pathExistsInFinalState(
  projectDir: string,
  relativePath: string,
  pulledPaths: ReadonlySet<string>,
  deletedPaths: ReadonlySet<string>,
): Promise<boolean> {
  if (pulledPaths.has(relativePath)) return true;
  if (deletedPaths.has(relativePath)) return false;

  const fs = createFileSystem();
  return await fs.exists(join(projectDir, relativePath));
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function assertRegularBootstrapFile(projectDir: string, relativePath: string): Promise<void> {
  try {
    const info = await Deno.lstat(join(projectDir, relativePath));
    if (info.isSymlink) {
      throw new Error(
        `Veryfront pull does not support a symbolic link at "${relativePath}". Replace the link with a regular file and run veryfront pull again.`,
      );
    }
    if (!info.isFile) {
      throw new Error(
        `Veryfront pull requires "${relativePath}" to be a regular file.`,
      );
    }
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
}

export function isPulledProjectBootstrapPath(relativePath: string): boolean {
  return LOCAL_BOOTSTRAP_PATHS.has(relativePath);
}

export async function preflightPulledProjectBootstrap(
  options: PulledProjectBootstrapPreflightOptions,
): Promise<void> {
  await readProjectLink(options.projectDir);
  await assertRegularBootstrapFile(options.projectDir, PACKAGE_JSON_PATH);
  await assertRegularBootstrapFile(options.projectDir, TSCONFIG_PATH);
}

export async function planPulledProjectBootstrap(
  options: PulledProjectBootstrapOptions,
): Promise<PulledProjectBootstrapPlan> {
  const projectLink = await readProjectLink(options.projectDir);
  const plannedProjectLink = {
    controlPlane: options.config.apiUrl,
    projectId: options.project.id,
    projectSlug: options.project.slug,
  };
  const projectLinkMatches = projectLink &&
    normalizeControlPlane(projectLink.controlPlane) ===
      normalizeControlPlane(plannedProjectLink.controlPlane) &&
    projectLink.projectId === plannedProjectLink.projectId &&
    projectLink.projectSlug === plannedProjectLink.projectSlug;
  const projectLinkAction = projectLinkMatches ? null : projectLink ? "update" : "create";
  const createPackageJson = !(await pathExistsInFinalState(
    options.projectDir,
    PACKAGE_JSON_PATH,
    options.pulledPaths,
    options.deletedPaths,
  ));
  const createTsconfig = !(await pathExistsInFinalState(
    options.projectDir,
    TSCONFIG_PATH,
    options.pulledPaths,
    options.deletedPaths,
  ));

  return {
    projectLinkAction,
    createPackageJson,
    createTsconfig,
    writeCount: Number(projectLinkAction !== null) +
      Number(createPackageJson) +
      Number(createTsconfig),
  };
}

export async function ensurePulledProjectBootstrap(
  options: PulledProjectBootstrapOptions,
): Promise<void> {
  const plan = options.plan ?? await planPulledProjectBootstrap(options);

  if (options.dryRun) {
    if (!options.quiet) {
      if (plan.projectLinkAction) {
        cliLogger.info(`  Would ${plan.projectLinkAction}: ${PROJECT_LINK_PATH}`);
      }
      if (plan.createPackageJson) cliLogger.info(`  Would create: ${PACKAGE_JSON_PATH}`);
      if (plan.createTsconfig) cliLogger.info(`  Would create: ${TSCONFIG_PATH}`);
    }
    return;
  }

  const previousLink = plan.projectLinkAction ? await readProjectLink(options.projectDir) : null;
  const previousLinkText = previousLink
    ? await Deno.readTextFile(join(options.projectDir, PROJECT_LINK_PATH))
    : null;
  const veryfrontDirectory = join(options.projectDir, ".veryfront");
  const hadVeryfrontDirectory = await createFileSystem().exists(veryfrontDirectory);
  const createdFiles: string[] = [];
  let projectLinkMutationAttempted = false;

  try {
    if (plan.projectLinkAction) {
      projectLinkMutationAttempted = true;
      await writeProjectLink(options.projectDir, {
        controlPlane: options.config.apiUrl,
        projectId: options.project.id,
        projectSlug: options.project.slug,
      });
    }

    if (plan.createPackageJson) {
      createdFiles.push(join(options.projectDir, PACKAGE_JSON_PATH));
      await createPackageJson(options.projectDir, options.project.slug);
    }
    if (plan.createTsconfig) {
      createdFiles.push(join(options.projectDir, TSCONFIG_PATH));
      await createTypeScriptConfig(options.projectDir);
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];

    for (const file of createdFiles.reverse()) {
      try {
        await removeIfPresent(file);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }

    if (projectLinkMutationAttempted) {
      try {
        if (previousLinkText !== null) {
          await Deno.writeTextFile(join(options.projectDir, PROJECT_LINK_PATH), previousLinkText);
        } else {
          await clearProjectLink(options.projectDir);
          if (!hadVeryfrontDirectory) await removeIfPresent(veryfrontDirectory);
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }

    if (rollbackErrors.length > 0) {
      throw new Error(
        `Bootstrap failed: ${describeError(error)}. Rollback also failed: ${
          rollbackErrors.map(describeError).join("; ")
        }`,
        { cause: error },
      );
    }

    throw error;
  }
}
