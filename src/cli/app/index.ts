/**
 * CLI App Shell
 *
 * Interactive app-like CLI experience with dashboard, project navigation,
 * and MCP integration for coding agents.
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
import { getStdinReader, setRawMode } from "#veryfront/platform/compat/stdin.ts";
import { cursor, screen, SPINNER_FRAMES } from "../ui/ansi.ts";
import { brand, dim, success } from "../ui/colors.ts";
import { moveDown, moveUp, selectByNumber } from "./components/list-select.ts";
import { renderDashboard, renderEmptyState } from "./views/dashboard.ts";
import { openInBrowser, openInIDE, openInStudio, openMCPSettings } from "./actions.ts";
import { initCommand } from "../commands/init/init-command.ts";
import type { InitTemplate } from "../commands/init/types.ts";
import {
  addLog,
  type AppState,
  createInitialState,
  endInput,
  getActiveSelection,
  goBack,
  type LogMeta,
  navigateTo,
  scrollLogs,
  setActiveList,
  setExamples,
  setProjects,
  setTemplates,
  startInput,
  type StateUpdater,
  toggleLogsExpanded,
  updateActiveList,
  updateInputValue,
  updateMCP,
  updateRemote,
  updateServer,
} from "./state.ts";
import { handleInputKey, renderInput, renderLogs } from "./components/inline-input.ts";
import { login, logout, validateToken } from "../auth/login.ts";
import { readToken } from "../auth/token-store.ts";
import { openBrowser } from "../auth/browser.ts";
import { fetchRemoteProjects } from "../sync/index.ts";
import { pullCommand } from "../commands/pull.ts";
import { pushCommand } from "../commands/push.ts";

export interface AppConfig {
  port: number;
  projects: Map<string, string>;
  examples?: Map<string, string>;
  defaultProject?: string;
  mcpPort?: number;
  /** Force headless mode (no TUI) for coding agents */
  headless?: boolean;
}

export interface App {
  /** Start the app */
  start(): void;
  /** Stop the app and restore terminal */
  stop(): void;
  /** Update state */
  update(updater: StateUpdater): void;
  /** Get current state */
  getState(): AppState;
  /** Render the current view */
  render(): void;
  /** Set server ready */
  setServerReady(): void;
  /** Add an error */
  addError(): void;
  /** Clear errors */
  clearErrors(): void;
  /** Add a log entry to the logs area */
  log(level: "info" | "warn" | "error" | "debug", message: string): void;
  /** Intercept console output and route to TUI logs */
  interceptConsole(): () => void;
}

/**
 * Create the CLI app
 */
