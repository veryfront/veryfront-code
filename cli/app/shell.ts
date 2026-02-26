/**
 * CLI App Shell
 *
 * Main app shell that orchestrates the TUI experience.
 * Uses cross-runtime platform abstractions for terminal I/O.
 */

import { cwd, exit, isInteractive, isStdoutTTY, writeStdout } from "veryfront/platform";
import { join } from "veryfront/platform/path";
import { createEscapeBuffer, getStdinReader, setRawMode } from "veryfront/platform";
import { cursor, screen } from "../ui/ansi.ts";
import { dim } from "../ui/colors.ts";
import { getTerminalWidth } from "../ui/layout.ts";

import type { App, AppConfig } from "./types.ts";
import {
  addLog,
  type AppState,
  createInitialState,
  endInput,
  getActiveSelection,
  goBack,
  navigateTo,
  scrollLogs,
  setActiveList,
  setProjects,
  setTemplates,
  startInput,
  type StateUpdater,
  toggleHelp,
  toggleLogsExpanded,
  updateActiveList,
  updateInputValue,
  updateMCP,
  updateRemote,
  updateServer,
} from "./state.ts";
import { moveDown, moveUp, selectByNumber } from "./components/list-select.ts";
import { handleInputKey, renderInput, renderLogs } from "./components/inline-input.ts";
import {
  renderAuthView,
  renderDashboard,
  renderEmptyState,
  renderHelpView,
  renderNewProjectView,
  renderTemplatesView,
} from "./views/index.ts";
import { openInBrowser, openInIDE, openInStudio, openMCPSettings } from "./actions.ts";
import { generateRandomSlug, pullRemoteProject } from "./utils.ts";
import type { InitTemplate } from "../commands/init/types.ts";
import { logout, validateToken } from "../auth/login.ts";
import { readToken } from "../auth/token-store.ts";
import { openBrowser } from "../auth/browser.ts";
import { fetchRemoteProjects } from "../sync/index.ts";
import { pullCommand } from "../commands/pull/index.ts";
import { pushCommand } from "../commands/push/index.ts";

// Import extracted modules
import {
  moveRemoteFocusDown,
  moveRemoteFocusUp,
  updateRemoteFocus,
} from "./handlers/remote-navigation.ts";
import {
  handleAuthKey,
  handleNewProjectKey,
  handleTemplatesKey,
  type ViewHandlerContext,
} from "./handlers/view-handlers.ts";
import { createProject } from "./operations/project-creation.ts";
import { interceptConsole } from "./logging/console-interceptor.ts";

const KEY_UP = "\x1b[A";
const KEY_DOWN = "\x1b[B";
const KEY_ESCAPE = "\x1b";
const KEY_ENTER = "\r";
const KEY_NEWLINE = "\n";
const KEY_CTRL_C = "\x03";

/**
 * Create the CLI app
 */
