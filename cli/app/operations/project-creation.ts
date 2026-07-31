/**
 * Project Creation Operations
 *
 * Handles creating new projects from templates,
 * including remote project registration and local scaffolding.
 */

import { cwd } from "veryfront/platform";
import { join } from "veryfront/platform/path";
import type { AppState } from "../state.ts";
import { addLog, setProjects, updateRemote } from "../state.ts";
import { readToken } from "../../auth/token-store.ts";
import { fetchRemoteProjects } from "../../sync/index.ts";
import { getLocalProjectsFromState } from "../utils.ts";
import { reserveProjectSlug } from "../../shared/reserve-slug.ts";
import { normalizeProjectSlug } from "../../shared/slug.ts";
import { persistProjectLink } from "../../shared/project-resolution.ts";
import { resolveCliApiUrl } from "../../shared/constants.ts";
import { createProject as createSharedProject } from "../../shared/project-creation.ts";
import type { InitTemplate } from "../../commands/init/types.ts";

export interface ProjectCreationContext {
  state: AppState;
  render: () => void;
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
    state = addLog("info", "Creating project...")(state);
    ctx.render();

    const token = await readToken();
    if (!token) {
      return addLog("error", "Not authenticated. Press 'a' to login.")(state);
    }

    const normalizedSlug = normalizeProjectSlug(projectName);
    const reserved = await reserveProjectSlug(normalizedSlug, token);
    const slug = reserved.slug;

    const creation = await createSharedProject({
      name: slug,
      parentDir: join(cwd(), "projects"),
      template,
      runtime: "node",
      features: [],
      integrations: [],
      environmentValues: {},
      conflictPolicy: "fail",
      installDependencies: false,
      initializeGit: false,
      includePackageMetadata: false,
    });

    // A project the TUI just reserved is this directory's project: record the
    // canonical link so every later command resolves it without inference.
    if (reserved.projectId) {
      await persistProjectLink(
        creation.projectDir,
        { apiUrl: resolveCliApiUrl(), apiToken: token, projectSlug: slug },
        { id: reserved.projectId, slug },
      );
    }

    const currentProjects = getLocalProjectsFromState(state);
    currentProjects.push({ slug, path: creation.projectDir });
    state = setProjects(currentProjects)(state);

    const result = await fetchRemoteProjects();
    state = updateRemote({
      projects: result.projects.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
      })),
    })(state);

    return addLog("info", `Created ${slug}`)(state);
  } catch (error) {
    return addLog("error", `Failed: ${error}`)(state);
  }
}
