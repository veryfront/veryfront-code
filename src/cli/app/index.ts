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
  navigateTo,
  setActiveList,
  setExamples,
  setProjects,
  setTemplates,
  startInput,
  type StateUpdater,
  updateActiveList,
  updateInputValue,
  updateMCP,
  updateServer,
} from "./state.ts";
import { handleInputKey, renderInput, renderLogs } from "./components/inline-input.ts";

// ============================================================================
// Types
// ============================================================================

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
}

// ============================================================================
// App Implementation
// ============================================================================

/**
 * Create the CLI app
 */
export function createApp(config: AppConfig): App {
  let state = createInitialState();
  let running = false;
  let spinnerFrame = 0;
  let spinnerInterval: number | null = null;

  // Check if running in interactive TTY mode (must be defined early for closures)
  // Force non-interactive if headless flag is set (for coding agents)
  const isInteractiveMode = !config.headless && isInteractive() && isStdoutTTY();

  // Initialize state with config
  state = setProjects(
    Array.from(config.projects.entries()).map(([slug, path]) => ({
      slug,
      path,
    })),
  )(state);

  // Initialize examples
  if (config.examples) {
    state = setExamples(
      Array.from(config.examples.entries()).map(([slug, path]) => ({
        slug,
        path,
      })),
    )(state);
  }

  // Initialize templates
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

  // Write to stdout
  const write = (text: string) => writeStdout(text);

  // Render templates view
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

  // Render help view
  function renderHelpView(): string {
    const lines = [
      "",
      `  ${brand("Keyboard Shortcuts")}`,
      "",
      `  ${dim("Navigation")}`,
      `    ${brand("↑↓")} ${dim("or")} ${brand("jk")}    Navigate list`,
      `    ${brand("1-9")}         Quick select project`,
      `    ${brand("Enter")}       Select / Open in browser`,
      `    ${brand("Esc")}         Go back`,
      "",
      `  ${dim("Actions")}`,
      `    ${brand("o")}           Open in browser`,
      `    ${brand("s")}           Open in Studio`,
      `    ${brand("i")}           Open in IDE`,
      "",
      `  ${dim("Views")}`,
      `    ${brand("n")}           New project`,
      `    ${brand("?")}           Help (this screen)`,
      "",
      `  ${dim("Other")}`,
      `    ${brand("q")}           Quit`,
      "",
    ];

    // Add MCP info if enabled
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

  // Render new project view
  function renderNewProjectView(): string {
    const lines = [
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
    ];

    return lines.join("\n");
  }

  // Render the current view
  function render() {
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
      case "help":
        content = renderHelpView();
        break;
      default:
        content = renderDashboard(state);
    }

    // Build the full screen layout
    const parts: string[] = [content];

    // Add logs area if there are logs
    if (state.logs.length > 0) {
      const logsHeight = Math.min(5, state.logs.length);
      parts.push("");
      parts.push(`  ${dim("─".repeat(60))}`);
      parts.push(renderLogs(state.logs, logsHeight));
    }

    // Add input prompt if active (at the very bottom)
    if (state.input.active) {
      parts.push("");
      parts.push(`  ${dim("─".repeat(60))}`);
      parts.push(renderInput(state.input));
    }

    // Clear and render (only in interactive mode)
    if (isInteractiveMode) {
      write(cursor.moveTo(1, 1) + screen.clearDown);
      write(parts.join("\n"));
      // Cursor is rendered visually as inverse video in the input component,
      // so we keep the terminal cursor hidden
    }
  }

  // Update state and re-render
  function update(updater: StateUpdater) {
    state = updater(state);
    if (isInteractiveMode) {
      render();
    }
  }

  // Start spinner for loading state
  function startSpinner() {
    if (spinnerInterval) return;
    spinnerInterval = setInterval(() => {
      spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
      render();
    }, 80) as unknown as number;
  }

  // Stop spinner
  function stopSpinner() {
    if (spinnerInterval) {
      clearInterval(spinnerInterval);
      spinnerInterval = null;
    }
  }

  // Handle keyboard input
  async function handleInput() {
    // Skip interactive input if not a TTY (e.g., running in background or CI)
    if (!isInteractive()) {
      return;
    }

    setRawMode(true);
    const reader = getStdinReader();
    const decoder = new TextDecoder();

    try {
      while (running) {
        const { value, done } = await reader.read();
        if (done) break;

        const key = decoder.decode(value);
        await handleKey(key);
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

  // Handle a single key press
  async function handleKey(key: string) {
    // Handle input mode first - it captures all keys
    if (state.input.active) {
      const result = handleInputKey(key, state.input.value, state.input.cursorPos);

      if ("action" in result) {
        if (result.action === "submit" && state.input.onSubmit) {
          const value = state.input.value;
          const onSubmit = state.input.onSubmit;
          state = endInput()(state);
          render();
          // Call onSubmit after ending input mode
          await onSubmit(value);
        } else if (result.action === "cancel") {
          const onCancel = state.input.onCancel;
          state = endInput()(state);
          render();
          if (onCancel) onCancel();
        }
      } else {
        state = updateInputValue(result.value, result.cursorPos)(state);
        render();
      }
      return;
    }

    // Ctrl+C or q to quit (q only on dashboard and not in input mode)
    if (key === "\x03" || (key === "q" && state.view === "dashboard")) {
      stop();
      exit(0);
    }

    // Escape - Go back from any view
    if (key === "\x1b") {
      if (state.view !== "dashboard") {
        update(goBack());
      }
      return;
    }

    // View-specific key handling
    if (state.view === "templates") {
      await handleTemplatesKey(key);
      return;
    }

    if (state.view === "new-project") {
      await handleNewProjectKey(key);
      return;
    }

    if (state.view === "help") {
      // Any key goes back from help
      update(goBack());
      return;
    }

    // Dashboard navigation
    if (key === "\x1b[A" || key === "k") {
      // Up arrow or k
      update(updateActiveList((list) => moveUp(list)));
      return;
    }

    if (key === "\x1b[B" || key === "j") {
      // Down arrow or j
      update(updateActiveList((list) => moveDown(list, 5)));
      return;
    }

    // Tab to switch between projects and examples sections
    if (key === "\t") {
      const hasProjects = state.projects.items.length > 0;
      const hasExamples = state.examples.items.length > 0;
      if (hasProjects && hasExamples) {
        const newList = state.activeList === "projects" ? "examples" : "projects";
        update(setActiveList(newList));
      }
      return;
    }

    // Number keys (1-9) and letter keys (a-z for 10+) for quick select
    const projectCount = state.projects.items.length;
    const totalCount = projectCount + state.examples.items.length;
    let itemNum = 0;

    if (key >= "1" && key <= "9") {
      itemNum = parseInt(key, 10);
    } else if (key >= "a" && key <= "z") {
      // a=10, b=11, etc. - but skip letters used for actions
      const letterNum = key.charCodeAt(0) - 96 + 9; // a=10, b=11, ...
      // Only use as item shortcut if it's a valid index
      if (letterNum <= totalCount) {
        itemNum = letterNum;
      }
    }

    if (itemNum > 0 && itemNum <= totalCount) {
      if (itemNum <= projectCount) {
        // Select from projects
        state = setActiveList("projects")(state);
        state = {
          ...state,
          projects: selectByNumber(state.projects, itemNum),
        };
        render();
        const selected = state.projects.items[itemNum - 1];
        if (selected?.data) {
          await openInBrowser(selected.data, state.server.port);
        }
      } else {
        // Select from examples
        state = setActiveList("examples")(state);
        const exampleNum = itemNum - projectCount;
        state = {
          ...state,
          examples: selectByNumber(state.examples, exampleNum),
        };
        render();
        const selected = state.examples.items[exampleNum - 1];
        if (selected?.data) {
          await openInBrowser(selected.data, state.server.port);
        }
      }
      return;
    }

    // Enter to select
    if (key === "\r" || key === "\n") {
      const selected = getActiveSelection(state);
      if (selected?.data) {
        await openInBrowser(selected.data, state.server.port);
      }
      return;
    }

    // o - Open in browser
    if (key === "o") {
      const selected = getActiveSelection(state);
      if (selected?.data) {
        await openInBrowser(selected.data, state.server.port);
      }
      return;
    }

    // s - Open in Studio
    if (key === "s") {
      const selected = getActiveSelection(state);
      if (selected?.data) {
        await openInStudio(selected.data);
      }
      return;
    }

    // i - Open in IDE
    if (key === "i") {
      const selected = getActiveSelection(state);
      if (selected?.data) {
        await openInIDE(selected.data);
      }
      return;
    }

    // n - New project
    if (key === "n") {
      update(navigateTo("new-project"));
      return;
    }

    // ? - Help
    if (key === "?") {
      update(navigateTo("help"));
      return;
    }

    // m - Open MCP settings
    if (key === "m" && state.mcp.enabled) {
      const result = await openMCPSettings();
      if (result.success) {
        update(addLog("info", result.message || "Opened MCP settings"));
      } else {
        update(addLog("error", result.message || "Failed to open MCP settings"));
      }
      return;
    }
  }

  /**
   * Create a new project from a template
   */
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
      state = setProjects(currentProjects.map((p) => ({ slug: p.slug, path: p.path })))(state);
      state = addLog("info", `Project "${projectName}" created`)(state);
    } catch (error) {
      state = addLog("error", `Failed to create project: ${error}`)(state);
    }
  }

  /**
   * Start project name input prompt
   */
  function promptForProjectName(template: InitTemplate, onCancel: () => void): void {
    state = startInput(
      "Project name",
      async (name: string) => {
        if (name.trim()) {
          await createProject(name.trim(), template);
        }
        state = navigateTo("dashboard")(state);
        render();
      },
      onCancel,
    )(state);
    render();
  }

  // Handle templates view keys
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
      if (selected) {
        promptForProjectName(selected.id as InitTemplate, () => render());
      }
    }
  }

  // Handle new-project view keys
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

  // Start the app
  function start() {
    running = true;

    if (isInteractiveMode) {
      // Enter alternate screen and hide cursor
      write(screen.altOn + cursor.hide);

      // Initial render
      render();

      // Start keyboard input handler
      handleInput();

      // Start spinner if not ready
      if (!state.server.running) {
        startSpinner();
      }
    } else {
      // Non-interactive mode: just log that server is running
      console.log(`Server running on http://lvh.me:${config.port}`);
      if (config.mcpPort) {
        console.log(`MCP available at http://localhost:${config.mcpPort}/mcp`);
      }
    }
  }

  // Stop the app
  function stop() {
    running = false;
    stopSpinner();

    if (isInteractiveMode) {
      // Restore terminal
      write(cursor.show + screen.altOff);
    }
  }

  return {
    start,
    stop,
    update,
    getState: () => state,
    render,
    setServerReady: () => {
      stopSpinner();
      update(updateServer({ running: true }));
    },
    addError: () => {
      update(updateServer({ errors: state.server.errors + 1 }));
    },
    clearErrors: () => {
      update(updateServer({ errors: 0, warnings: 0 }));
    },
    log: (level: "info" | "warn" | "error" | "debug", message: string) => {
      update(addLog(level, message));
    },
  };
}

// ============================================================================
// Startup Animation
// ============================================================================

/**
 * Show startup animation
 */
export async function showStartup(steps: string[]): Promise<void> {
  const write = (text: string) => writeStdout(text);

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

  // Final state - all complete
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

// ============================================================================
// Re-exports
// ============================================================================

export type { AppState } from "./state.ts";
export * from "./state.ts";
export * from "./actions.ts";
export * from "./components/list-select.ts";
