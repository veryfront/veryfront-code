/**
 * Project Resolution
 *
 * The single owner of "which project does this directory target, and does it
 * exist on the control plane?". One request carries the project directory, the
 * resolved config, where the project reference came from, and a client seam;
 * it settles into one typed outcome (existing, created, or planned-create).
 * Callers are presentation adapters: they own their own message wording and
 * spinners, this module owns the decision and the one persisted link format
 * (`.veryfront/project.json`).
 *
 * @module cli/shared/project-resolution
 */

import { createFileSystem } from "veryfront/platform";
import { join } from "veryfront/platform/path";
import { VeryfrontError } from "veryfront/errors";
import type { ProjectReferenceSource, ResolvedConfig } from "./config.ts";
import { writeProjectLink } from "./project-link.ts";
import { normalizeProjectSlug } from "./slug.ts";

/** A project as the control plane identifies it. */
export interface ProjectTargetRef {
  id: string;
  slug: string;
}

/**
 * The one seam between resolution and the control plane. Adapters wire this
 * over whichever transport they already hold (deploy control plane, CLI API
 * client, demo token); tests wire an in-memory fake.
 */
export interface ProjectResolutionClient {
  getProject(reference: string): Promise<ProjectTargetRef>;
  reserveSlug(
    slug: string,
    options: { allowAlternativeSlug: boolean },
  ): Promise<{ slug: string; projectId: string }>;
}

export interface ProjectResolutionRequest {
  projectDir: string;
  config: ResolvedConfig;
  source: ProjectReferenceSource;
  client: ProjectResolutionClient;
  /** Plan only: never reserve a slug, never write a project link. */
  dryRun?: boolean;
  /**
   * What to do when a named (non-inferred) reference is not found remotely:
   * create the project (push) or report it (deploy). Defaults to reporting.
   */
  createMissingReference?: boolean;
  /** Defaults to true only for inferred references. */
  allowAlternativeSlug?: boolean;
}

export type ProjectResolutionOutcome =
  | {
    kind: "existing";
    config: ResolvedConfig;
    project: ProjectTargetRef;
    persisted: boolean;
  }
  | {
    kind: "created";
    config: ResolvedConfig;
    project: ProjectTargetRef;
    requestedSlug: string;
    persisted: boolean;
  }
  | { kind: "planned-create"; config: ResolvedConfig; plannedSlug: string };

/**
 * A named project reference did not resolve remotely. Adapters translate this
 * into their own wording; the module never phrases user-facing guidance.
 */
export class ProjectReferenceNotFoundError extends Error {
  constructor(
    readonly reference: string,
    readonly source: ProjectReferenceSource,
    readonly byId: boolean,
  ) {
    super(`Project "${reference}" was not found.`);
    this.name = "ProjectReferenceNotFoundError";
  }
}

/** The reference to look a project up by: its id when known, else its slug. */
export function projectApiReference(config: ResolvedConfig): string {
  return config.projectId ?? config.projectSlug;
}

/** Only directory-owned references earn a persisted local project link. */
export function shouldPersistProjectLink(source: ProjectReferenceSource): boolean {
  return source.kind === "inferred" || source.kind === "local-link";
}

/** Only an inferred slug may be silently replaced by an available alternative. */
export function canPersistAlternativeSlug(source: ProjectReferenceSource): boolean {
  return source.kind === "inferred";
}

export function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

/** Write `.veryfront/project.json` and fold the resolved identity into config. */
export async function persistProjectLink<T extends { apiUrl: string }>(
  projectDir: string,
  config: T,
  project: ProjectTargetRef,
): Promise<T & { projectId: string; projectSlug: string }> {
  await writeProjectLink(projectDir, {
    controlPlane: config.apiUrl,
    projectId: project.id,
    projectSlug: project.slug,
  });
  return { ...config, projectId: project.id, projectSlug: project.slug };
}

/** The slug a directory suggests: its package name, else its own name. */
export async function inferProjectSlugFromDirectory(projectDir: string): Promise<string> {
  const fs = createFileSystem();
  const packagePath = join(projectDir, "package.json");

  try {
    if (await fs.exists(packagePath)) {
      const pkg = JSON.parse(await fs.readTextFile(packagePath)) as { name?: string };
      if (pkg.name) return normalizeProjectSlug(pkg.name);
    }
  } catch {
    // Fall back to the directory name below.
  }

  const dirName = projectDir.split(/[/\\]/).filter(Boolean).pop() ?? "my-app";
  return normalizeProjectSlug(dirName);
}

/**
 * What a user can do about a slug that is already taken, phrased against the
 * place the slug came from.
 */
export function slugConflictAction(source: ProjectReferenceSource): string {
  switch (source.kind) {
    case "argument":
      return "Use a different --project value";
    case "environment":
      return "Update or remove VERYFRONT_PROJECT_SLUG";
    case "module-config":
      return `Update projectSlug in ${source.name}`;
    case "tenant-environment":
      return `Update or remove ${source.name}`;
    case "json-config":
    case "inferred":
      return "Choose a different project slug";
    case "local-link":
      return "Relink this project";
  }
}

async function createProject(
  request: ProjectResolutionRequest,
  allowAlternativeSlug: boolean,
): Promise<ProjectResolutionOutcome> {
  const { projectDir, config, source, client, dryRun = false } = request;
  const requestedSlug = config.projectSlug;
  const reserved = await client.reserveSlug(requestedSlug, { allowAlternativeSlug });
  const reservedConfig = { ...config, projectSlug: reserved.slug };
  const project = reserved.projectId
    ? { id: reserved.projectId, slug: reserved.slug }
    : await client.getProject(reserved.slug);

  const persisted = shouldPersistProjectLink(source) && !dryRun;
  return {
    kind: "created",
    config: persisted ? await persistProjectLink(projectDir, reservedConfig, project) : {
      ...reservedConfig,
      projectId: project.id,
      projectSlug: project.slug,
    },
    project,
    requestedSlug,
    persisted,
  };
}

/**
 * Resolve the project this directory targets, creating it when the reference
 * is the directory's own inference (or when the caller opts in for a named
 * reference that no longer exists).
 */
export async function resolveOrCreateProject(
  request: ProjectResolutionRequest,
): Promise<ProjectResolutionOutcome> {
  const {
    projectDir,
    config,
    source,
    client,
    dryRun = false,
    createMissingReference = false,
  } = request;
  const allowAlternativeSlug = request.allowAlternativeSlug ?? canPersistAlternativeSlug(source);

  const plannedCreate: ProjectResolutionOutcome = {
    kind: "planned-create",
    config,
    plannedSlug: config.projectSlug,
  };

  if (source.kind === "inferred") {
    // A dry run never reserves a slug, so the create can only be planned.
    return dryRun ? plannedCreate : createProject(request, allowAlternativeSlug);
  }

  const reference = projectApiReference(config);
  let project: ProjectTargetRef;
  try {
    project = await client.getProject(reference);
  } catch (error) {
    if (error instanceof VeryfrontError) throw error;
    if (getErrorStatus(error) !== 404) throw error;
    if (config.projectId) {
      throw new ProjectReferenceNotFoundError(reference, source, true);
    }
    if (!createMissingReference) {
      throw new ProjectReferenceNotFoundError(reference, source, false);
    }
    return dryRun ? plannedCreate : createProject(request, allowAlternativeSlug);
  }

  const persisted = shouldPersistProjectLink(source) && !dryRun;
  return {
    kind: "existing",
    config: persisted ? await persistProjectLink(projectDir, config, project) : {
      ...config,
      projectId: project.id,
      projectSlug: project.slug,
    },
    project,
    persisted,
  };
}