export function createApp(config: AppConfig): App {
  let state = createInitialState();
  let running = false;
  let spinnerFrame = 0;
  let spinnerInterval: number | null = null;

  // Force non-interactive if headless flag is set (for coding agents)
  const isInteractiveMode = !config.headless && isInteractive() && isStdoutTTY();

  state = setProjects(
    Array.from(config.projects.entries()).map(([slug, path]) => ({ slug, path })),
  )(state);

  if (config.examples) {
    state = setExamples(
      Array.from(config.examples.entries()).map(([slug, path]) => ({ slug, path })),
    )(state);
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
    url: `http://lvh.me:${config.port}`,
  })(state);

  state = updateMCP({
    enabled: config.mcpPort !== undefined,
    transport: config.mcpPort ? "http" : null,
    httpPort: config.mcpPort,
  })(state);

  // Check for existing auth (async, updates state when ready)
  void (async () => {
    try {
      const token = await readToken();
      if (token) {
        const user = await validateToken(token);
        if (user) {
          const result = await fetchRemoteProjects();
          state = updateRemote({
            user,
            projects: result.projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
          })(state);
        }
      }
    } catch {
      // Auth check failed - non-fatal
    }
  })();

  const write = (text: string): void => writeStdout(text);

  function renderTemplatesView(): string {
    const lines = [
      "",
      `  ${brand("Templates")}`,
      "",
      `  ${dim("Create a new project from a template:")}`,
      "",
    ];

    state.templates.items.forEach((item, i) => {
      const selected = i === state.templates.selectedIndex;
      const prefix = selected ? brand("›") : " ";
      const label = selected ? brand(item.label) : item.label;
      lines.push(`  ${prefix} ${label}  ${dim(item.description || "")}`);
    });

    lines.push("");
    lines.push(
      `  ${dim("Press")} ${brand("Enter")} ${dim("to create  •")} ${brand("Esc")} ${
        dim("to go back")
      }`,
    );
    lines.push("");

    return lines.join("\n");
  }

  function renderHelpView(): string {
    const lines = [
      "",
      `  ${brand("Keyboard Shortcuts")}`,
      "",
      `  ${dim("Navigation")}`,
      `    ${brand("↑↓")} ${dim("or")} ${brand("jk")}    Navigate list`,
      `    ${brand("Tab")}         Switch sections`,
      `    ${brand("1-9")}         Quick select item`,
      `    ${brand("Enter")}       Select / Open in browser`,
      `    ${brand("Esc")}         Go back`,
      "",
      `  ${dim("Actions")}`,
      `    ${brand("o")}           Open in browser`,
      `    ${brand("s")}           Open in Studio`,
      `    ${brand("i")}           Open in IDE`,
      `    ${brand("p")}           Pull from remote`,
      `    ${brand("u")}           Push to remote`,
      "",
      `  ${dim("Auth")}`,
      `    ${brand("a")}           Login`,
      `    ${brand("x")}           Logout`,
      "",
      `  ${dim("Views")}`,
      `    ${brand("n")}           New project`,
      `    ${brand("l")}           Toggle logs`,
      `    ${brand("?")}           Help (this screen)`,
      "",
      `  ${dim("Other")}`,
      `    ${brand("q")}           Quit`,
      "",
    ];

    if (state.mcp.enabled) {
      lines.push(`  ${brand("MCP Server")}`);
      lines.push("");
      lines.push(`    ${dim("Add to your")} ${brand("~/.claude/settings.json")}${dim(":")}`);
      lines.push("");
      lines.push(`    ${dim('"mcpServers": {')}`);
      lines.push(`    ${dim('  "veryfront": {')}`);
      lines.push(`    ${dim('    "type": "url",')}`);
      lines.push(`    ${dim(`    "url": "http://localhost:${state.mcp.httpPort}/mcp"`)}`);
      lines.push(`    ${dim("  }")}`);
      lines.push(`    ${dim("}")}`);
      lines.push("");
      lines.push(`    ${brand("m")}  ${dim("Open settings.json in IDE")}`);
      lines.push("");
      lines.push(`    ${dim("Tools:")} vf_list_routes, vf_scaffold, vf_get_errors, vf_get_logs`);
      lines.push("");
    }

    lines.push(`  ${dim("Press")} ${brand("Esc")} ${dim("to go back")}`);
    lines.push("");

    return lines.join("\n");
  }

  function renderNewProjectView(): string {
    return [
      "",
      `  ${brand("New Project")}`,
      "",
      `  ${dim("Choose how to start:")}`,
      "",
      `    ${brand("[1]")} From template     ${dim("Start with a pre-built template")}`,
      `    ${brand("[2]")} From example      ${dim("Copy an example project")}`,
      `    ${brand("[3]")} From scratch      ${dim("Empty project")}`,
      "",
      `  ${dim("Or use the CLI:")}`,
      `    ${dim("deno task init my-project --template app")}`,
      "",
      `  ${dim("Press")} ${brand("Esc")} ${dim("to go back")}`,
      "",
    ].join("\n");
  }

  function renderAuthView(): string {
    const providers = ["Google", "GitHub", "Microsoft"];
    const lines = [
      "",
      `  ${brand("Login to Veryfront")}`,
      "",
      `  ${dim("Choose authentication provider:")}`,
      "",
    ];

    providers.forEach((p, i) => {
      const isFocused = i === state.authProviderIndex;
      const cursor = isFocused ? brand("›") : " ";
      const num = isFocused ? brand(`[${i + 1}]`) : dim(`[${i + 1}]`);
      const label = isFocused ? p : dim(p);
      lines.push(`${cursor} ${num} ${label}`);
    });

    lines.push("", `  ${dim("↑↓ nav  enter select  esc back")}`, "");
    return lines.join("\n");
  }

  function render(): void {
    let content: string;

    switch (state.view) {
      case "dashboard":
        content = state.projects.items.length > 0 || state.examples.items.length > 0
          ? renderDashboard(state)
          : renderEmptyState();
        break;
      case "new-project":
        content = renderNewProjectView();
        break;
      case "templates":
        content = renderTemplatesView();
        break;
      case "auth":
        content = renderAuthView();
        break;
      case "help":
        content = renderHelpView();
        break;
      default:
        content = renderDashboard(state);
    }

    const parts: string[] = [content];

    if (state.logs.length > 0) {
      const logsHeader = state.logsExpanded ? "▼ Logs" : "▶ Logs";
      parts.push("");
      parts.push(`  ${dim("─".repeat(60))}`);
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
      parts.push(`  ${dim("─".repeat(60))}`);
      parts.push(renderInput(state.input));
    }

    if (!isInteractiveMode) return;

    write(cursor.moveTo(1, 1) + screen.clearDown);
    write(parts.join("\n"));
  }

  function update(updater: StateUpdater): void {
    state = updater(state);
    if (isInteractiveMode) render();
  }

  function startSpinner(): void {
    if (spinnerInterval) return;

    spinnerInterval = setInterval(() => {
      spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
      render();
    }, 80) as unknown as number;
  }

  function stopSpinner(): void {
    if (!spinnerInterval) return;
    clearInterval(spinnerInterval);
    spinnerInterval = null;
  }

  async function handleInput(): Promise<void> {
    // Skip interactive input if not a TTY (e.g., running in background or CI)
    if (!isInteractive()) return;

    setRawMode(true);
    const reader = getStdinReader();
    const decoder = new TextDecoder();

    try {
      while (running) {
        const { value, done } = await reader.read();
        if (done) break;

        await handleKey(decoder.decode(value));
      }
    } finally {
      reader.releaseLock();
      try {
        setRawMode(false);
      } catch {
        // Ignore if stdin is already closed
      }
    }
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

    if (key === "\x03" || (key === "q" && state.view === "dashboard")) {
      stop();
      exit(0);
    }

    if (key === "\x1b") {
      if (state.view !== "dashboard") update(goBack());
      return;
    }

    if (state.view === "templates") {
      handleTemplatesKey(key);
      return;
    }

    if (state.view === "new-project") {
      handleNewProjectKey(key);
      return;
    }

    if (state.view === "auth") {
      await handleAuthKey(key);
      return;
    }

    if (state.view === "help") {
      update(goBack());
      return;
    }

    // Toggle logs expanded with 'l'
    if (key === "l" || key === "L") {
      update(toggleLogsExpanded());
      return;
    }

    // When logs are expanded, arrow keys scroll logs instead of list
    if (state.logsExpanded && state.logs.length > 0) {
      if (key === "\x1b[A" || key === "k") {
        update(scrollLogs("up"));
        return;
      }
      if (key === "\x1b[B" || key === "j") {
        update(scrollLogs("down"));
        return;
      }
    }

    if (key === "\x1b[A" || key === "k") {
      if (state.activeList === "remoteProjects") {
        const total = state.remote.projects.length;
        const visibleCount = 5;
        const newIndex = state.remote.focusedIndex > 0 ? state.remote.focusedIndex - 1 : total - 1;
        // Adjust scroll offset
        let scrollOffset = state.remote.scrollOffset;
        if (newIndex < scrollOffset) {
          scrollOffset = newIndex;
        } else if (newIndex === total - 1) {
          // Wrapped to bottom
          scrollOffset = Math.max(0, total - visibleCount);
        }
        update(updateRemote({ focusedIndex: newIndex, scrollOffset }));
      } else {
        update(updateActiveList((list) => moveUp(list)));
      }
      return;
    }

    if (key === "\x1b[B" || key === "j") {
      if (state.activeList === "remoteProjects") {
        const total = state.remote.projects.length;
        const visibleCount = 5;
        const newIndex = state.remote.focusedIndex < total - 1 ? state.remote.focusedIndex + 1 : 0;
        // Adjust scroll offset
        let scrollOffset = state.remote.scrollOffset;
        if (newIndex === 0) {
          // Wrapped to top
          scrollOffset = 0;
        } else if (newIndex >= scrollOffset + visibleCount) {
          scrollOffset = newIndex - visibleCount + 1;
        }
        update(updateRemote({ focusedIndex: newIndex, scrollOffset }));
      } else {
        update(updateActiveList((list) => moveDown(list, 5)));
      }
      return;
    }

    if (key === "\t") {
      const hasProjects = state.projects.items.length > 0;
      const hasExamples = state.examples.items.length > 0;
      const hasRemoteProjects = state.remote.user && state.remote.projects.length > 0;

      // Build list of available sections in display order
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

    // Number keys for remote project - update focusedIndex (Enter triggers pull)
    if (key >= "1" && key <= "9" && state.activeList === "remoteProjects") {
      const num = parseInt(key, 10);
      const total = state.remote.projects.length;
      if (num <= total) {
        const newIndex = num - 1;
        const visibleCount = 5;
        let scrollOffset = state.remote.scrollOffset;
        if (newIndex < scrollOffset) {
          scrollOffset = newIndex;
        } else if (newIndex >= scrollOffset + visibleCount) {
          scrollOffset = newIndex - visibleCount + 1;
        }
        update(updateRemote({ focusedIndex: newIndex, scrollOffset }));
      }
      return;
    }

    // Letter keys for remote project items 10+ (a=10, b=11, etc.)
    // Exclude p (pull), u (push), j/k (vim nav), o/s/i (open actions) shortcuts
    if (
      key >= "a" && key <= "z" && key !== "j" && key !== "k" && key !== "p" && key !== "u" &&
      key !== "o" && key !== "s" && key !== "i" &&
      state.activeList === "remoteProjects"
    ) {
      const num = key.charCodeAt(0) - 96 + 9; // a=10, b=11, etc.
      const total = state.remote.projects.length;
      if (num <= total) {
        const newIndex = num - 1;
        const visibleCount = 5;
        let scrollOffset = state.remote.scrollOffset;
        if (newIndex < scrollOffset) {
          scrollOffset = newIndex;
        } else if (newIndex >= scrollOffset + visibleCount) {
          scrollOffset = newIndex - visibleCount + 1;
        }
        update(updateRemote({ focusedIndex: newIndex, scrollOffset }));
      }
      return;
    }

    // Auth: login
    if (key === "a" && !state.remote.user) {
      update(navigateTo("auth"));
      return;
    }

    // Auth: logout
    if (key === "x" && state.remote.user) {
      await logout();
      update(updateRemote({ user: null, projects: [], focusedIndex: 0, scrollOffset: 0 }));
      update(addLog("info", "Logged out"));
      return;
    }

    // Number keys select from active list (1-9) - skip for remoteProjects (handled above)
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

    // Letter keys only work when examples focused (a=1, b=2, etc.)
    // Exclude j/k (vim nav), p/u (pull/push) shortcuts
    if (key >= "a" && key <= "z" && key !== "j" && key !== "k" && key !== "p" && key !== "u" && state.activeList === "examples") {
      const num = key.charCodeAt(0) - 96; // a=1, b=2, ...
      if (num <= state.examples.items.length) {
        state = { ...state, examples: selectByNumber(state.examples, num) };
        render();
        const selected = state.examples.items[num - 1];
        if (selected?.data) await openInBrowser(selected.data, state.server.port);
        return;
      }
    }

    if (key === "\r" || key === "\n") {
      // Enter on remote projects: pull
      if (state.activeList === "remoteProjects") {
        const focused = state.remote.projects[state.remote.focusedIndex];
        if (focused) {
          const projectDir = join(cwd(), "projects", focused.slug);
          update(addLog("info", `Pulling to projects/${focused.slug}/...`));
          render();
          try {
            await pullCommand({
              projectSlug: focused.slug,
              projectDir,
              force: true,
              quiet: true,
            });
            update(addLog("info", `Pulled to projects/${focused.slug}/`));
          } catch (err) {
            update(
              addLog("error", `Pull failed: ${err instanceof Error ? err.message : String(err)}`),
            );
          }
          render();
        }
        return;
      }
      // Enter on local projects/examples: open in browser
      const selected = getActiveSelection(state);
      if (selected?.data) await openInBrowser(selected.data, state.server.port);
      return;
    }

    if (key === "o") {
      // Open focused remote project in local dev server
      if (state.activeList === "remoteProjects") {
        const focused = state.remote.projects[state.remote.focusedIndex];
        if (focused) {
          const url = `http://${focused.slug}.lvh.me:${state.server.port}`;
          await openBrowser(url);
        }
        return;
      }
      // Otherwise open local project in browser
      const selected = getActiveSelection(state);
      if (selected?.data) await openInBrowser(selected.data, state.server.port);
      return;
    }

    if (key === "s") {
      // Open focused remote project in Studio
      if (state.activeList === "remoteProjects") {
        const focused = state.remote.projects[state.remote.focusedIndex];
        if (focused) {
          const url = `https://veryfront.com/projects/${focused.slug}`;
          await openBrowser(url);
        }
        return;
      }
      // Otherwise open local project in Studio
      const selected = getActiveSelection(state);
      if (selected?.data) await openInStudio(selected.data);
      return;
    }

    if (key === "i") {
      // Open focused remote project's local directory in IDE
      if (state.activeList === "remoteProjects") {
        const focused = state.remote.projects[state.remote.focusedIndex];
        if (focused) {
          const projectDir = join(cwd(), "projects", focused.slug);
          await openInIDE({ slug: focused.slug, path: projectDir, type: "local" });
        }
        return;
      }
      // Otherwise open local project in IDE
      const selected = getActiveSelection(state);
      if (selected?.data) await openInIDE(selected.data);
      return;
    }

    if (key === "n") {
      update(navigateTo("new-project"));
      return;
    }

    if (key === "?") {
      update(navigateTo("help"));
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

    // Pull focused remote project
    if (key === "p" && state.activeList === "remoteProjects") {
      const focused = state.remote.projects[state.remote.focusedIndex];
      if (focused) {
        const projectDir = join(cwd(), "projects", focused.slug);
        update(addLog("info", `Pulling to projects/${focused.slug}/...`));
        render();
        try {
          await pullCommand({
            projectSlug: focused.slug,
            projectDir,
            force: true,
            quiet: true,
          });
          update(addLog("info", `Pulled to projects/${focused.slug}/`));
        } catch (err) {
          update(
            addLog("error", `Pull failed: ${err instanceof Error ? err.message : String(err)}`),
          );
        }
        render();
      }
      return;
    }

    // Pull local project from remote (sync)
    if (key === "p" && state.activeList === "projects") {
      const selected = state.projects.items[state.projects.selectedIndex];
      if (selected?.data) {
        const { slug, path: projectDir } = selected.data;
        update(addLog("info", `Pulling ${slug}...`));
        render();
        try {
          await pullCommand({ projectSlug: slug, projectDir, force: true, quiet: true });
          update(addLog("info", `Pulled ${slug}`));
        } catch (err) {
          update(
            addLog("error", `Pull failed: ${err instanceof Error ? err.message : String(err)}`),
          );
        }
        render();
      }
      return;
    }

    // Push local project
    if (key === "u" && state.activeList === "projects") {
      const selected = state.projects.items[state.projects.selectedIndex];
      if (selected?.data) {
        const { slug, path: projectDir } = selected.data;
        update(addLog("info", `Pushing ${slug}...`));
        render();
        try {
          await pushCommand({ projectSlug: slug, projectDir, force: true, quiet: true });
          update(addLog("info", `Pushed ${slug} — merge in Studio`));
        } catch (err) {
          update(
            addLog("error", `Push failed: ${err instanceof Error ? err.message : String(err)}`),
          );
        }
        render();
      }
      return;
    }
  }

  async function createProject(projectName: string, template: InitTemplate): Promise<void> {
    const projectPath = `${cwd()}/projects/${projectName}`;

    try {
      state = addLog("info", `Creating project "${projectName}"...`)(state);
      render();

      await initCommand({
        name: `projects/${projectName}`,
        template,
        skipInstall: true,
        skipEnvPrompt: true,
        quiet: true,
      });

      const currentProjects = state.projects.items.map((item) => ({
        slug: item.data!.slug,
        path: item.data!.path,
      }));
      currentProjects.push({ slug: projectName, path: projectPath });

      state = setProjects(currentProjects.map(({ slug, path }) => ({ slug, path })))(state);
      state = addLog("info", `Project "${projectName}" created`)(state);
    } catch (error) {
      state = addLog("error", `Failed to create project: ${error}`)(state);
    }
  }

  function promptForProjectName(template: InitTemplate, onCancel: () => void): void {
    state = startInput(
      "Project name",
      async (name: string) => {
        if (name.trim()) await createProject(name.trim(), template);
        state = navigateTo("dashboard")(state);
        render();
      },
      onCancel,
    )(state);
    render();
  }

  function handleTemplatesKey(key: string): void {
    if (key === "\x1b[A" || key === "k") {
      state = { ...state, templates: moveUp(state.templates) };
      render();
      return;
    }

    if (key === "\x1b[B" || key === "j") {
      state = { ...state, templates: moveDown(state.templates, state.templates.items.length) };
      render();
      return;
    }

    if (key === "\r" || key === "\n") {
      const selected = state.templates.items[state.templates.selectedIndex];
      if (selected) promptForProjectName(selected.id as InitTemplate, () => render());
    }
  }

  function handleNewProjectKey(key: string): void {
    if (key === "1") {
      update(navigateTo("templates"));
      return;
    }

    if (key === "2") {
      update(setActiveList("examples"));
      update(navigateTo("dashboard"));
      return;
    }

    if (key === "3") {
      promptForProjectName("minimal", () => render());
    }
  }

  async function handleAuthKey(key: string): Promise<void> {
    const providerList: Array<"google" | "github" | "microsoft"> = [
      "google",
      "github",
      "microsoft",
    ];

    // Arrow navigation
    if (key === "\x1b[A" || key === "k") {
      state = {
        ...state,
        authProviderIndex: state.authProviderIndex > 0 ? state.authProviderIndex - 1 : 2,
      };
      render();
      return;
    }
    if (key === "\x1b[B" || key === "j") {
      state = {
        ...state,
        authProviderIndex: state.authProviderIndex < 2 ? state.authProviderIndex + 1 : 0,
      };
      render();
      return;
    }

    // Number keys to select directly
    if (key >= "1" && key <= "3") {
      state = { ...state, authProviderIndex: parseInt(key, 10) - 1 };
      render();
      return;
    }

    // Enter to confirm selection
    if (key === "\r" || key === "\n") {
      const provider = providerList[state.authProviderIndex];
      update(addLog("info", `Opening browser for ${provider} login...`));
      update(navigateTo("dashboard"));

      // Run login in background to keep TUI responsive
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
  }

  function start(): void {
    running = true;

    if (!isInteractiveMode) {
      console.log(`Server running on http://lvh.me:${config.port}`);
      if (config.mcpPort) console.log(`MCP available at http://localhost:${config.mcpPort}/mcp`);
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

      // Parse request log format: "  GET  /path 200 45ms project:env:release"
      const parseRequestLog = (msg: string): LogMeta | undefined => {
        // Match: whitespace + METHOD + path + status + duration + optional project:env:release
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
          // Parse project:env:release or project:env
          const parts = context.split(":");
          if (parts[0]) meta.project = parts[0];
          if (parts[1]) meta.env = parts[1];
          if (parts[2]) meta.releaseId = parts[2];
        }

        return meta;
      };

      // Regex to strip ANSI escape codes (ESC [ ... m)
      // deno-lint-ignore no-control-regex
      const ansiPattern = /\x1b\[[0-9;]*m/g;

      const capture =
        (level: "info" | "warn" | "error" | "debug") => (...args: unknown[]): void => {
          const msg = args
            .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
            .join(" ")
            .replace(ansiPattern, "");
          if (msg.trim()) {
            const meta = parseRequestLog(msg);
            state = addLog(level, msg, meta)(state);
            render();
          }
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

/**
 * Show startup animation
 */
export async function showStartup(steps: string[]): Promise<void> {
  const write = (text: string): void => writeStdout(text);

  write(screen.altOn + cursor.hide);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const completed = steps.slice(0, i).map((s) => `  ${success("✓")} ${dim(s)}`);
    const current = `  ${brand("●")} ${step}`;
    const pending = steps.slice(i + 1).map((s) => `  ${dim("○")} ${dim(s)}`);

    const content = [
      "",
      `  ${brand("Veryfront")} ${dim("starting...")}`,
      "",
      ...completed,
      current,
      ...pending,
      "",
    ].join("\n");

    write(cursor.moveTo(1, 1) + screen.clearDown + content);
    await new Promise((r) => setTimeout(r, 200));
  }

  const allComplete = steps.map((s) => `  ${success("✓")} ${dim(s)}`);
  const finalContent = [
    "",
    `  ${brand("Veryfront")} ${success("ready")}`,
    "",
    ...allComplete,
    "",
  ].join("\n");

  write(cursor.moveTo(1, 1) + screen.clearDown + finalContent);
  await new Promise((r) => setTimeout(r, 300));

  // Don't exit alternate screen - let app.start() continue in it
  // This prevents a flash when transitioning to the dashboard
}

export type { AppState } from "./state.ts";
export * from "./state.ts";
export * from "./actions.ts";
export * from "./components/list-select.ts";
