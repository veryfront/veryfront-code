/**
 * Dashboard View
 *
 * Main view showing server status, projects, and quick actions.
 */

import { box } from "../../ui/box.ts";
import { brand, dim, error, muted, success } from "../../ui/colors.ts";
import { getTerminalWidth } from "../../ui/layout.ts";
import { renderList } from "../components/list-select.ts";
import { getAgentFaceWithText } from "../../ui/dot-matrix.ts";
import type { AppState } from "../state.ts";

/**
 * Render the dashboard view
 */
export function renderDashboard(state: AppState): string {
  const termWidth = Math.min(getTerminalWidth() - 4, 80);
  const lines: string[] = [];

  // Banner with agent face and server info
  lines.push(renderBanner(state));
  lines.push("");

  // Projects section
  if (state.projects.items.length > 0) {
    const isActive = state.activeList === "projects";
    lines.push(renderSection("Your Projects", state.projects.items.length, isActive));
    lines.push(
      renderList(state.projects, {
        maxWidth: termWidth - 4,
        visibleCount: 5,
        showNumbers: true,
        showSelection: isActive,
      }),
    );
    lines.push("");
  }

  // Examples section
  if (state.examples.items.length > 0) {
    const isActive = state.activeList === "examples";
    lines.push(renderSection("Examples", state.examples.items.length, isActive));
    lines.push(
      renderList(state.examples, {
        maxWidth: termWidth - 4,
        visibleCount: 5,
        showNumbers: true,
        numberOffset: state.projects.items.length, // Continue numbering from projects
        showSelection: isActive,
      }),
    );
    lines.push("");
  }

  // Help bar
  lines.push(renderHelpBar(state));

  return lines.join("\n");
}

/**
 * Render the banner with agent face and server info
 */
function renderBanner(state: AppState): string {
  const serverDot = state.server.running ? success("●") : error("●");
  const mcpDot = state.mcp.enabled ? success("●") : dim("○");

  const textLines: string[] = [];

  // Server status line
  textLines.push(`${serverDot} ${dim("Server running")}`);
  textLines.push(`  ${brand(state.server.url)}`);

  // MCP status line
  if (state.mcp.enabled) {
    const mcpInfo = state.mcp.transport === "http"
      ? `port ${brand(String(state.mcp.httpPort || 9999))}`
      : "stdio";
    textLines.push(`${mcpDot} ${dim("MCP")} ${mcpInfo}`);
  }

  // Error/warning counts
  if (state.server.errors > 0 || state.server.warnings > 0) {
    const errText = state.server.errors > 0 ? error(`${state.server.errors} errors`) : "";
    const warnText = state.server.warnings > 0 ? muted(`${state.server.warnings} warnings`) : "";
    const separator = errText && warnText ? "  " : "";
    textLines.push(`${errText}${separator}${warnText}`);
  }

  return getAgentFaceWithText(textLines, {
    litColor: "\x1b[38;2;0;163;244m", // Veryfront brand blue
  });
}

/**
 * Render a section header
 */
function renderSection(title: string, count: number, isActive = true): string {
  const indicator = isActive ? brand("›") : " ";
  const titleText = isActive ? title : dim(title);
  return `  ${indicator} ${titleText} ${dim(`(${count})`)}`;
}

/**
 * Render quick action buttons
 */
function renderQuickActions(): string {
  const actions = [
    { key: "n", label: "New Project" },
    { key: "?", label: "Help" },
  ];

  const parts = actions.map((a) => `${brand(`[${a.key}]`)} ${dim(a.label)}`);
  return `  ${parts.join("   ")}`;
}

/**
 * Render the help bar at the bottom
 */
function renderHelpBar(state: AppState): string {
  const parts: string[] = [];

  // Navigation
  parts.push(`${dim("↑↓")} nav`);

  // Tab to switch sections (only if both exist)
  if (state.projects.items.length > 0 && state.examples.items.length > 0) {
    parts.push(`${dim("Tab")} switch`);
  }

  // Quick actions based on context
  if (state.projects.items.length > 0 || state.examples.items.length > 0) {
    parts.push(`${dim("o")} open`);
    parts.push(`${dim("s")} studio`);
    parts.push(`${dim("i")} ide`);
  }

  // Other
  parts.push(`${dim("n")} new`);
  parts.push(`${dim("?")} help`);
  parts.push(`${dim("q")} quit`);

  return `  ${parts.join("  ")}`;
}

/**
 * Render a boxed dashboard (alternative style)
 */
export function renderDashboardBoxed(state: AppState): string {
  const termWidth = Math.min(getTerminalWidth() - 4, 80);

  const content = renderDashboard(state);

  return box(content, {
    style: "rounded",
    title: "Veryfront",
    titleColor: "\x1b[38;2;0;163;244m",
    width: termWidth,
    paddingX: 1,
    paddingY: 0,
  });
}

/**
 * Render empty state when no projects found
 */
export function renderEmptyState(): string {
  const lines = [
    "",
    `  ${dim("No projects found.")}`,
    "",
    `  ${dim("Get started:")}`,
    `    ${brand("[n]")} Create a new project`,
    `    ${brand("[t]")} Browse templates`,
    "",
    `  ${dim("Or run with a project directory:")}`,
    `    ${muted("deno task start --project ./my-project")}`,
    "",
  ];
  return lines.join("\n");
}
