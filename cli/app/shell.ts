/**
 * CLI App Shell
 *
 * Terminal I/O and effect execution. What a key press *means* lives in
 * ./key-reducer.ts; this module reads keys, adopts the state the reducer
 * returns, performs the effects it asks for, and paints the result.
 *
 * Uses cross-runtime platform abstractions for terminal I/O.
 */

import { exit } from "#cli/process-lifecycle";
import { isInteractive, isStdoutTTY, writeStdout } from "veryfront/platform";
import { createEscapeBuffer, getStdinReader, setRawMode } from "veryfront/platform";
import { cursor, screen } from "../ui/ansi.ts";
import { dim } from "../ui/colors.ts";
import { getTerminalWidth } from "../ui/layout.ts";
import { formatError } from "../utils/string.ts";
import { assertApiUrlAcceptsNewCredential } from "../shared/config.ts";

import type { App, AppConfig } from "./types.ts";
import {
  addLog,
  type AppState,
  createInitialState,
  setProjects,
  setRemoteProjects,
  setRemoteUser,
  setTemplates,
  type StateUpdater,
  updateMCP,
  updateServer,
} from "./state.ts";
import { renderInput, renderLogs } from "./components/inline-input.ts";
import {
  renderAuthView,
  renderDashboard,
  renderEmptyState,
  renderHelpView,
  renderNewProjectView,
  renderTemplatesView,
} from "./views/index.ts";
import { createLauncher, createPlatformHost, type Launcher } from "./actions.ts";
import { generateRandomSlug } from "./utils.ts";
import { isApiKeyIdentity, login, logout, validateToken } from "../auth/login.ts";
import { readToken } from "../auth/token-store.ts";
import { fetchRemoteProjects } from "../sync/index.ts";
import { pullCommand } from "../commands/pull/index.ts";
import { createStagedPushOptions, pushCommand } from "../commands/push/index.ts";

import { createProject } from "./operations/project-creation.ts";
import { interceptConsole } from "./logging/console-interceptor.ts";
import { type Effect, type KeyEnv, reduceKey } from "./key-reducer.ts";
import type { InitTemplate } from "../commands/init/types.ts";

const TEMPLATES: Array<{ id: InitTemplate; name: string; description: string }> = [
  { id: "ai-agent", name: "AI Chatbot", description: "Agent + chat UI + streaming" },
  { id: "docs-agent", name: "Docs Agent", description: "Document Q&A with source citations" },
  {
    id: "multi-agent-system",
    name: "Multi-Agent",
    description: "Agents that delegate to each other",
  },
  { id: "agentic-workflow", name: "AI Workflow", description: "Steps + approvals + parallelism" },
  { id: "coding-agent", name: "Coding Agent", description: "AI code assistant with file tools" },
  { id: "saas-starter", name: "AI SaaS", description: "Auth + chat + per-user memory" },
  { id: "minimal", name: "Minimal", description: "Blank canvas" },
];

/**
 * Create the CLI app
 */
