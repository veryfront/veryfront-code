/**
 * CLI App Shell
 *
 * Main app shell that orchestrates the TUI experience.
 * Uses cross-runtime platform abstractions for terminal I/O.
 */

import {
  cwd,
  exit,
  isInteractive,
  isStdoutTTY,
  writeStdout,
} from "#veryfront/platform/compat/process.ts";
import { join } from "#veryfront/platform/compat/path/index.ts";
import {
  createEscapeBuffer,
  getStdinReader,
  setRawMode,
} from "#veryfront/platform/compat/stdin.ts";
import { cursor, screen } from "../ui/ansi.ts";
import { dim } from "../ui/colors.ts";
import { getTerminalWidth } from "../ui/layout.ts";
import { getLogBuffer } from "#veryfront/observability/log-buffer.ts";

import type { App, AppConfig } from "./types.ts";
import {
  addLog,
  type AppState,
  createInitialState,
  endInput,
  getActiveSelection,
  goBack,
  type LogMeta,
  navigateTo,
  type ProjectInfo,
  scrollLogs,
  setActiveList,
  setExamples,
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
  renderExamplesView,
  renderHelpView,
  renderNewProjectView,
  renderTemplatesView,
} from "./views/index.ts";
import { openInBrowser, openInIDE, openInStudio, openMCPSettings } from "./actions.ts";
import {
  copyDirectory,
  createRemoteProject,
  generateRandomSlug,
  getLocalProjectsFromState,
  normalizeSlug,
  pullRemoteProject,
} from "./utils.ts";
import { initCommand } from "../commands/init/init-command.ts";
import type { InitTemplate } from "../commands/init/types.ts";
import { login, logout, validateToken } from "../auth/login.ts";
import { readToken } from "../auth/token-store.ts";
import { openBrowser } from "../auth/browser.ts";
import { fetchRemoteProjects } from "../sync/index.ts";
import { pullCommand } from "../commands/pull/index.ts";
import { pushCommand } from "../commands/push/index.ts";

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

  if (config.examples) {
    state = setExamples(
      Array.from(config.examples.entries()).map(([slug, path]) => ({ slug, path })),
    )(state);
  }

  if (state.projects.items.length > 0) {
    state = { ...state, activeList: "projects" };
  } else if (state.examples.items.length > 0) {
    state = { ...state, activeList: "examples" };
  }

  state = setTemplates([
    { id: "minimal", name: "Minimal", description: "Bare-bones starter with just the essentials" },
    { id: "app", name: "App", description: "Full-featured app with routing and layouts" },
    { id: "ai", name: "AI", description: "AI-powered app with chat and agents" },
    { id: "blog", name: "Blog", description: "MDX-powered blog with syntax highlighting" },
    { id: "docs", name: "Docs", description: "Documentation site with search" },
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
        content = state.projects.items.length > 0 || state.examples.items.length > 0
          ? renderDashboard(state)
          : renderEmptyState();
        break;
      case "new-project":
        content = renderNewProjectView(state);
        break;
      case "templates":
        content = renderTemplatesView(state);
        break;
      case "examples":
        content = renderExamplesView(state);
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

  function updateRemoteFocus(newIndex: number): void {
    const visibleCount = 5;
    let scrollOffset = state.remote.scrollOffset;
    if (newIndex < scrollOffset) {
      scrollOffset = newIndex;
    } else if (newIndex >= scrollOffset + visibleCount) {
      scrollOffset = newIndex - visibleCount + 1;
    }
    update(updateRemote({ focusedIndex: newIndex, scrollOffset }));
  }

  function moveRemoteFocusUp(): void {
    const total = state.remote.projects.length;
    const visibleCount = 5;
    const newIndex = state.remote.focusedIndex > 0 ? state.remote.focusedIndex - 1 : total - 1;

    let scrollOffset = state.remote.scrollOffset;
    if (newIndex < scrollOffset) {
      scrollOffset = newIndex;
    } else if (newIndex === total - 1) {
      scrollOffset = Math.max(0, total - visibleCount);
    }
    update(updateRemote({ focusedIndex: newIndex, scrollOffset }));
  }

  function moveRemoteFocusDown(): void {
    const total = state.remote.projects.length;
    const visibleCount = 5;
    const newIndex = state.remote.focusedIndex < total - 1 ? state.remote.focusedIndex + 1 : 0;

    let scrollOffset = state.remote.scrollOffset;
    if (newIndex === 0) {
      scrollOffset = 0;
    } else if (newIndex >= scrollOffset + visibleCount) {
      scrollOffset = newIndex - visibleCount + 1;
    }
    update(updateRemote({ focusedIndex: newIndex, scrollOffset }));
  }

  async function createProject(projectName: string, template: InitTemplate): Promise<void> {
    try {
      state = addLog("info", "Creating project...")(state);
      render();

      const token = await readToken();
      if (!token) {
        state = addLog("error", "Not authenticated. Press 'a' to login.")(state);
        return;
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
        projects: result.projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
      })(state);

      state = addLog("info", `Created ${slug}`)(state);
    } catch (error) {
      state = addLog("error", `Failed: ${error}`)(state);
    }
  }

  async function createProjectFromExample(
    projectName: string,
    example: ProjectInfo,
  ): Promise<void> {
    try {
      state = addLog("info", `Creating project from ${example.slug}...`)(state);
      render();

      const token = await readToken();
      if (!token) {
        state = addLog("error", "Not authenticated. Press 'a' to login.")(state);
        return;
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
        projects: result.projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
      })(state);

      state = addLog("info", `Created ${slug} from ${example.slug}`)(state);
    } catch (error) {
      state = addLog("error", `Failed: ${error}`)(state);
    }
  }

  function promptForProjectName(template: InitTemplate, onCancel: () => void): void {
    const suggested = generateRandomSlug();
    state = startInput(
      "Project name",
      async (name: string) => {
        if (name.trim()) await createProject(name.trim(), template);
        state = navigateTo("dashboard")(state);
        render();
      },
      onCancel,
      suggested,
    )(state);
    render();
  }

  function promptForExampleProject(example: ProjectInfo, onCancel: () => void): void {
    const suggested = generateRandomSlug();
    state = startInput(
      "Project name",
      async (name: string) => {
        if (name.trim()) await createProjectFromExample(name.trim(), example);
        state = navigateTo("dashboard")(state);
        render();
      },
      onCancel,
      suggested,
    )(state);
    render();
  }

  function handleTemplatesKey(key: string): void {
    if (key === KEY_UP || key === "k") {
      state = { ...state, templates: moveUp(state.templates) };
      render();
      return;
    }

    if (key === KEY_DOWN || key === "j") {
      state = { ...state, templates: moveDown(state.templates, state.templates.items.length) };
      render();
      return;
    }

    if (key === KEY_ENTER || key === KEY_NEWLINE) {
      const selected = state.templates.items[state.templates.selectedIndex];
      if (selected) promptForProjectName(selected.id as InitTemplate, () => render());
    }
  }

  function handleExamplesKey(key: string): void {
    if (key === KEY_UP || key === "k") {
      state = { ...state, examples: moveUp(state.examples) };
      render();
      return;
    }

    if (key === KEY_DOWN || key === "j") {
      state = { ...state, examples: moveDown(state.examples, state.examples.items.length) };
      render();
      return;
    }

    if (key === KEY_ENTER || key === KEY_NEWLINE) {
      const selected = state.examples.items[state.examples.selectedIndex];
      if (selected?.data) promptForExampleProject(selected.data, () => render());
    }
  }

  function handleNewProjectKey(key: string): void {
    if (key === KEY_UP || key === "k") {
      state = {
        ...state,
        newProjectIndex: state.newProjectIndex > 0 ? state.newProjectIndex - 1 : 2,
      };
      render();
      return;
    }

    if (key === KEY_DOWN || key === "j") {
      state = {
        ...state,
        newProjectIndex: state.newProjectIndex < 2 ? state.newProjectIndex + 1 : 0,
      };
      render();
      return;
    }

    if (key >= "1" && key <= "3") {
      state = { ...state, newProjectIndex: parseInt(key, 10) - 1 };
      render();
    }

    if (key !== KEY_ENTER && key !== KEY_NEWLINE && !(key >= "1" && key <= "3")) return;

    switch (state.newProjectIndex) {
      case 0:
        update(navigateTo("templates"));
        return;
      case 1:
        update(navigateTo("examples"));
        return;
      case 2:
        promptForProjectName("minimal", () => render());
        return;
    }
  }

  function handleAuthKey(key: string): void {
    const providerList: Array<"google" | "github" | "microsoft"> = [
      "google",
      "github",
      "microsoft",
    ];

    if (key === KEY_UP || key === "k") {
      state = {
        ...state,
        authProviderIndex: state.authProviderIndex > 0 ? state.authProviderIndex - 1 : 2,
      };
      render();
      return;
    }

    if (key === KEY_DOWN || key === "j") {
      state = {
        ...state,
        authProviderIndex: state.authProviderIndex < 2 ? state.authProviderIndex + 1 : 0,
      };
      render();
      return;
    }

    if (key >= "1" && key <= "3") {
      state = { ...state, authProviderIndex: parseInt(key, 10) - 1 };
      render();
      return;
    }

    if (key !== KEY_ENTER && key !== KEY_NEWLINE) return;

    const provider = providerList[state.authProviderIndex];
    update(addLog("info", `Opening browser for ${provider} login...`));
    update(navigateTo("dashboard"));

    void (async () => {
      const user = await login(provider);
      if (user) {
        const result = await fetchRemoteProjects();
        update(updateRemote({
          user,
          projects: result.projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
        }));
        update(addLog("info", `Logged in as ${user.email}`));
      }
      render();
    })();
  }

  async function handleKey(key: string): Promise<void> {
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

    if (key === KEY_CTRL_C || (key === "q" && state.view === "dashboard")) {
      stop();
      exit(0);
    }

    if (key === KEY_ESCAPE) {
      if (state.view !== "dashboard") update(goBack());
      return;
    }

    switch (state.view) {
      case "templates":
        handleTemplatesKey(key);
        return;
      case "examples":
        handleExamplesKey(key);
        return;
      case "new-project":
        handleNewProjectKey(key);
        return;
      case "auth":
        handleAuthKey(key);
        return;
      case "help":
        update(goBack());
        return;
    }

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

    if (key === KEY_UP || key === "k") {
      if (state.activeList === "remoteProjects") {
        moveRemoteFocusUp();
      } else {
        update(updateActiveList((list) => moveUp(list)));
      }
      return;
    }

    if (key === KEY_DOWN || key === "j") {
      if (state.activeList === "remoteProjects") {
        moveRemoteFocusDown();
      } else {
        update(updateActiveList((list) => moveDown(list, 5)));
      }
      return;
    }

    if (key === "\t") {
      const hasProjects = state.projects.items.length > 0;
      const hasExamples = state.examples.items.length > 0;
      const hasRemoteProjects = !!state.remote.user && state.remote.projects.length > 0;

      const sections: Array<"projects" | "remoteProjects" | "examples"> = [];
      if (hasProjects) sections.push("projects");
      if (hasRemoteProjects) sections.push("remoteProjects");
      if (hasExamples) sections.push("examples");

      if (sections.length > 1) {
        const currentIndex = sections.indexOf(state.activeList as typeof sections[number]);
        const nextIndex = (currentIndex + 1) % sections.length;
        const nextSection = sections[nextIndex];
        if (nextSection) update(setActiveList(nextSection));
      }
      return;
    }

    if (key >= "1" && key <= "9" && state.activeList === "remoteProjects") {
      const num = parseInt(key, 10);
      if (num <= state.remote.projects.length) updateRemoteFocus(num - 1);
      return;
    }

    if (
      key >= "a" && key <= "z" && key !== "j" && key !== "k" && key !== "p" && key !== "u" &&
      key !== "o" && key !== "s" && key !== "i" &&
      state.activeList === "remoteProjects"
    ) {
      const num = key.charCodeAt(0) - 96 + 9;
      if (num <= state.remote.projects.length) updateRemoteFocus(num - 1);
      return;
    }

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

    if (
      key >= "a" && key <= "z" && key !== "j" && key !== "k" && key !== "p" && key !== "u" &&
      state.activeList === "examples"
    ) {
      const num = key.charCodeAt(0) - 96;
      if (num <= state.examples.items.length) {
        state = { ...state, examples: selectByNumber(state.examples, num) };
        render();
        const selected = state.examples.items[num - 1];
        if (selected?.data) await openInBrowser(selected.data, state.server.port);
        return;
      }
    }

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

      const orig = {
        log: console.log,
        error: console.error,
        warn: console.warn,
        info: console.info,
        debug: console.debug,
      };

      const parseRequestLog = (msg: string): LogMeta | undefined => {
        const match = msg.match(
          /^\s*(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\S+)\s+(\d{3})\s+(\d+)ms(?:\s+(\S+))?/,
        );
        if (!match) return undefined;

        const [, method, path, status, duration, context] = match;
        const meta: LogMeta = {
          method,
          path,
          status: parseInt(status!, 10),
          durationMs: parseInt(duration!, 10),
        };

        if (context) {
          const parts = context.split(":");
          if (parts[0]) meta.project = parts[0];
          if (parts[1]) meta.env = parts[1];
          if (parts[2]) meta.releaseId = parts[2];
        }

        return meta;
      };

      // deno-lint-ignore no-control-regex
      const ansiPattern = /\x1b\[[0-9;]*m/g;
      const logBuffer = getLogBuffer();

      const capture =
        (level: "info" | "warn" | "error" | "debug") => (...args: unknown[]): void => {
          const msg = args
            .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
            .join(" ")
            .replace(ansiPattern, "");
          if (!msg.trim()) return;

          const meta = parseRequestLog(msg);
          state = addLog(level, msg, meta)(state);
          logBuffer.append({ level, message: msg, source: "console" });
          render();
        };

      console.log = capture("info");
      console.error = capture("error");
      console.warn = capture("warn");
      console.info = capture("info");
      console.debug = capture("debug");

      return () => Object.assign(console, orig);
    },
  };
}
