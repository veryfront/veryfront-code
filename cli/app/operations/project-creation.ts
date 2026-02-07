/**
 * Project Creation Operations
 *
 * Handles creating new projects from templates or examples,
 * including remote project registration and local scaffolding.
 */

import { cwd } from "veryfront/platform";
import type { AppState, ProjectInfo } from "../state.ts";
import { addLog, navigateTo, setProjects, startInput, updateRemote } from "../state.ts";
import { readToken } from "../../auth/token-store.ts";
import { fetchRemoteProjects } from "../../sync/index.ts";
import {
  copyDirectory,
  createRemoteProject,
  generateRandomSlug,
  getLocalProjectsFromState,
  normalizeSlug,
} from "../utils.ts";
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
    const { slug } = await createRemoteProject(token, normalizedSlug);
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

/**
 * Create a new project from an example
 */
export async function createProjectFromExample(
  ctx: ProjectCreationContext,
  projectName: string,
  example: ProjectInfo,
): Promise<AppState> {
  let { state } = ctx;

  try {
    state = addLog("info", `Creating project from ${example.slug}...`)(state);
    ctx.render();

    const token = await readToken();
    if (!token) {
      return addLog("error", "Not authenticated. Press 'a' to login.")(state);
    }

    const normalizedSlug = normalizeSlug(projectName);
    const { slug } = await createRemoteProject(token, normalizedSlug);
    const projectPath = `${cwd()}/projects/${slug}`;

    await copyDirectory(example.path, projectPath);

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

    return addLog("info", `Created ${slug} from ${example.slug}`)(state);
  } catch (error) {
    return addLog("error", `Failed: ${error}`)(state);
  }
}

/**
 * Prompt for project name and create from template
 */
export function promptForProjectName(
  state: AppState,
  template: InitTemplate,
  onComplete: (newState: AppState) => void,
  onCancel: () => void,
  render: () => void,
): AppState {
  const suggested = generateRandomSlug();

  return startInput(
    "Project name",
    async (name: string) => {
      if (name.trim()) {
        const ctx = { state, render };
        const newState = await createProject(ctx, name.trim(), template);
        onComplete(navigateTo("dashboard")(newState));
      } else {
        onComplete(navigateTo("dashboard")(state));
      }
    },
    onCancel,
    suggested,
  )(state);
}

/**
 * Prompt for project name and create from example
 */
export function promptForExampleProject(
  state: AppState,
  example: ProjectInfo,
  onComplete: (newState: AppState) => void,
  onCancel: () => void,
  render: () => void,
): AppState {
  const suggested = generateRandomSlug();

  return startInput(
    "Project name",
    async (name: string) => {
      if (name.trim()) {
        const ctx = { state, render };
        const newState = await createProjectFromExample(ctx, name.trim(), example);
        onComplete(navigateTo("dashboard")(newState));
      } else {
        onComplete(navigateTo("dashboard")(state));
      }
    },
    onCancel,
    suggested,
  )(state);
}
