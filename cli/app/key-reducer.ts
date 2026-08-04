/**
 * Key Transition
 *
 * The single owner of "what does this key press do?". A pure function of
 * (state, key) that settles into the next state plus the effects the shell
 * should perform. Nothing here touches the terminal, the network, or the
 * clock, so every key path is reachable from a test through this one
 * interface, the same one the shell uses.
 *
 * Effects are data, never callbacks. The shell performs them; this module
 * decides them.
 */

import type { InitTemplate } from "../commands/init/types.ts";
import {
  addLog,
  type AppState,
  endInput,
  getActiveSelection,
  goBack,
  navigateTo,
  type ProjectInfo,
  scrollLogs,
  setActiveList,
  startInput,
  toggleHelp,
  toggleLogsExpanded,
  updateActiveList,
  updateInputValue,
} from "./state.ts";
import {
  type ListSelectState,
  moveDown,
  moveUp,
  selectByNumber,
} from "./components/list-select.ts";
import { handleInputKey } from "./components/inline-input.ts";

export const KEY_UP = "\x1b[A";
export const KEY_DOWN = "\x1b[B";
export const KEY_ESCAPE = "\x1b";
export const KEY_ENTER = "\r";
export const KEY_NEWLINE = "\n";
export const KEY_CTRL_C = "\x03";
export const KEY_TAB = "\t";

/** How many list rows the dashboard shows at once. */
const VISIBLE_COUNT = 5;

export type AuthProvider = "google" | "github" | "microsoft";

export const AUTH_PROVIDERS: AuthProvider[] = ["google", "github", "microsoft"];

/** Work the shell performs on the reducer's behalf. */
export type Effect =
  | { kind: "exit" }
  | { kind: "open-browser"; project: ProjectInfo }
  | { kind: "open-studio"; project: ProjectInfo }
  | { kind: "open-ide"; project: ProjectInfo }
  | { kind: "pull"; project: ProjectInfo }
  | { kind: "push"; project: ProjectInfo }
  | { kind: "login"; provider: AuthProvider }
  | { kind: "logout" }
  | { kind: "open-mcp-settings" }
  | { kind: "create-project"; template: InitTemplate; name: string };

export interface KeyResult {
  state: AppState;
  effects: Effect[];
}

/**
 * The impure facts the transition needs. Injected rather than reached for, so
 * the reducer stays a pure function and tests can pin the suggestion.
 */
export interface KeyEnv {
  /** Pre-filled value for the project-name prompt. */
  suggestProjectName: () => string;
}

const none = (state: AppState): KeyResult => ({ state, effects: [] });

/**
 * Reduce one key press against the current state.
 *
 * The returned state is always the state to adopt, there is no second write
 * path. Callers assign it and run the effects; they never mutate state
 * themselves.
 */
export function reduceKey(state: AppState, key: string, env: KeyEnv): KeyResult {
  if (state.input.active) return reduceInputKey(state, key);

  if (key === KEY_CTRL_C || (key === "q" && state.view === "dashboard")) {
    return { state, effects: [{ kind: "exit" }] };
  }

  if (key === KEY_ESCAPE) {
    return none(state.view === "dashboard" ? state : goBack()(state));
  }

  switch (state.view) {
    case "templates":
      return reduceTemplatesKey(state, key, env);
    case "new-project":
      return reduceNewProjectKey(state, key, env);
    case "auth":
      return reduceAuthKey(state, key);
    case "help":
      // Any key leaves help.
      return none(goBack()(state));
    case "dashboard":
      return reduceDashboardKey(state, key);
  }
}

function isEnter(key: string): boolean {
  return key === KEY_ENTER || key === KEY_NEWLINE;
}

/* ── text input ─────────────────────────────────────────────────────────── */

function reduceInputKey(state: AppState, key: string): KeyResult {
  const result = handleInputKey(key, state.input.value, state.input.cursorPos);

  if (!("action" in result)) {
    return none(updateInputValue(result.value, result.cursorPos)(state));
  }

  if (result.action === "cancel") {
    // Stay on whichever view opened the prompt.
    return none(endInput()(state));
  }

  const purpose = state.input.purpose;
  const name = state.input.value.trim();
  const settled = navigateTo("dashboard")(endInput()(state));

  if (purpose?.kind === "create-project" && name) {
    return {
      state: settled,
      effects: [{ kind: "create-project", template: purpose.template, name }],
    };
  }

  return none(settled);
}

/* ── views ──────────────────────────────────────────────────────────────── */

function reduceTemplatesKey(state: AppState, key: string, env: KeyEnv): KeyResult {
  if (key === KEY_UP || key === "k") {
    return none({ ...state, templates: moveUp(state.templates) });
  }

  if (key === KEY_DOWN || key === "j") {
    return none({
      ...state,
      templates: moveDown(state.templates, state.templates.items.length),
    });
  }

  if (isEnter(key)) {
    const selected = state.templates.items[state.templates.selectedIndex];
    if (!selected) return none(state);
    return none(promptForProjectName(state, selected.id as InitTemplate, env));
  }

  return none(state);
}

