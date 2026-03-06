/**
 * Project Creation Operations
 *
 * Handles creating new projects from templates,
 * including remote project registration and local scaffolding.
 */

import { cwd } from "veryfront/platform";
import type { AppState } from "../state.ts";
import { addLog, setProjects, updateRemote } from "../state.ts";
import { readToken } from "../../auth/token-store.ts";
import { fetchRemoteProjects } from "../../sync/index.ts";
import { getLocalProjectsFromState, normalizeSlug } from "../utils.ts";
import { reserveProjectSlug } from "../../shared/reserve-slug.ts";
import { initCommand } from "../../commands/init/init-command.ts";
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

    const normalizedSlug = normalizeSlug(projectName);
    const { slug } = await reserveProjectSlug(normalizedSlug, token);
    const projectPath = `${cwd()}/projects/${slug}`;

    await initCommand({
      name: `projects/${slug}`,
      template,
      skipInstall: true,
      skipEnvPrompt: true,
      quiet: true,
    });

    const currentProjects = getLocalProjectsFromState(state);
    currentProjects.push({ slug, path: projectPath });
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