export function createApp(config: AppConfig): App {
  let state = createInitialState();
  let running = false;
  let spinnerInterval: number | null = null;

  const isInteractiveMode = !config.headless && isInteractive() && isStdoutTTY();

  state = setProjects(
    Array.from(config.projects.entries()).map(([slug, path]) => ({ slug, path })),
  )(state);

  if (state.projects.items.length > 0) {
    state = { ...state, activeList: "projects" };
  }

  state = setTemplates([
    { id: "ai-assistant", name: "AI Chatbot", description: "Agent + chat UI + streaming" },
    { id: "chat-with-your-docs", name: "Chat with Docs", description: "RAG with source citations" },
    {
      id: "multi-agent-system",
      name: "Multi-Agent",
      description: "Agents that delegate to each other",
    },
    { id: "agentic-workflow", name: "AI Workflow", description: "Steps + approvals + parallelism" },
    { id: "coding-agent", name: "Coding Agent", description: "AI code assistant with file tools" },
    { id: "saas-starter", name: "AI SaaS", description: "Auth + chat + per-user memory" },
    { id: "minimal", name: "Minimal", description: "Blank canvas" },
  ])(state);

  state = updateServer({
    port: config.port,
    url: `http://veryfront.me:${config.port}`,
  })(state);

  state = updateMCP({
    enabled: config.mcpPort !== undefined,
    transport: config.mcpPort ? "http" : null,
    httpPort: config.mcpPort,
  })(state);

  // Check for existing auth
  void (async () => {
    try {
      const token = await readToken();
      if (!token) return;

      const user = await validateToken(token);
      if (!user) return;

      const result = await fetchRemoteProjects();
      state = updateRemote({
        user,
        projects: result.projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
      })(state);
    } catch {
      // Auth check failed - non-fatal
    }
  })();

  const write = (text: string): void => writeStdout(text);

  function render(): void {
    let content: string;

    switch (state.view) {
      case "dashboard":
        content = state.projects.items.length > 0
          ? renderDashboard(state)
          : renderEmptyState(state);
        break;
      case "new-project":
        content = renderNewProjectView(state);
        break;
      case "templates":
        content = renderTemplatesView(state);
        break;
      case "auth":
        content = renderAuthView(state);
        break;
      case "help":
        content = renderHelpView(state);
        break;
      default:
        content = renderDashboard(state);
    }

    const parts: string[] = [content];
    const dividerWidth = Math.min(getTerminalWidth() - 4, 80);

    if (state.logs.length > 0) {
      const logsHeader = state.logsExpanded ? "▼ Logs" : "▶ Logs";
      parts.push("");
      parts.push(dim("─".repeat(dividerWidth)));
      parts.push(
        `  ${dim(logsHeader)} ${dim(`(${state.logs.length})`)}  ${dim("l")} ${dim("toggle")}  ${
          state.logsExpanded ? `${dim("↑↓")} ${dim("scroll")}` : ""
        }`,
      );
      parts.push(renderLogs(state.logs, {
        maxLines: state.logsExpanded ? 15 : 3,
        scroll: state.logScroll,
        expanded: state.logsExpanded,
      }));
    }

    if (state.input.active) {
      parts.push("");
      parts.push(dim("─".repeat(dividerWidth)));
      parts.push(renderInput(state.input));
    }

    if (!isInteractiveMode) return;

    write(cursor.moveTo(1, 1) + screen.clearDown);
    write("\n" + parts.join("\n"));
  }

  function update(updater: StateUpdater): void {
    state = updater(state);
    if (isInteractiveMode) render();
  }

  function startSpinner(): void {
    if (spinnerInterval) return;
    spinnerInterval = setInterval(() => {
      render();
    }, 80) as unknown as number;
  }

  function stopSpinner(): void {
    if (!spinnerInterval) return;
    clearInterval(spinnerInterval);
    spinnerInterval = null;
  }

  type ProjectCreationHandler = (
    ctx: { state: AppState; render: () => void },
    projectName: string,
  ) => Promise<AppState>;

  type ProjectCreationWithSource<T> = (
    ctx: { state: AppState; render: () => void },
    projectName: string,
    source: T,
  ) => Promise<AppState>;

  function promptForProject(creator: ProjectCreationHandler, onCancel: () => void): void {
    const suggested = generateRandomSlug();
    state = startInput(
      "Project name",
      async (name: string) => {
        const projectName = name.trim();
        if (projectName) {
          const ctx = { state, render };
          state = await creator(ctx, projectName);
        }
        state = navigateTo("dashboard")(state);
        render();
      },
      onCancel,
      suggested,
    )(state);
    render();
  }

  // Project creation prompts using extracted module
  function promptForProjectWithSource<T>(
    source: T,
    creator: ProjectCreationWithSource<T>,
    onCancel: () => void,
  ): void {
    return promptForProject(
      (ctx, projectName) => creator(ctx, projectName, source),
      onCancel,
    );
  }

  function promptForProjectName(template: InitTemplate, onCancel: () => void): void {
    return promptForProjectWithSource(template, createProject, onCancel);
  }

  // View handler context for delegating to extracted handlers
  function getViewHandlerContext(): ViewHandlerContext {
    return {
      state,
      render,
      update,
      promptForProjectName,
    };
  }

  async function handleKey(key: string): Promise<void> {
    // Handle input mode
    if (state.input.active) {
      const result = handleInputKey(key, state.input.value, state.input.cursorPos);

      if ("action" in result) {
        if (result.action === "submit" && state.input.onSubmit) {
          const value = state.input.value;
          const onSubmit = state.input.onSubmit;
          state = endInput()(state);
          render();
          await onSubmit(value);
          return;
        }

        if (result.action === "cancel") {
          const onCancel = state.input.onCancel;
          state = endInput()(state);
          render();
          onCancel?.();
          return;
        }

        return;
      }

      state = updateInputValue(result.value, result.cursorPos)(state);
      render();
      return;
    }

    // Global keys
    if (key === KEY_CTRL_C || (key === "q" && state.view === "dashboard")) {
      stop();
      exit(0);
    }

    if (key === KEY_ESCAPE) {
      if (state.view !== "dashboard") update(goBack());
      return;
    }

    // View-specific handlers (delegated to extracted modules)
    const ctx = getViewHandlerContext();

    switch (state.view) {
      case "templates": {
        const result = handleTemplatesKey(key, ctx);
        if (result.handled) {
          state = result.state;
          render();
        }
        return;
      }
      case "new-project": {
        const result = handleNewProjectKey(key, ctx);
        if (result.handled) {
          state = result.state;
          render();
        }
        return;
      }
      case "auth": {
        const result = handleAuthKey(key, ctx);
        if (result.handled) {
          state = result.state;
          render();
        }
        return;
      }
      case "help":
        update(goBack());
        return;
    }

    // Dashboard key handlers
    if (key === "l" || key === "L") {
      update(toggleLogsExpanded());
      return;
    }

    if (state.logsExpanded && state.logs.length > 0) {
      if (key === KEY_UP || key === "k") {
        update(scrollLogs("up"));
        return;
      }
      if (key === KEY_DOWN || key === "j") {
        update(scrollLogs("down"));
        return;
      }
    }

    // Navigation with extracted remote navigation handlers
    if (key === KEY_UP || key === "k") {
      if (state.activeList === "remoteProjects") {
        update(moveRemoteFocusUp(state));
      } else {
        update(updateActiveList((list) => moveUp(list)));
      }
      return;
    }

    if (key === KEY_DOWN || key === "j") {
      if (state.activeList === "remoteProjects") {
        update(moveRemoteFocusDown(state));
      } else {
        update(updateActiveList((list) => moveDown(list, 5)));
      }
      return;
    }

    // Tab to switch sections
    if (key === "\t") {
      const hasProjects = state.projects.items.length > 0;
      const hasRemoteProjects = !!state.remote.user && state.remote.projects.length > 0;

      const sections: Array<"projects" | "remoteProjects"> = [];
      if (hasProjects) sections.push("projects");
      if (hasRemoteProjects) sections.push("remoteProjects");

      if (sections.length > 1) {
        const currentIndex = sections.indexOf(state.activeList as typeof sections[number]);
        const nextIndex = (currentIndex + 1) % sections.length;
        const nextSection = sections[nextIndex];
        if (nextSection) update(setActiveList(nextSection));
      }
      return;
    }

    // Number/letter selection for remote projects
    if (key >= "1" && key <= "9" && state.activeList === "remoteProjects") {
      const num = parseInt(key, 10);
      if (num <= state.remote.projects.length) {
        update(updateRemoteFocus(state, num - 1));
      }
      return;
    }

    if (
      key >= "a" && key <= "z" && key !== "j" && key !== "k" && key !== "p" && key !== "u" &&
      key !== "o" && key !== "s" && key !== "i" &&
      state.activeList === "remoteProjects"
    ) {
      const num = key.charCodeAt(0) - 96 + 9;
      if (num <= state.remote.projects.length) {
        update(updateRemoteFocus(state, num - 1));
      }
      return;
    }

    // Auth actions
    if (key === "a" && !state.remote.user) {
      update(navigateTo("auth"));
      return;
    }

    if (key === "x" && state.remote.user) {
      await logout();
      update(updateRemote({ user: null, projects: [], focusedIndex: 0, scrollOffset: 0 }));
      update(addLog("info", "Logged out"));
      return;
    }

    // Number/letter selection for local projects/examples
    if (key >= "1" && key <= "9" && state.activeList !== "remoteProjects") {
      const num = parseInt(key, 10);
      const activeList = state[state.activeList];
      if (num <= activeList.items.length) {
        state = { ...state, [state.activeList]: selectByNumber(activeList, num) };
        render();
        const selected = activeList.items[num - 1];
        if (selected?.data) await openInBrowser(selected.data, state.server.port);
        return;
      }
    }

    // Open selected item
    if (key === KEY_ENTER || key === KEY_NEWLINE) {
      if (state.activeList === "remoteProjects") {
        const focused = state.remote.projects[state.remote.focusedIndex];
        if (focused) {
          const url = `http://${focused.slug}.veryfront.me:${state.server.port}`;
          await openBrowser(url);
        }
        return;
      }

      const selected = getActiveSelection(state);
      if (selected?.data) await openInBrowser(selected.data, state.server.port);
      return;
    }

    if (key === "o") {
      if (state.activeList === "remoteProjects") {
        const focused = state.remote.projects[state.remote.focusedIndex];
        if (focused) {
          const url = `http://${focused.slug}.veryfront.me:${state.server.port}`;
          await openBrowser(url);
        }
        return;
      }

      const selected = getActiveSelection(state);
      if (selected?.data) await openInBrowser(selected.data, state.server.port);
      return;
    }

    if (key === "s") {
      if (state.activeList === "remoteProjects") {
        const focused = state.remote.projects[state.remote.focusedIndex];
        if (focused) {
          const url = `https://veryfront.com/projects/${focused.slug}`;
          await openBrowser(url);
        }
        return;
      }

      const selected = getActiveSelection(state);
      if (selected?.data) await openInStudio(selected.data);
      return;
    }

    if (key === "i") {
      if (state.activeList === "remoteProjects") {
        const focused = state.remote.projects[state.remote.focusedIndex];
        if (focused) {
          const projectDir = join(cwd(), "projects", focused.slug);
          await openInIDE({ slug: focused.slug, path: projectDir, type: "local" });
        }
        return;
      }

      const selected = getActiveSelection(state);
      if (selected?.data) await openInIDE(selected.data);
      return;
    }

    if (key === "n") {
      state = { ...state, newProjectIndex: 0 };
      update(navigateTo("new-project"));
      return;
    }

    if (key === "?") {
      update(toggleHelp());
      return;
    }

    if (key === "m" && state.mcp.enabled) {
      const result = await openMCPSettings();
      update(
        addLog(
          result.success ? "info" : "error",
          result.message ||
            (result.success ? "Opened MCP settings" : "Failed to open MCP settings"),
        ),
      );
      return;
    }

    // Pull/push operations
    if (key === "p" && state.activeList === "remoteProjects") {
      const focused = state.remote.projects[state.remote.focusedIndex];
      if (focused) await pullRemoteProject(state, update, render, focused.slug);
      return;
    }

    if (key === "p" && state.activeList === "projects") {
      const selected = state.projects.items[state.projects.selectedIndex];
      if (!selected?.data) return;

      const token = await readToken();
      if (!token) {
        update(addLog("error", "Not authenticated. Press 'a' to login."));
        render();
        return;
      }

      const { slug, path: projectDir } = selected.data;
      update(addLog("info", `Pulling ${slug}...`));
      render();

      try {
        await pullCommand({ projectSlug: slug, projectDir, force: true, quiet: true });
        update(addLog("info", `Pulled ${slug}`));
      } catch (err) {
        update(addLog("error", `Pull failed: ${err instanceof Error ? err.message : String(err)}`));
      }

      render();
      return;
    }

    if (key === "u" && state.activeList === "projects") {
      const selected = state.projects.items[state.projects.selectedIndex];
      if (!selected?.data) return;

      const { slug, path: projectDir } = selected.data;
      update(addLog("info", `Pushing ${slug}...`));
      render();

      try {
        await pushCommand({ projectSlug: slug, projectDir, force: true, quiet: true });
        update(addLog("info", `Pushed ${slug} — merge in Studio`));
      } catch (err) {
        update(addLog("error", `Push failed: ${err instanceof Error ? err.message : String(err)}`));
      }

      render();
    }
  }

  async function handleInput(): Promise<void> {
    if (!isInteractive()) return;

    setRawMode(true);
    const reader = getStdinReader();
    const decoder = new TextDecoder();
    const escapeBuffer = createEscapeBuffer((key) => handleKey(key));

    try {
      while (running) {
        const { value, done } = await reader.read();
        if (done) break;

        const key = escapeBuffer.push(decoder.decode(value));
        if (key) await handleKey(key);
      }
    } finally {
      escapeBuffer.clear();
      reader.releaseLock();
      try {
        setRawMode(false);
      } catch {
        // Ignore if stdin is already closed
      }
    }
  }

  function start(): void {
    running = true;

    if (!isInteractiveMode) {
      console.log(`Server running on http://veryfront.me:${config.port}`);
      if (config.mcpPort) console.log(`MCP available at http://veryfront.me:${config.mcpPort}/mcp`);
      return;
    }

    write(screen.altOn + cursor.hide);
    render();
    handleInput();

    if (!state.server.running) startSpinner();
  }

  function stop(): void {
    running = false;
    stopSpinner();

    if (isInteractiveMode) write(cursor.show + screen.altOff);
  }

  return {
    start,
    stop,
    update,
    getState: (): AppState => state,
    render,
    setServerReady: (): void => {
      stopSpinner();
      update(updateServer({ running: true }));
    },
    addError: (): void => {
      update(updateServer({ errors: state.server.errors + 1 }));
    },
    clearErrors: (): void => {
      update(updateServer({ errors: 0, warnings: 0 }));
    },
    log: (level: "info" | "warn" | "error" | "debug", message: string): void => {
      update(addLog(level, message));
    },
    interceptConsole: (): () => void => {
      if (!isInteractiveMode) return () => {};

      return interceptConsole({
        updateState: update,
        render,
      });
    },
  };
}