function reduceNewProjectKey(state: AppState, key: string, env: KeyEnv): KeyResult {
  const LAST = 1;

  if (key === KEY_UP || key === "k") {
    const next = state.newProjectIndex > 0 ? state.newProjectIndex - 1 : LAST;
    return none({ ...state, newProjectIndex: next });
  }

  if (key === KEY_DOWN || key === "j") {
    const next = state.newProjectIndex < LAST ? state.newProjectIndex + 1 : 0;
    return none({ ...state, newProjectIndex: next });
  }

  // A number both moves the cursor and confirms, matching the rendered hints.
  const chosen = key >= "1" && key <= "2" ? parseInt(key, 10) - 1 : null;
  if (chosen === null && !isEnter(key)) return none(state);

  const index = chosen ?? state.newProjectIndex;
  const picked = { ...state, newProjectIndex: index };

  return none(
    index === 0 ? navigateTo("templates")(picked) : promptForProjectName(picked, "minimal", env),
  );
}

function reduceAuthKey(state: AppState, key: string): KeyResult {
  const last = AUTH_PROVIDERS.length - 1;

  if (key === KEY_UP || key === "k") {
    const next = state.authProviderIndex > 0 ? state.authProviderIndex - 1 : last;
    return none({ ...state, authProviderIndex: next });
  }

  if (key === KEY_DOWN || key === "j") {
    const next = state.authProviderIndex < last ? state.authProviderIndex + 1 : 0;
    return none({ ...state, authProviderIndex: next });
  }

  const chosen = key >= "1" && key <= "3" ? parseInt(key, 10) - 1 : null;
  if (chosen === null && !isEnter(key)) return none(state);

  const index = chosen ?? state.authProviderIndex;
  const provider = AUTH_PROVIDERS[index];
  if (!provider) return none(state);

  const next = navigateTo("dashboard")(
    addLog("info", `Opening browser for ${provider} login...`)({
      ...state,
      authProviderIndex: index,
    }),
  );

  return { state: next, effects: [{ kind: "login", provider }] };
}

/* ── dashboard ──────────────────────────────────────────────────────────── */

function reduceDashboardKey(state: AppState, key: string): KeyResult {
  if (key === "l" || key === "L") return none(toggleLogsExpanded()(state));

  if (state.logsExpanded && state.logs.length > 0) {
    if (key === KEY_UP || key === "k") return none(scrollLogs("up")(state));
    if (key === KEY_DOWN || key === "j") return none(scrollLogs("down")(state));
  }

  if (key === KEY_UP || key === "k") {
    return none(updateActiveList((list) => moveUp(list))(state));
  }

  if (key === KEY_DOWN || key === "j") {
    return none(updateActiveList((list) => moveDown(list, VISIBLE_COUNT))(state));
  }

  if (key === KEY_TAB) return none(switchSection(state));

  if (key === "a" && !state.remote.user) return none(navigateTo("auth")(state));

  if (key === "x" && state.remote.user) {
    return { state, effects: [{ kind: "logout" }] };
  }

  if (key === "n") {
    return none(navigateTo("new-project")({ ...state, newProjectIndex: 0 }));
  }

  if (key === "?") return none(toggleHelp()(state));

  if (key === "m" && state.mcp.enabled) {
    return { state, effects: [{ kind: "open-mcp-settings" }] };
  }

  // Number shortcuts select within the active list and open the result, which
  // is what `[1]`-style markers in the rendered list promise.
  if (key >= "1" && key <= "9") {
    const num = parseInt(key, 10);
    const list = state[state.activeList];
    if (num > list.items.length) return none(state);

    // selectByNumber moves the cursor but not the window, so a pick outside
    // the visible rows would highlight nothing.
    const picked = updateActiveList((l) => scrollIntoView(selectByNumber(l, num), VISIBLE_COUNT))(
      state,
    );
    const project = list.items[num - 1]?.data;
    return project ? { state: picked, effects: [{ kind: "open-browser", project }] } : none(picked);
  }

  const selected = getActiveSelection(state)?.data;
  if (!selected) return none(state);

  if (isEnter(key) || key === "o") {
    return { state, effects: [{ kind: "open-browser", project: selected }] };
  }

  if (key === "s") return { state, effects: [{ kind: "open-studio", project: selected }] };
  if (key === "i") return { state, effects: [{ kind: "open-ide", project: selected }] };
  if (key === "p") return { state, effects: [{ kind: "pull", project: selected }] };

  // Push needs a working copy on disk; a remote project has not been pulled yet.
  if (key === "u" && selected.type === "local") {
    return { state, effects: [{ kind: "push", project: selected }] };
  }

  return none(state);
}

/** Keep the selected row inside the visible window. */
function scrollIntoView<T>(
  list: ListSelectState<T>,
  visibleCount: number,
): ListSelectState<T> {
  const { selectedIndex, scrollOffset } = list;
  if (selectedIndex < scrollOffset) return { ...list, scrollOffset: selectedIndex };
  if (selectedIndex >= scrollOffset + visibleCount) {
    return { ...list, scrollOffset: selectedIndex - visibleCount + 1 };
  }
  return list;
}

/** Cycle between the local and remote sections, skipping empty ones. */
function switchSection(state: AppState): AppState {
  const sections: Array<AppState["activeList"]> = [];
  if (state.projects.items.length > 0) sections.push("projects");
  if (state.remote.user && state.remoteProjects.items.length > 0) {
    sections.push("remoteProjects");
  }
  if (sections.length < 2) return state;

  const current = sections.indexOf(state.activeList);
  const next = sections[(current + 1) % sections.length];
  return next ? setActiveList(next)(state) : state;
}

function promptForProjectName(
  state: AppState,
  template: InitTemplate,
  env: KeyEnv,
): AppState {
  return startInput(
    "Project name",
    { kind: "create-project", template },
    env.suggestProjectName(),
  )(state);
}
