/**
 * Dashboard View
 *
 * Main view showing server status, projects, and quick actions.
 */

import { box } from "../../ui/box.ts";
import { brand, dim, error, muted, success } from "../../ui/colors.ts";
import { getTerminalWidth } from "../../ui/layout.ts";
import { getAgentFaceWithText } from "../../ui/dot-matrix.ts";
import { renderList } from "../components/list-select.ts";
import type { AppState } from "../state.ts";

/**
 * Render the dashboard view
 */
export function renderDashboard(state: AppState): string {
  const termWidth = Math.min(getTerminalWidth() - 4, 80);
  const maxListWidth = termWidth - 4;
  const lines: string[] = [];

  lines.push(renderBanner(state), "");

  const hasProjects = state.projects.items.length > 0;
  const hasExamples = state.examples.items.length > 0;

  if (hasProjects) {
    const isActive = state.activeList === "projects";
    lines.push(renderSection("Your Projects", state.projects.items.length, isActive));
    lines.push(
      renderList(state.projects, {
        maxWidth: maxListWidth,
        visibleCount: 5,
        showNumbers: true,
        showSelection: isActive,
      }),
      "",
    );
  }

  if (hasExamples) {
    const isActive = state.activeList === "examples";
    lines.push(renderSection("Examples", state.examples.items.length, isActive));
    lines.push(
      renderList(state.examples, {
        maxWidth: maxListWidth,
        visibleCount: 5,
        showNumbers: true,
        numberOffset: state.projects.items.length,
        showSelection: isActive,
      }),
      "",
    );
  }

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

  textLines.push(`${serverDot} ${dim("Server running")}`);
  textLines.push(`  ${brand(state.server.url)}`);

  if (state.mcp.enabled) {
    let mcpInfo = "stdio";
    if (state.mcp.transport === "http") {
      mcpInfo = `port ${brand(String(state.mcp.httpPort ?? 9999))}`;
    }
    textLines.push(`${mcpDot} ${dim("MCP")} ${mcpInfo}`);
  }

  const { errors, warnings } = state.server;
  if (errors > 0 || warnings > 0) {
    const parts: string[] = [];
    if (errors > 0) parts.push(error(`${errors} errors`));
    if (warnings > 0) parts.push(muted(`${warnings} warnings`));
    textLines.push(parts.join("  "));
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
 * Render the help bar at the bottom
 */
function renderHelpBar(state: AppState): string {
  const parts: string[] = [];

  parts.push(`${dim("↑↓")} nav`);

  const hasProjects = state.projects.items.length > 0;
  const hasExamples = state.examples.items.length > 0;

  if (hasProjects && hasExamples) {
    parts.push(`${dim("tab")} switch`);
  }

  if (hasProjects || hasExamples) {
    parts.push(`${dim("o")} open`, `${dim("s")} studio`, `${dim("i")} ide`);
  }

  parts.push(`${dim("n")} new`, `${dim("?")} help`, `${dim("q")} quit`);

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
  return [
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
  ].join("\n");
}
