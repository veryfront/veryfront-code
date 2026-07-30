import { cliLogger } from "#cli/utils";
import type { ResolvedConfig } from "#cli/shared/config";
import {
  PROJECT_LINK_RELATIVE_PATH,
  readProjectLink,
  writeProjectLink,
} from "../../shared/project-link.ts";
import { normalizeControlPlane, type ProjectTarget } from "../../shared/deployment-provenance.ts";

const PACKAGE_JSON_PATH = "package.json";
const TSCONFIG_PATH = "tsconfig.json";
const PULL_PROTECTED_PROJECT_METADATA_PATHS = new Set([
  PACKAGE_JSON_PATH,
  TSCONFIG_PATH,
  PROJECT_LINK_RELATIVE_PATH,
]);

export interface PulledProjectLinkPlan {
  projectLinkAction: "create" | "update" | null;
  writeCount: number;
}

export interface PulledProjectLinkOptions {
  projectDir: string;
  config: ResolvedConfig;
  project: ProjectTarget;
  dryRun: boolean;
  quiet: boolean;
  plan?: PulledProjectLinkPlan;
}

export function isPullProtectedProjectMetadataPath(relativePath: string): boolean {
  return PULL_PROTECTED_PROJECT_METADATA_PATHS.has(relativePath);
}

export async function planPulledProjectLink(
  options: PulledProjectLinkOptions,
): Promise<PulledProjectLinkPlan> {
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

  return {
    projectLinkAction,
    writeCount: Number(projectLinkAction !== null),
  };
}

export async function writePulledProjectLink(
  options: PulledProjectLinkOptions,
): Promise<void> {
  const plan = options.plan ?? await planPulledProjectLink(options);

  if (options.dryRun) {
    if (!options.quiet) {
      if (plan.projectLinkAction) {
        cliLogger.info(`  Would ${plan.projectLinkAction}: ${PROJECT_LINK_RELATIVE_PATH}`);
      }
    }
    return;
  }

  if (plan.projectLinkAction) {
    await writeProjectLink(options.projectDir, {
      controlPlane: options.config.apiUrl,
      projectId: options.project.id,
      projectSlug: options.project.slug,
    });
  }
}
