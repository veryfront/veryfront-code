/**
 * Project Creation Operations
 *
 * Handles creating new projects from templates,
 * including remote project registration and local scaffolding.
 */

import { createFileSystem, cwd } from "veryfront/platform";
import { join } from "veryfront/platform/path";
import type { AppState } from "../state.ts";
import { addLog, setProjects, setRemoteProjects } from "../state.ts";
import { readToken } from "../../auth/token-store.ts";
import { fetchRemoteProjects } from "../../sync/index.ts";
import { getLocalProjectsFromState } from "../utils.ts";
import { reserveProjectSlug } from "../../shared/reserve-slug.ts";
import { normalizeProjectSlug } from "../../shared/slug.ts";
import { resolveOrCreateProject } from "../../shared/project-resolution.ts";
import {
  assertApiUrlAcceptsNewCredential,
  createApiClient,
  type ResolvedConfig,
} from "../../shared/config.ts";
import { getProjectTarget } from "../../shared/deployment-provenance.ts";
import { resolveCliApiUrl } from "../../shared/constants.ts";
import { createProject as createSharedProject } from "../../shared/project-creation.ts";
import type { InitTemplate } from "../../commands/init/types.ts";

export interface ProjectCreationContext {
  state: AppState;
  render: () => void;
  /** Directory whose `projects/` folder receives the new project. Defaults to the working directory. */
  baseDir?: string;
}

/**
 * Create a new project from a template
 */
export async function createProject(
  ctx: ProjectCreationContext,
  projectName: string,
  template: InitTemplate,
): Promise<AppState> {
  let { state } = ctx;

  try {
    const baseDir = ctx.baseDir ?? cwd();
    state = addLog("info", "Creating project...")(state);
    ctx.render();

    const token = await readToken();
    if (!token) {
      return addLog("error", "Not authenticated. Press 'a' to login.")(state);
    }
    await assertApiUrlAcceptsNewCredential();

    const normalizedSlug = normalizeProjectSlug(projectName);
    const reserved = await reserveProjectSlug(normalizedSlug, token);
    const slug = reserved.slug;

    // `veryfront init` deliberately scaffolds into a directory that is already
    // there. This caller must not: it has just reserved a brand new remote
    // slug, and `resolveOrCreateProject` below writes the link for it. Adopting
    // an existing `projects/<slug>` would point a directory that is already
    // someone else's project at the project just reserved.
    const projectDir = join(baseDir, "projects", slug);
    if (await createFileSystem().exists(projectDir)) {
      return addLog(
        "error",
        `projects/${slug} already exists. Remove it or choose a different name.`,
      )(state);
    }

    const creation = await createSharedProject({
      name: slug,
      parentDir: join(baseDir, "projects"),
      template,
      runtime: "node",
      integrations: [],
      environmentValues: {},
      conflictPolicy: "fail",
      installDependencies: false,
      initializeGit: false,
      includePackageMetadata: false,
    });

    // A project the TUI just reserved is this directory's project, so it
    // resolves through the same owner as every other create: reservation
    // responses that omit the id still settle on the canonical one, and the
    // link is always written.
    const config: ResolvedConfig = {
      apiUrl: resolveCliApiUrl(),
      apiToken: token,
      projectSlug: slug,
    };
    await resolveOrCreateProject({
      projectDir: creation.projectDir,
      config,
      source: { kind: "inferred", name: "project files" },
      client: {
        getProject: (reference) => getProjectTarget(createApiClient(config), reference),
        // The slug is reserved before scaffolding so the directory can take
        // its name; hand that reservation over rather than taking a second.
        reserveSlug: () => Promise.resolve(reserved),
      },
    });

    const currentProjects = getLocalProjectsFromState(state);
    currentProjects.push({ slug, path: creation.projectDir });
    state = setProjects(currentProjects)(state);

    const result = await fetchRemoteProjects();
    state = setRemoteProjects(result.projects, baseDir)(state);

    return addLog("info", `Created ${slug}`)(state);
  } catch (error) {
    return addLog("error", `Failed: ${error}`)(state);
  }
}
