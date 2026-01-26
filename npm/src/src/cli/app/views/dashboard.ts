/**
 * Dashboard View
 *
 * Main view showing server status, projects, and quick actions.
 */

import { box } from "../../ui/box.js";
import { brand, dim, error, muted, success } from "../../ui/colors.js";
import { getTerminalWidth } from "../../ui/layout.js";
import { getAgentFaceWithText } from "../../ui/dot-matrix.js";
import { renderList } from "../components/list-select.js";
import type { AppState } from "../state.js";

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
  const hasRemoteProjects = state.remote.user && state.remote.projects.length > 0;

  if (hasProjects) {
    const isActive = state.activeList === "projects";
    lines.push(renderSection("Local Projects", state.projects.items.length, isActive));
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

  // Remote projects (when logged in)
  if (hasRemoteProjects) {
    const isRemoteActive = state.activeList === "remoteProjects";
    const visibleCount = 5;
    const start = state.remote.scrollOffset;
    const end = Math.min(start + visibleCount, state.remote.projects.length);
    const visibleProjects = state.remote.projects.slice(start, end);

    lines.push(renderSection("Remote Projects", state.remote.projects.length, isRemoteActive));

    if (start > 0) {
      lines.push(`  ${dim("↑ more above")}`);
    }

    visibleProjects.forEach((p, i) => {
      const actualIndex = start + i;
      const isFocused = isRemoteActive && actualIndex === state.remote.focusedIndex;
      const cursor = isFocused ? brand("›") : " ";
      // Show number 1-9 or letter a-z for 10+
      const displayNum = actualIndex + 1;
      const shortcut = displayNum <= 9
        ? String(displayNum)
        : String.fromCharCode(96 + displayNum - 9); // 10='a', 11='b', etc.
      const num = isFocused ? brand(`[${shortcut}]`) : dim(`[${shortcut}]`);
      const label = isFocused ? p.slug : dim(p.slug);
      lines.push(`${cursor} ${num} ${label}`);
    });

    if (end < state.remote.projects.length) {
      lines.push(`  ${dim("↓ more below")}`);
    }
    lines.push("");
  }

  if (hasExamples) {
    const isActive = state.activeList === "examples";
    lines.push(renderSection("Examples", state.examples.items.length, isActive));
    lines.push(
      renderList(state.examples, {
        maxWidth: maxListWidth,
        visibleCount: 5,
        showNumbers: true,
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
    textLines.push(`${mcpDot} ${dim("MCP")}`);
    if (state.mcp.transport === "http") {
      const port = state.mcp.httpPort ?? 9999;
      textLines.push(`  ${brand(`http://veryfront.me:${port}/mcp`)}`);
    } else {
      textLines.push(`  ${dim("stdio")}`);
    }
  }

  const { errors, warnings } = state.server;
  if (errors > 0 || warnings > 0) {
    const parts: string[] = [];
    if (errors > 0) parts.push(error(`${errors} errors`));
    if (warnings > 0) parts.push(muted(`${warnings} warnings`));
    textLines.push(parts.join("  "));
  }

  return getAgentFaceWithText(textLines, {
    litColor: "\x1b[38;2;252;143;93m", // Veryfront brand orange
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

  const hasProjects = state.projects.items.length > 0;
  const hasExamples = state.examples.items.length > 0;
  const hasRemoteProjects = state.remote.user && state.remote.projects.length > 0;

  // Count sections for tab switching
  const sectionCount = [hasProjects, hasExamples, hasRemoteProjects].filter(Boolean).length;

  if (sectionCount > 1) {
    parts.push(dim("tab switch"));
  }

  parts.push(dim("↑↓ nav"));

  if (hasProjects || hasExamples || hasRemoteProjects) {
    parts.push(dim("o open"), dim("s studio"), dim("i ide"));
  }

  if (!state.remote.user) {
    parts.push(dim("a login"));
  } else {
    // Show context-aware actions based on active list
    if (state.activeList === "projects") {
      parts.push(dim("p pull"), dim("u push"));
    } else if (state.activeList === "remoteProjects") {
      parts.push(dim("p pull"));
    }
    parts.push(dim("n new"), dim("x logout"));
  }

  parts.push(dim("? help"), dim("q quit"));

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
    titleColor: "\x1b[38;2;252;143;93m",
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
