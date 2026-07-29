import { createFileSystem } from "veryfront/platform";
import { join } from "veryfront/platform/path";
import { isNotFoundError } from "veryfront/fs";
import { cliLogger } from "#cli/utils";
import type { ResolvedConfig } from "#cli/shared/config";
import { clearProjectLink, readProjectLink, writeProjectLink } from "../../shared/project-link.ts";
import type { ProjectTarget } from "../../shared/deployment-provenance.ts";
import { createPackageJson, createTypeScriptConfig } from "../init/config-generator.ts";

const PACKAGE_JSON_PATH = "package.json";
const TSCONFIG_PATH = "tsconfig.json";
const PROJECT_LINK_PATH = ".veryfront/project.json";

export interface PulledProjectBootstrapOptions {
  projectDir: string;
  config: ResolvedConfig;
  project: ProjectTarget;
  pulledPaths: ReadonlySet<string>;
  deletedPaths: ReadonlySet<string>;
  dryRun: boolean;
  quiet: boolean;
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

export async function ensurePulledProjectBootstrap(
  options: PulledProjectBootstrapOptions,
): Promise<void> {
  const packageJsonExists = await pathExistsInFinalState(
    options.projectDir,
    PACKAGE_JSON_PATH,
    options.pulledPaths,
    options.deletedPaths,
  );
  const tsconfigExists = await pathExistsInFinalState(
    options.projectDir,
    TSCONFIG_PATH,
    options.pulledPaths,
    options.deletedPaths,
  );

  if (options.dryRun) {
    if (!options.quiet) {
      if (!packageJsonExists) cliLogger.info(`  Would create: ${PACKAGE_JSON_PATH}`);
      if (!tsconfigExists) cliLogger.info(`  Would create: ${TSCONFIG_PATH}`);
    }
    return;
  }

  const previousLink = await readProjectLink(options.projectDir);
  const previousLinkText = previousLink
    ? await Deno.readTextFile(join(options.projectDir, PROJECT_LINK_PATH))
    : null;
  const veryfrontDirectory = join(options.projectDir, ".veryfront");
  const hadVeryfrontDirectory = await createFileSystem().exists(veryfrontDirectory);
  const createdFiles: string[] = [];

  try {
    await writeProjectLink(options.projectDir, {
      controlPlane: options.config.apiUrl,
      projectId: options.project.id,
      projectSlug: options.project.slug,
    });

    if (!packageJsonExists) {
      createdFiles.push(join(options.projectDir, PACKAGE_JSON_PATH));
      await createPackageJson(options.projectDir, options.project.slug);
    }
    if (!tsconfigExists) {
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
