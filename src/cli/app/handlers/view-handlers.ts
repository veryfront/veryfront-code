/**
 * View-Specific Key Handlers
 *
 * Handlers for keyboard input in specific views like templates,
 * examples, new-project wizard, and authentication.
 */

import type { AppState, StateUpdater } from "../state.ts";
import { navigateTo } from "../state.ts";
import { moveDown, moveUp } from "../components/list-select.ts";
import type { InitTemplate } from "../../commands/init/types.ts";
import type { ProjectInfo } from "../state.ts";
import { login } from "../../auth/login.ts";
import { fetchRemoteProjects } from "../../sync/index.ts";
import { addLog, updateRemote } from "../state.ts";

const KEY_UP = "\x1b[A";
const KEY_DOWN = "\x1b[B";
const KEY_ENTER = "\r";
const KEY_NEWLINE = "\n";

export interface ViewHandlerContext {
  state: AppState;
  render: () => void;
  update: (updater: StateUpdater) => void;
  promptForProjectName: (template: InitTemplate, onCancel: () => void) => void;
  promptForExampleProject: (example: ProjectInfo, onCancel: () => void) => void;
}

/**
 * Handle keyboard input in the templates view
 */
export function handleTemplatesKey(
  key: string,
  ctx: ViewHandlerContext,
): { state: AppState; handled: boolean } {
  const { state, render, promptForProjectName } = ctx;

  if (key === KEY_UP || key === "k") {
    const newState = { ...state, templates: moveUp(state.templates) };
    return { state: newState, handled: true };
  }

  if (key === KEY_DOWN || key === "j") {
    const newState = {
      ...state,
      templates: moveDown(state.templates, state.templates.items.length),
    };
    return { state: newState, handled: true };
  }

  if (key === KEY_ENTER || key === KEY_NEWLINE) {
    const selected = state.templates.items[state.templates.selectedIndex];
    if (selected) {
      promptForProjectName(selected.id as InitTemplate, () => render());
    }
    return { state, handled: true };
  }

  return { state, handled: false };
}

/**
 * Handle keyboard input in the examples view
 */
export function handleExamplesKey(
  key: string,
  ctx: ViewHandlerContext,
): { state: AppState; handled: boolean } {
  const { state, render, promptForExampleProject } = ctx;

  if (key === KEY_UP || key === "k") {
    const newState = { ...state, examples: moveUp(state.examples) };
    return { state: newState, handled: true };
  }

  if (key === KEY_DOWN || key === "j") {
    const newState = {
      ...state,
      examples: moveDown(state.examples, state.examples.items.length),
    };
    return { state: newState, handled: true };
  }

  if (key === KEY_ENTER || key === KEY_NEWLINE) {
    const selected = state.examples.items[state.examples.selectedIndex];
    if (selected?.data) {
      promptForExampleProject(selected.data, () => render());
    }
    return { state, handled: true };
  }

  return { state, handled: false };
}

/**
 * Handle keyboard input in the new-project view
 */
export function handleNewProjectKey(
  key: string,
  ctx: ViewHandlerContext,
): { state: AppState; handled: boolean } {
  const { state, update, render, promptForProjectName } = ctx;

  if (key === KEY_UP || key === "k") {
    const newState = {
      ...state,
      newProjectIndex: state.newProjectIndex > 0 ? state.newProjectIndex - 1 : 2,
    };
    return { state: newState, handled: true };
  }

  if (key === KEY_DOWN || key === "j") {
    const newState = {
      ...state,
      newProjectIndex: state.newProjectIndex < 2 ? state.newProjectIndex + 1 : 0,
    };
    return { state: newState, handled: true };
  }

  if (key >= "1" && key <= "3") {
    const newState = { ...state, newProjectIndex: parseInt(key, 10) - 1 };
    return { state: newState, handled: true };
  }

  if (key !== KEY_ENTER && key !== KEY_NEWLINE && !(key >= "1" && key <= "3")) {
    return { state, handled: false };
  }

  // Handle selection
  switch (state.newProjectIndex) {
    case 0:
      update(navigateTo("templates"));
      return { state, handled: true };
    case 1:
      update(navigateTo("examples"));
      return { state, handled: true };
    case 2:
      promptForProjectName("minimal", () => render());
      return { state, handled: true };
  }

  return { state, handled: false };
}

/**
 * Handle keyboard input in the auth view
 */
export function handleAuthKey(
  key: string,
  ctx: ViewHandlerContext,
): { state: AppState; handled: boolean } {
  const { state, update, render } = ctx;

  const providerList: Array<"google" | "github" | "microsoft"> = [
    "google",
    "github",
    "microsoft",
  ];

  if (key === KEY_UP || key === "k") {
    const newState = {
      ...state,
      authProviderIndex: state.authProviderIndex > 0 ? state.authProviderIndex - 1 : 2,
    };
    return { state: newState, handled: true };
  }

  if (key === KEY_DOWN || key === "j") {
    const newState = {
      ...state,
      authProviderIndex: state.authProviderIndex < 2 ? state.authProviderIndex + 1 : 0,
    };
    return { state: newState, handled: true };
  }

  if (key >= "1" && key <= "3") {
    const newState = { ...state, authProviderIndex: parseInt(key, 10) - 1 };
    return { state: newState, handled: true };
  }

  if (key !== KEY_ENTER && key !== KEY_NEWLINE) {
    return { state, handled: false };
  }

  // Handle provider selection
  const provider = providerList[state.authProviderIndex];
  update(addLog("info", `Opening browser for ${provider} login...`));
  update(navigateTo("dashboard"));

  void (async () => {
    const user = await login(provider);
    if (user) {
      const result = await fetchRemoteProjects();
      update(
        updateRemote({
          user,
          projects: result.projects.map((p) => ({
            id: p.id,
            name: p.name,
            slug: p.slug,
          })),
        }),
      );
      update(addLog("info", `Logged in as ${user.email}`));
    }
    render();
  })();

  return { state, handled: true };
}
