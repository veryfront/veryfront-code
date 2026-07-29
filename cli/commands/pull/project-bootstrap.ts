import { createFileSystem } from "veryfront/platform";
import { join } from "veryfront/platform/path";
import { cliLogger } from "#cli/utils";
import type { ResolvedConfig } from "#cli/shared/config";
import { writeProjectLink } from "../../shared/project-link.ts";
import type { ProjectTarget } from "../../shared/deployment-provenance.ts";
import { createPackageJson, createTypeScriptConfig } from "../init/config-generator.ts";

const PACKAGE_JSON_PATH = "package.json";
const TSCONFIG_PATH = "tsconfig.json";

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

  await writeProjectLink(options.projectDir, {
    controlPlane: options.config.apiUrl,
    projectId: options.project.id,
    projectSlug: options.project.slug,
  });

  if (!packageJsonExists) await createPackageJson(options.projectDir);
  if (!tsconfigExists) await createTypeScriptConfig(options.projectDir);
}
