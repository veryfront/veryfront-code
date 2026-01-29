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
import { getRuntimeEnv } from "#veryfront/config/runtime-env.ts";
import {
  createEscapeBuffer,
  getStdinReader,
  setRawMode,
} from "#veryfront/platform/compat/stdin.ts";
import { cursor, screen, SPINNER_FRAMES } from "../ui/ansi.ts";
import { brand, dim } from "../ui/colors.ts";
import { getTerminalWidth } from "../ui/layout.ts";
import { moveDown, moveUp, selectByNumber } from "./components/list-select.ts";
import { renderBanner, renderDashboard, renderEmptyState } from "./views/dashboard.ts";
import { MAIN_TABS, renderTabBar } from "./components/tab-bar.ts";
import {
  createStartupState,
  incrementFrame,
  renderStartup,
  setStepActive,
} from "./views/startup.ts";
import { openInBrowser, openInIDE, openInStudio, openMCPSettings } from "./actions.ts";
import { initCommand } from "../commands/init/init-command.ts";
import type { InitTemplate } from "../commands/init/types.ts";
import {
  addLog,
  type AppState,
  closeAgentPicker,
  createInitialState,
  endInput,
  enterCodeView,
  getActiveSelection,
  goBack,
  type LogMeta,
  moveAgentPicker,
  navigateTo,
  openAgentPicker,
  type ProjectInfo,
  resetKeyChord,
  scrollLogs,
  selectAgent,
  setActiveSection,
  setAgents,
  setCodeRunning,
  setCommandPaletteOpen,
  setExamples,
  setKeyChord,
  setModel,
  setProjects,
  setResourceTab,
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
import { applyNavToIndex, CTRL_KEYS, handleVimKey } from "./core/keybindings.ts";
import {
  createAgentRegistry,
  detectInstalledAgents,
  getCLIAgents,
  getIDEAgents,
} from "./core/agents.ts";
import { spawnAgent, waitForExit } from "./core/pty.ts";
import type { CodingAgentDef } from "./core/types.ts";
import { listTools } from "../mcp/tools.ts";
import { handleInputKey, renderInput, renderLogs } from "./components/inline-input.ts";
import { login, logout, validateToken } from "../auth/login.ts";
import { readToken } from "../auth/token-store.ts";
import { openBrowser } from "../auth/browser.ts";
import { fetchRemoteProjects } from "../sync/index.ts";
import { pullCommand } from "../commands/pull.ts";
import { pushCommand } from "../commands/push.ts";
import { getLogBuffer } from "../mcp/log-buffer.ts";

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

async function copyDirectory(src: string, dest: string): Promise<void> {
  const fs = await import("#veryfront/platform/compat/fs.ts");
  const pathMod = await import("#veryfront/platform/compat/path/index.ts");
  const filesystem = fs.createFileSystem();

  await filesystem.mkdir(dest, { recursive: true });
  for await (const entry of filesystem.readDir(src)) {
    const srcPath = pathMod.join(src, entry.name);
    const destPath = pathMod.join(dest, entry.name);
    if (entry.isDirectory) {
      await copyDirectory(srcPath, destPath);
    } else {
      const content = await filesystem.readFile(srcPath);
      await filesystem.writeFile(destPath, content);
    }
  }
}

function generateRandomSlug(): string {
  const adjectives = [
    // colors & gems
    "amber",
    "azure",
    "coral",
    "crimson",
    "cyan",
    "golden",
    "indigo",
    "ivory",
    "jade",
    "magenta",
    "maroon",
    "olive",
    "onyx",
    "opal",
    "pearl",
    "ruby",
    "scarlet",
    "silver",
    "teal",
    "topaz",
    "turquoise",
    "violet",
    // nature
    "alpine",
    "arctic",
    "autumn",
    "coastal",
    "crystal",
    "desert",
    "floral",
    "forest",
    "frozen",
    "lunar",
    "misty",
    "mossy",
    "ocean",
    "polar",
    "rainy",
    "snowy",
    "solar",
    "spring",
    "stormy",
    "sunny",
    "tidal",
    "tropic",
    "windy",
    // qualities
    "agile",
    "bold",
    "brave",
    "bright",
    "calm",
    "clever",
    "cosmic",
    "daring",
    "eager",
    "epic",
    "fierce",
    "gentle",
    "grand",
    "keen",
    "kind",
    "lively",
    "mystic",
    "nimble",
    "noble",
    "proud",
    "quiet",
    "rapid",
    "serene",
    "silent",
    "steady",
    "swift",
    "vivid",
    "wild",
    "wise",
    "witty",
    "zen",
  ];
  const nouns = [
    // water
    "bay",
    "brook",
    "canal",
    "cascade",
    "coast",
    "creek",
    "delta",
    "falls",
    "fjord",
    "gulf",
    "harbor",
    "lagoon",
    "lake",
    "marsh",
    "ocean",
    "pond",
    "rapids",
    "reef",
    "river",
    "shore",
    "spring",
    "strait",
    "stream",
    "tide",
    "wave",
    // land
    "bluff",
    "canyon",
    "cave",
    "cliff",
    "crater",
    "desert",
    "dune",
    "field",
    "glade",
    "gorge",
    "grove",
    "hill",
    "isle",
    "mesa",
    "oasis",
    "pass",
    "peak",
    "plain",
    "plateau",
    "ridge",
    "rock",
    "slope",
    "stone",
    "summit",
    "trail",
    "valley",
    "volcano",
    // sky & space
    "aurora",
    "cloud",
    "comet",
    "cosmos",
    "dawn",
    "dusk",
    "eclipse",
    "ember",
    "flare",
    "frost",
    "galaxy",
    "glow",
    "haze",
    "horizon",
    "meteor",
    "mist",
    "moon",
    "nebula",
    "nova",
    "orbit",
    "prism",
    "pulse",
    "quasar",
    "ray",
    "shadow",
    "sky",
    "spark",
    "star",
    "storm",
    "sun",
    "thunder",
    "twilight",
    "vapor",
    "wind",
    "zenith",
  ];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}-${noun}`;
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
    url: `http://veryfront.me:${config.port}`,
  })(state);

  state = updateMCP({
    enabled: config.mcpPort !== undefined,
    transport: config.mcpPort ? "http" : null,
    httpPort: config.mcpPort,
  })(state);

  // Initialize agent registry and detect installed agents
  const agentRegistry = createAgentRegistry();
  state = setAgents(agentRegistry.agents, [])(state);

  // Detect installed agents in background
  void (async () => {
    const installed = await detectInstalledAgents(agentRegistry);
    state = setAgents(agentRegistry.agents, installed)(state);
    if (isInteractiveMode) render();
  })();

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

  function renderExamplesView(): string {
    const lines = [
      "",
      `  ${brand("Examples")}`,
      "",
      `  ${dim("Create a new project from an example:")}`,
      "",
    ];

    state.examples.items.forEach((item, i) => {
      const selected = i === state.examples.selectedIndex;
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

  function renderCodeView(st: AppState): string {
    // If agent picker is open, show it instead
    if (st.agents.pickerOpen) {
      return renderAgentPicker(st);
    }

    const lines: string[] = [];
    const agent = st.code.agent;
    const projectPath = st.code.projectPath;

    lines.push("");
    lines.push(`  ${brand("Code")} ${dim("- Coding Agent")}`);
    lines.push("");

    if (agent) {
      lines.push(`  ${dim("Agent")}  ${brand(agent.name)} ${dim(`(${agent.provider})`)}`);
      const modelDisplay = st.code.model ?? agent.defaultModel ?? "default";
      lines.push(`  ${dim("Model")}  ${brand(modelDisplay)}`);

      // Show available models if agent has multiple
      if (agent.models && agent.models.length > 1) {
        lines.push("");
        lines.push(`  ${dim("Available models")} ${dim("(press m + number)")}`);
        agent.models.forEach((m, i) => {
          const isCurrent = m === st.code.model;
          const num = dim(`[${i + 1}]`);
          const name = isCurrent ? brand(`${m} ✓`) : m;
          lines.push(`    ${num} ${name}`);
        });
      }
    } else {
      lines.push(`  ${dim("No agent selected. Press")} ${brand("Ctrl+A")} ${dim("to pick one.")}`);
    }

    lines.push("");
    lines.push(
      `  ${dim("Scope")}  ${projectPath ? brand(projectPath) : brand("root")} ${
        dim(projectPath ? "(single project)" : "(multi-project)")
      }`,
    );
    lines.push("");

    if (st.code.running) {
      lines.push(`  ${dim("Agent is running... Press")} ${brand("Ctrl+C")} ${dim("to stop.")}`);
    } else {
      const modelHint = agent?.models && agent.models.length > 1
        ? `${brand("m")} ${dim("model  •")} `
        : "";
      lines.push(
        `  ${dim("Press")} ${brand("Enter")} ${dim("start  •")} ${modelHint}${brand("Ctrl+A")} ${
          dim("agent  •")
        } ${brand("Esc")} ${dim("back")}`,
      );
    }

    lines.push("");
    return lines.join("\n");
  }

  function renderAgentPicker(st: AppState): string {
    const lines: string[] = [];
    const cliAgents = getCLIAgents({ agents: st.agents.agents, byId: new Map() });
    const ideAgents = getIDEAgents({ agents: st.agents.agents, byId: new Map() });

    lines.push("");
    lines.push(`  ${brand("Select Coding Agent")}`);
    lines.push("");

    lines.push(`  ${dim("CLI Agents")} ${dim("(embedded in TUI)")}`);
    let idx = 0;
    for (const agent of cliAgents) {
      const isFocused = idx === st.agents.pickerIndex;
      const isInstalled = st.agents.installedAgents.includes(agent.id);
      const cursor = isFocused ? brand("›") : " ";
      const num = isFocused ? brand(`[${idx + 1}]`) : dim(`[${idx + 1}]`);
      const name = isFocused ? brand(agent.name) : agent.name;
      const provider = dim(agent.provider);
      const status = isInstalled ? dim("[✓]") : dim("[✗]");
      lines.push(`  ${cursor} ${num} ${name}  ${provider}  ${status}`);
      idx++;
    }

    lines.push("");
    lines.push(`  ${dim("IDE Agents")} ${dim("(opens external)")}`);
    for (const agent of ideAgents) {
      const isFocused = idx === st.agents.pickerIndex;
      const isInstalled = st.agents.installedAgents.includes(agent.id);
      const cursor = isFocused ? brand("›") : " ";
      const num = isFocused ? brand(`[${idx + 1}]`) : dim(`[${idx + 1}]`);
      const name = isFocused ? brand(agent.name) : agent.name;
      const provider = dim(agent.provider);
      const status = isInstalled ? dim("[✓]") : dim("[✗]");
      lines.push(`  ${cursor} ${num} ${name}  ${provider}  ${status}`);
      idx++;
    }

    lines.push("");
    lines.push(`  ${dim("1-9 quick select  ↑↓ nav  Enter choose  Esc cancel")}`);
    lines.push("");

    return lines.join("\n");
  }

  function renderResourcesView(st: AppState): string {
    const lines: string[] = [];
    const tabs: Array<{ id: string; label: string }> = [
      { id: "files", label: "Files" },
      { id: "routes", label: "Routes" },
      { id: "agents", label: "Agents" },
      { id: "tools", label: "Tools" },
      { id: "mcp", label: "MCP" },
    ];

    lines.push("");
    lines.push(`  ${brand("Resources")}`);
    lines.push("");

    // Tab bar
    const tabLine = tabs.map((t) => {
      const active = st.resourceTab === t.id;
      return active ? brand(`[${t.label}]`) : dim(`[${t.label}]`);
    }).join(" ");
    lines.push(`  ${tabLine}`);
    lines.push("");

    // Content based on active tab
    switch (st.resourceTab) {
      case "files":
        lines.push(`  ${dim("Project Files")}`);
        lines.push("");
        if (st.projects.items.length > 0) {
          st.projects.items.slice(0, 8).forEach((p, i) => {
            lines.push(`    ${dim(`[${i + 1}]`)} ${p.label}  ${dim(p.meta || "")}`);
          });
        } else {
          lines.push(`    ${dim("No projects discovered")}`);
        }
        break;

      case "routes":
        lines.push(`  ${dim("API Routes & Pages")}`);
        lines.push("");
        lines.push(
          `    ${dim("Run")} ${brand("vf_list_routes")} ${dim("via MCP to see all routes")}`,
        );
        lines.push(`    ${dim("or use CLI:")} ${brand("veryfront routes")}`);
        break;

      case "agents": {
        lines.push(`  ${dim("Coding Agents")}`);
        lines.push("");
        const cliAgents = st.agents.agents.filter((a) => a.type === "cli");
        cliAgents.forEach((agent, i) => {
          const installed = st.agents.installedAgents.includes(agent.id);
          const status = installed ? dim("[✓]") : dim("[✗]");
          const active = st.code.agent?.id === agent.id ? brand(" (active)") : "";
          lines.push(
            `    ${dim(`[${i + 1}]`)} ${agent.name}  ${dim(agent.provider)}  ${status}${active}`,
          );
        });
        break;
      }

      case "tools": {
        lines.push(`  ${dim("MCP Tools")}`);
        lines.push("");
        const tools = listTools();
        tools.slice(0, 10).forEach((tool) => {
          lines.push(`    ${brand(tool.name)}`);
          lines.push(`      ${dim(tool.description.slice(0, 60))}...`);
        });
        if (tools.length > 10) {
          lines.push(`    ${dim(`... and ${tools.length - 10} more`)}`);
        }
        break;
      }

      case "mcp":
        lines.push(`  ${dim("MCP Server")}`);
        lines.push("");
        if (st.mcp.enabled) {
          lines.push(`    ${dim("Status")}  ${brand("Running")}`);
          lines.push(`    ${dim("Transport")}  ${brand(st.mcp.transport || "stdio")}`);
          if (st.mcp.httpPort) {
            lines.push(`    ${dim("URL")}  ${brand(`http://veryfront.me:${st.mcp.httpPort}/mcp`)}`);
          }
          lines.push("");
          lines.push(`    ${dim("Add to")} ${brand("~/.claude/settings.json")}${dim(":")}`);
          lines.push(`    ${dim('"veryfront": { "type": "url", "url": "...')}`);
        } else {
          lines.push(`    ${dim("MCP server not enabled")}`);
          lines.push(`    ${dim("Start with:")} ${brand("veryfront --mcp")}`);
        }
        break;
    }

    lines.push("");
    lines.push(`  ${dim("Tab switch  •  Esc back")}`);
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
      lines.push(`    ${dim(`    "url": "http://veryfront.me:${state.mcp.httpPort}/mcp"`)}`);
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
    const options = [
      { label: "From template", desc: "Start with a pre-built template" },
      { label: "From example", desc: "Copy an example project" },
      { label: "From scratch", desc: "Empty project" },
    ];

    const lines = [
      "",
      `  ${brand("New Project")}`,
      "",
      `  ${dim("Choose how to start:")}`,
      "",
    ];

    options.forEach((opt, i) => {
      const isFocused = i === state.newProjectIndex;
      const cursor = isFocused ? brand("›") : " ";
      const num = isFocused ? brand(`[${i + 1}]`) : dim(`[${i + 1}]`);
      const label = isFocused ? opt.label : dim(opt.label);
      const desc = dim(opt.desc);
      lines.push(`  ${cursor} ${num} ${label}  ${desc}`);
    });

    lines.push(
      "",
      `  ${dim("↑↓ nav  enter select  esc back")}`,
      "",
    );

    return lines.join("\n");
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
    // Always render header (banner + tabs)
    const header = renderBanner(state);
    const tabs = renderTabBar({
      tabs: MAIN_TABS,
      activeTabId: state.view,
    });

    let content: string;

    switch (state.view) {
      case "dashboard":
        content = state.projects.items.length > 0 || state.templates.items.length > 0 ||
            state.examples.items.length > 0
          ? renderDashboard(state)
          : renderEmptyState();
        break;
      case "code":
        content = renderCodeView(state);
        break;
      case "resources":
        content = renderResourcesView(state);
        break;
      case "new-project":
        content = renderNewProjectView();
        break;
      case "templates":
        content = renderTemplatesView();
        break;
      case "examples":
        content = renderExamplesView();
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

    // Combine header + tabs + content
    const parts: string[] = [header, tabs, "", content];

    // Divider width matches the box in dashboard
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

    // Buffer escape sequences (arrow keys like \x1b[A may arrive as separate reads)
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

    // Handle Escape key (but not escape sequences like arrow keys)
    // Escape alone is \x1b, arrow keys are \x1b[A, \x1b[B, etc.
    if (key === "\x1b") {
      // Close command palette if open
      if (state.commandPalette.open) {
        update(setCommandPaletteOpen(false));
        return;
      }
      if (state.view !== "dashboard") update(goBack());
      update(resetKeyChord());
      return;
    }

    // Global tab navigation
    // These shortcuts work from any view for quick navigation
    if (key === "\x1b1") {
      // Alt+1: Dashboard
      update(navigateTo("dashboard"));
      return;
    }
    if (key === "\x1b2") {
      // Alt+2: New Project
      state = { ...state, newProjectIndex: 0 };
      update(navigateTo("new-project"));
      return;
    }
    if (key === "\x1b3") {
      // Alt+3: Code
      update(navigateTo("code"));
      return;
    }
    if (key === "\x1b4") {
      // Alt+4: Resources
      update(navigateTo("resources"));
      return;
    }
    // Shift+Tab: cycle backwards through main tabs
    if (key === "\x1b[Z") {
      const tabs = ["dashboard", "new-project", "code", "resources"] as const;
      const currentIndex = tabs.indexOf(state.view as typeof tabs[number]);
      const prevIndex = currentIndex <= 0 ? tabs.length - 1 : currentIndex - 1;
      const prevTab = tabs[prevIndex];
      if (prevTab) update(navigateTo(prevTab));
      return;
    }

    // Command palette: : key opens it
    if (key === ":" && state.mode === "NORMAL" && state.view === "dashboard") {
      update(setCommandPaletteOpen(true));
      return;
    }

    // Ctrl+P for fuzzy search (placeholder)
    if (key === CTRL_KEYS.P) {
      update(addLog("info", "Search coming soon (Ctrl+P)"));
      return;
    }

    // Handle vim keybindings (gg, G, Ctrl+D, Ctrl+U, number prefixes)
    if (state.view === "dashboard" && state.mode === "NORMAL") {
      const vimResult = handleVimKey(key, state.keyChord);

      // Update chord state
      if (vimResult.chord !== state.keyChord) {
        state = setKeyChord(vimResult.chord)(state);
      }

      // Handle go-to shortcuts (gd, gs, gr, gh)
      if (vimResult.stringAction) {
        const action = vimResult.stringAction;
        if (action === "go:d") {
          update(navigateTo("dashboard"));
          return;
        }
        if (action === "go:s") {
          update(navigateTo("help")); // Settings not implemented, show help
          return;
        }
        if (action === "go:h") {
          update(navigateTo("help"));
          return;
        }
        return;
      }

      // Handle navigation actions (gg, G, Ctrl+D, Ctrl+U)
      if (vimResult.navAction) {
        const { direction: _direction, count: _count } = vimResult.navAction;
        if (state.activeSection === "remote") {
          const total = state.remote.projects.length;
          const newIndex = applyNavToIndex(
            vimResult.navAction,
            state.remote.focusedIndex,
            total,
            5,
          );
          const visibleCount = 5;
          let scrollOffset = state.remote.scrollOffset;
          if (newIndex < scrollOffset) scrollOffset = newIndex;
          else if (newIndex >= scrollOffset + visibleCount) {
            scrollOffset = newIndex - visibleCount + 1;
          }
          update(updateRemote({ focusedIndex: newIndex, scrollOffset }));
        } else {
          const list = state[state.activeSection];
          const total = list.items.length;
          if (total > 0) {
            const newIndex = applyNavToIndex(vimResult.navAction, list.selectedIndex, total, 5);
            update(updateActiveList((l) => ({ ...l, selectedIndex: newIndex })));
          }
        }
        return;
      }

      // If chord is pending but not consumed, don't process other keys
      if (vimResult.consumed && !vimResult.navAction && !vimResult.stringAction) {
        render();
        return;
      }
    }

    if (state.view === "templates") {
      handleTemplatesKey(key);
      return;
    }

    if (state.view === "examples") {
      handleExamplesKey(key);
      return;
    }

    if (state.view === "new-project") {
      handleNewProjectKey(key);
      return;
    }

    if (state.view === "auth") {
      handleAuthKey(key);
      return;
    }

    if (state.view === "code") {
      handleCodeKey(key);
      return;
    }

    if (state.view === "resources") {
      handleResourcesKey(key);
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
      if (state.activeSection === "remote") {
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
      if (state.activeSection === "remote") {
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
      const hasTemplates = state.templates.items.length > 0;
      const hasExamples = state.examples.items.length > 0;
      const hasRemote = state.remote.user && state.remote.projects.length > 0;

      // Build list of available sections in display order
      const sections: Array<"projects" | "remote" | "templates" | "examples"> = [];
      if (hasProjects) sections.push("projects");
      if (hasRemote) sections.push("remote");
      if (hasTemplates) sections.push("templates");
      if (hasExamples) sections.push("examples");

      if (sections.length > 1) {
        const currentIndex = sections.indexOf(state.activeSection);
        const nextIndex = (currentIndex + 1) % sections.length;
        const nextSection = sections[nextIndex];
        if (nextSection) update(setActiveSection(nextSection));
      }
      return;
    }

    // Number keys for remote project - update focusedIndex (Enter triggers pull)
    if (key >= "1" && key <= "9" && state.activeSection === "remote") {
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
    // Exclude c/r (views), p/u (pull/push), j/k (vim nav), o/s/i (open actions) shortcuts
    if (
      key >= "a" && key <= "z" && key !== "j" && key !== "k" && key !== "p" && key !== "u" &&
      key !== "o" && key !== "s" && key !== "i" && key !== "c" && key !== "r" &&
      state.activeSection === "remote"
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

    // Number keys select from active list (1-9) - skip for remote (handled above)
    if (key >= "1" && key <= "9" && state.activeSection !== "remote") {
      const num = parseInt(key, 10);
      const activeList = state[state.activeSection];
      if (num <= activeList.items.length) {
        state = { ...state, [state.activeSection]: selectByNumber(activeList, num) };
        render();
        const selected = activeList.items[num - 1];
        if (selected?.data) await openInBrowser(selected.data, state.server.port);
        return;
      }
    }

    // Letter keys only work when examples focused (a=1, b=2, etc.)
    // Exclude c/r (views), p/u (pull/push), j/k (vim nav), o/s/i (open actions) shortcuts
    if (
      key >= "a" && key <= "z" && key !== "j" && key !== "k" && key !== "p" && key !== "u" &&
      key !== "o" && key !== "s" && key !== "i" && key !== "c" && key !== "r" &&
      state.activeSection === "examples"
    ) {
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
      if (state.activeSection === "remote") {
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
      if (state.activeSection === "remote") {
        const focused = state.remote.projects[state.remote.focusedIndex];
        if (focused) {
          const url = `http://${focused.slug}.veryfront.me:${state.server.port}`;
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
      if (state.activeSection === "remote") {
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
      if (state.activeSection === "remote") {
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

    // Code view - use selected project path if available
    if (key === "c") {
      let projectPath: string | null = null;
      if (state.activeSection === "projects") {
        const selected = getActiveSelection(state);
        if (selected?.data?.path) {
          projectPath = selected.data.path;
        }
      } else if (state.activeSection === "remote") {
        const focused = state.remote.projects[state.remote.focusedIndex];
        if (focused) {
          projectPath = join(cwd(), "projects", focused.slug);
        }
      }
      update(enterCodeView(projectPath));
      return;
    }

    // Resources view
    if (key === "r") {
      update(navigateTo("resources"));
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

    // Pull focused remote project
    if (key === "p" && state.activeSection === "remote") {
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
    if (key === "p" && state.activeSection === "projects") {
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
    if (key === "u" && state.activeSection === "projects") {
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
    try {
      state = addLog("info", `Creating project...`)(state);
      render();

      const token = await readToken();
      if (!token) {
        state = addLog("error", "Not authenticated. Press 'a' to login.")(state);
        return;
      }

      // Normalize slug: lowercase, alphanumeric and hyphens only
      const normalizedSlug = projectName.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
      // Use slug as name (capitalize first letter of each word)
      const name = normalizedSlug
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");

      const apiUrl = getRuntimeEnv().apiUrl || "https://api.veryfront.com";
      const response = await fetch(`${apiUrl}/projects`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ slug: normalizedSlug, name }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const msg = (error as { message?: string }).message || `HTTP ${response.status}`;
        throw new Error(msg);
      }

      const { slug } = await response.json() as { slug: string };
      const projectPath = `${cwd()}/projects/${slug}`;

      await initCommand({
        name: `projects/${slug}`,
        template,
        skipInstall: true,
        skipEnvPrompt: true,
        quiet: true,
      });

      const currentProjects = state.projects.items.map((item) => ({
        slug: item.data!.slug,
        path: item.data!.path,
      }));
      currentProjects.push({ slug, path: projectPath });

      state = setProjects(currentProjects)(state);

      // Refresh remote projects list to include the new project
      const result = await fetchRemoteProjects();
      state = updateRemote({
        projects: result.projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
      })(state);

      state = addLog("info", `Created ${slug}`)(state);
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

  function handleExamplesKey(key: string): void {
    if (key === "\x1b[A" || key === "k") {
      state = { ...state, examples: moveUp(state.examples) };
      render();
      return;
    }

    if (key === "\x1b[B" || key === "j") {
      state = { ...state, examples: moveDown(state.examples, state.examples.items.length) };
      render();
      return;
    }

    if (key === "\r" || key === "\n") {
      const selected = state.examples.items[state.examples.selectedIndex];
      if (selected?.data) {
        promptForExampleProject(selected.data, () => render());
      }
    }
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

      // Normalize slug
      const normalizedSlug = projectName.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
      const name = normalizedSlug
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");

      // Create project in API
      const apiUrl = getRuntimeEnv().apiUrl || "https://api.veryfront.com";
      const response = await fetch(`${apiUrl}/projects`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ slug: normalizedSlug, name }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const msg = (error as { message?: string }).message || `HTTP ${response.status}`;
        throw new Error(msg);
      }

      const { slug } = await response.json() as { slug: string };
      const projectPath = `${cwd()}/projects/${slug}`;

      // Copy example files to new project
      await copyDirectory(example.path, projectPath);

      // Update local projects list
      const currentProjects = state.projects.items.map((item) => ({
        slug: item.data!.slug,
        path: item.data!.path,
      }));
      currentProjects.push({ slug, path: projectPath });
      state = setProjects(currentProjects)(state);

      // Refresh remote projects
      const result = await fetchRemoteProjects();
      state = updateRemote({
        projects: result.projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
      })(state);

      state = addLog("info", `Created ${slug} from ${example.slug}`)(state);
    } catch (error) {
      state = addLog("error", `Failed: ${error}`)(state);
    }
  }

  function handleNewProjectKey(key: string): void {
    // Arrow navigation
    if (key === "\x1b[A" || key === "k") {
      state = {
        ...state,
        newProjectIndex: state.newProjectIndex > 0 ? state.newProjectIndex - 1 : 2,
      };
      render();
      return;
    }
    if (key === "\x1b[B" || key === "j") {
      state = {
        ...state,
        newProjectIndex: state.newProjectIndex < 2 ? state.newProjectIndex + 1 : 0,
      };
      render();
      return;
    }

    // Number keys to select directly
    if (key >= "1" && key <= "3") {
      state = { ...state, newProjectIndex: parseInt(key, 10) - 1 };
      render();
      // Fall through to execute the selection
    }

    // Enter to confirm selection (or after number key press)
    if (key === "\r" || key === "\n" || (key >= "1" && key <= "3")) {
      switch (state.newProjectIndex) {
        case 0:
          update(navigateTo("templates"));
          break;
        case 1:
          update(navigateTo("examples"));
          break;
        case 2:
          promptForProjectName("minimal", () => render());
          break;
      }
    }
  }

  function handleAuthKey(key: string): void {
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

  function handleCodeKey(key: string): void {
    // If agent picker is open, handle picker keys
    if (state.agents.pickerOpen) {
      handleAgentPickerKey(key);
      return;
    }

    // Esc to go back
    if (key === "\x1b") {
      update(goBack());
      return;
    }

    // Ctrl+A to open agent picker
    if (key === "\x01") {
      update(openAgentPicker());
      return;
    }

    // 'm' followed by number to select model
    if (key === "m") {
      if (!state.code.agent?.models || state.code.agent.models.length <= 1) {
        update(addLog("info", "This agent only has one model"));
        return;
      }
      update(addLog("info", "Press 1-9 to select model"));
      return;
    }

    // Number keys for model selection when agent has models
    if (key >= "1" && key <= "9" && state.code.agent?.models) {
      const idx = parseInt(key, 10) - 1;
      const models = state.code.agent.models;
      if (idx < models.length) {
        const selectedModel = models[idx];
        if (selectedModel) {
          update(setModel(selectedModel));
          update(addLog("info", `Model: ${selectedModel}`));
        }
      }
      return;
    }

    // Enter to start agent
    if (key === "\r" || key === "\n") {
      if (!state.code.agent) {
        update(addLog("info", "Select an agent first (Ctrl+A)"));
        return;
      }

      const agent = state.code.agent;
      const isInstalled = state.agents.installedAgents.includes(agent.id);

      if (!isInstalled) {
        update(addLog("error", `${agent.name} is not installed. Install it first.`));
        return;
      }

      // Launch the agent
      launchAgent(agent);
    }
  }

  function handleAgentPickerKey(key: string): void {
    // Esc to close picker
    if (key === "\x1b") {
      update(closeAgentPicker());
      return;
    }

    // Up arrow or k
    if (key === "\x1b[A" || key === "k") {
      update(moveAgentPicker(-1));
      return;
    }

    // Down arrow or j
    if (key === "\x1b[B" || key === "j") {
      update(moveAgentPicker(1));
      return;
    }

    // Number keys for quick selection (1-9)
    if (key >= "1" && key <= "9") {
      const idx = parseInt(key, 10) - 1;
      if (idx < state.agents.agents.length) {
        const selectedAgent = state.agents.agents[idx];
        if (selectedAgent) {
          update(selectAgent(selectedAgent));
          update(addLog("info", `Selected ${selectedAgent.name}`));
        }
      }
      return;
    }

    // Enter to select
    if (key === "\r" || key === "\n") {
      const selectedAgent = state.agents.agents[state.agents.pickerIndex];
      if (selectedAgent) {
        update(selectAgent(selectedAgent));
        update(addLog("info", `Selected ${selectedAgent.name}`));
      }
      return;
    }
  }

  function launchAgent(agent: CodingAgentDef): void {
    update(addLog("info", `Launching ${agent.name}...`));

    // For IDE agents, just open them
    if (agent.type === "ide") {
      const projectPath = state.code.projectPath ?? cwd();
      update(addLog("info", `Opening ${agent.name} in ${projectPath}`));
      // Build command and execute
      const parts = agent.command.split(" ");
      const cmd = parts[0]!;
      const args = parts.slice(1).map((a) => (a === "." ? projectPath : a));

      try {
        new Deno.Command(cmd, {
          args,
          cwd: projectPath,
          stdin: "null",
          stdout: "null",
          stderr: "null",
        }).spawn();
        update(addLog("info", `Opened ${agent.name}`));
      } catch (err) {
        update(addLog("error", `Failed to open ${agent.name}: ${err}`));
      }
      return;
    }

    // For CLI agents, spawn with PTY passthrough
    const projectPath = state.code.projectPath ?? cwd();
    update(setCodeRunning(true));

    // Exit TUI mode, spawn agent, then return to TUI
    stop();

    const result = spawnAgent(agent, { cwd: projectPath });
    if (!result.success) {
      update(addLog("error", `Failed to start ${agent.name}: ${result.error}`));
      update(setCodeRunning(false));
      start();
      return;
    }

    // Wait for the agent to exit
    void (async () => {
      if (result.process) {
        await waitForExit(result.process, result.session);
      }
      update(setCodeRunning(false));
      update(addLog("info", `${agent.name} exited`));
      start();
    })();
  }

  function handleResourcesKey(key: string): void {
    // Esc to go back
    if (key === "\x1b") {
      update(goBack());
      return;
    }

    // Tab to switch between resource tabs
    if (key === "\t") {
      const tabs: Array<"files" | "routes" | "agents" | "tools" | "mcp"> = [
        "files",
        "routes",
        "agents",
        "tools",
        "mcp",
      ];
      const currentIndex = tabs.indexOf(state.resourceTab);
      const nextIndex = (currentIndex + 1) % tabs.length;
      const nextTab = tabs[nextIndex] ?? "files";
      update(setResourceTab(nextTab));
      return;
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

      // Feed LogBuffer so the Dashboard API (/_dev/api/live-logs) can serve entries
      // to the standalone MCP process
      const logBuffer = getLogBuffer();

      const capture =
        (level: "info" | "warn" | "error" | "debug") => (...args: unknown[]): void => {
          const msg = args
            .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
            .join(" ")
            .replace(ansiPattern, "");
          if (msg.trim()) {
            const meta = parseRequestLog(msg);
            state = addLog(level, msg, meta)(state);
            logBuffer.append({ level, message: msg, source: "console" });
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
 * Show startup animation with boxed view and shimmer effect
 */
export async function showStartup(steps: string[]): Promise<void> {
  const write = (text: string): void => writeStdout(text);

  write(screen.altOn + cursor.hide);

  let startupState = createStartupState(steps);

  // Show each step with spinning avatar animation
  for (let i = 0; i < steps.length; i++) {
    startupState = setStepActive(startupState, i);

    // Animate spinning avatar (16 frames at 60ms = ~1s per step for full rotation)
    const framesPerStep = 16;
    for (let f = 0; f < framesPerStep; f++) {
      write(cursor.moveTo(1, 1) + screen.clearDown + "\n" + renderStartup(startupState));
      startupState = incrementFrame(startupState);
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  // Mark all steps done - logo fills up and holds before transitioning
  startupState = setStepActive(startupState, steps.length);
  write(cursor.moveTo(1, 1) + screen.clearDown + "\n" + renderStartup(startupState));
  await new Promise((r) => setTimeout(r, 400));

  // Don't exit alternate screen - let app.start() continue in it
  // Dashboard takes over directly from here
}

export type { AppState } from "./state.ts";
export * from "./state.ts";
export * from "./actions.ts";
export * from "./components/list-select.ts";