export function createApp(config: AppConfig): App {
  let state = createInitialState();
  let running = false;
  let spinnerInterval: number | null = null;

  const isInteractiveMode = !config.headless && isInteractive() && isStdoutTTY();
  const keyEnv: KeyEnv = { suggestProjectName: generateRandomSlug };
  const launcher: Launcher = config.launcher ?? createLauncher(createPlatformHost());

  state = setProjects(
    Array.from(config.projects.entries()).map(([slug, path]) => ({ slug, path })),
  )(state);

  state = setTemplates(TEMPLATES)(state);

  state = updateServer({
    port: config.port,
    url: `http://localhost:${config.port}`,
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

      // A cloned repository can select the API host through its own
      // `veryfront.json` or `.env`. Sending the operator's stored login token
      // there would hand their credential to whoever authored the clone, so
      // this background check refuses before the token leaves the machine.
      await assertApiUrlAcceptsNewCredential();

      const user = await validateToken(token);
      if (!user) return;

      const result = await fetchRemoteProjects();
      state = setRemoteProjects(result.projects)(setRemoteUser(user)(state));
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
    // Never negative: String.repeat throws, and a narrow terminal should
    // degrade to no divider rather than take the TUI down.
    const dividerWidth = Math.max(0, Math.min(getTerminalWidth() - 4, 80));

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
    }, 80);
  }

  function stopSpinner(): void {
    if (!spinnerInterval) return;
    clearInterval(spinnerInterval);
    spinnerInterval = null;
  }

  /**
   * One key press: adopt the reducer's state, then perform what it asked for.
   * There is exactly one assignment to `state` on this path.
   *
   * Nothing here is allowed to throw. `handleInput` is started without being
   * awaited, so an escaping error becomes an unhandled rejection that the
   * global handler swallows: the input loop stops, the terminal keeps the
   * alternate screen, and the TUI just looks hung. Effects reach the network
   * and the process, so failures are expected and belong in the log.
   */
  async function handleKey(key: string): Promise<void> {
    try {
      const result = reduceKey(state, key, keyEnv);
      state = result.state;
      render();

      for (const effect of result.effects) {
        await runEffect(effect);
      }
    } catch (error) {
      reportKeyFailure(error);
    }
  }

  function reportKeyFailure(error: unknown): void {
    try {
      state = addLog("error", formatError(error))(state);
      render();
    } catch {
      // Painting the failure failed too. Keep the loop alive rather than
      // taking the terminal down over a log line.
    }
  }

  async function runEffect(effect: Effect): Promise<void> {
    switch (effect.kind) {
      case "exit":
        stop();
        exit(0);
        return;

      case "open-browser":
        await report(launcher.openInBrowser(effect.project, state.server.port));
        return;

      case "open-studio":
        await report(launcher.openInStudio(effect.project));
        return;

      case "open-ide":
        await report(launcher.openInIDE(effect.project));
        return;

      case "open-mcp-settings":
        await report(launcher.openMCPSettings());
        return;

      case "logout":
        await logout();
        // setRemoteUser(null) also moves the active list off the remote
        // section, which stops rendering once signed out.
        update(setRemoteUser(null));
        update(setRemoteProjects([]));
        update(addLog("info", "Logged out"));
        return;

      case "login":
        await runLogin(effect.provider);
        return;

      case "pull":
        await runPull(effect.project);
        return;

      case "push":
        await runPush(effect.project);
        return;

      case "create-project":
        state = await createProject({ state, render }, effect.name, effect.template);
        render();
        return;
    }
  }

  /** Surface a failed action in the log; successes speak for themselves. */
  async function report(action: Promise<{ success: boolean; message?: string }>): Promise<void> {
    const result = await action;
    if (!result.success) update(addLog("error", result.message ?? "Action failed"));
  }

  async function runLogin(provider: "google" | "github" | "microsoft"): Promise<void> {
    const user = await login(provider);

    if (!user) {
      update(addLog("error", `Login with ${provider} did not complete.`));
      render();
      return;
    }

    if (isApiKeyIdentity(user)) {
      // Nothing to list: an API key is not a signed-in account.
      update(addLog("info", "Authenticated with an API key; remote projects are unavailable."));
      render();
      return;
    }

    const result = await fetchRemoteProjects();
    update(setRemoteUser(user));
    update(setRemoteProjects(result.projects));
    update(addLog("info", `Logged in as ${user.email}`));
    render();
  }

  async function runPull(project: { slug: string; path: string }): Promise<void> {
    const token = await readToken();
    if (!token) {
      update(addLog("error", "Not authenticated. Press 'a' to login."));
      return;
    }

    update(addLog("info", `Pulling ${project.slug}...`));

    try {
      await pullCommand({
        projectSlug: project.slug,
        projectDir: project.path,
        force: true,
        quiet: true,
      });
      update(addLog("info", `Pulled ${project.slug}`));
    } catch (err) {
      update(addLog("error", `Pull failed: ${formatError(err)}`));
    }
  }

  async function runPush(project: { slug: string; path: string }): Promise<void> {
    update(addLog("info", `Pushing ${project.slug}...`));

    try {
      const pushOptions = createStagedPushOptions(project.slug, project.path);
      await pushCommand(pushOptions);
      update(
        addLog("info", `Pushed ${project.slug} to ${pushOptions.branch}, merge in Studio`),
      );
    } catch (err) {
      update(addLog("error", `Push failed: ${formatError(err)}`));
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
      console.log(`Server running on http://localhost:${config.port}`);
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

      return interceptConsole({
        updateState: update,
        render,
      });
    },
  };
}
