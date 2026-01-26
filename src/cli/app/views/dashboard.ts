/**
 * Dashboard View
 *
 * Main view showing server status, projects, and quick actions.
 */

import { box } from "../../ui/box.ts";
import { brand, dim, error, muted } from "../../ui/colors.ts";
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
  const hasRemoteProjects = state.remote.user && state.remote.projects.length > 0;

  if (hasProjects) {
    const isActive = state.activeList === "projects";
    lines.push(renderSection("Local", state.projects.items.length, isActive));
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

    lines.push(renderSection("Remote", state.remote.projects.length, isRemoteActive));

    if (start > 0) {
      lines.push(`   ${dim("↑")}  ${dim("more above")}`);
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
      lines.push(`   ${dim("↓")}  ${dim("more below")}`);
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
 * Render the banner with agent face and server info inside a box
 */
function renderBanner(state: AppState): string {
  const termWidth = Math.min(getTerminalWidth() - 4, 80);
  const textLines: string[] = [];

  textLines.push("");
  textLines.push(`${brand("Veryfront Code")} ${dim("is now running")}`);
  textLines.push("");

  // Server URL and MCP URL - always reserve both lines to prevent jumps
  textLines.push(`${dim("Url")} ${brand(state.server.url)}`);
  if (state.mcp.enabled && state.mcp.transport === "http") {
    const port = state.mcp.httpPort ?? 9999;
    textLines.push(`${dim("Mcp")} ${brand(`http://veryfront.me:${port}/mcp`)}`);
  } else {
    textLines.push("");
  }

  // Errors/warnings on separate line if any
  const { errors, warnings } = state.server;
  if (errors > 0 || warnings > 0) {
    const parts: string[] = [];
    if (errors > 0) parts.push(error(`${errors} errors`));
    if (warnings > 0) parts.push(muted(`${warnings} warnings`));
    textLines.push(parts.join("  "));
  }

  // Pad to 7 text lines (matching avatar height) for consistent title position
  while (textLines.length < 7) {
    textLines.push("");
  }

  const content = getAgentFaceWithText(textLines, {
    litColor: "\x1b[38;2;252;143;93m", // Veryfront brand orange
  });

  return box(content, {
    style: "rounded",
    width: termWidth,
    paddingX: 2,
    paddingY: 1,
    borderColor: "\x1b[2m", // Dim to match footer
  });
}

/**
 * Render a section header
 */
function renderSection(title: string, _count: number, isActive = true): string {
  const indicator = isActive ? brand("›") : " ";
  const titleText = isActive ? title : dim(title);
  return `  ${indicator} ${titleText}`;
}

/**
 * Render the help bar at the bottom
 */
function renderHelpBar(state: AppState): string {
  // Minimal by default, ? reveals all
  if (!state.showHelp) {
    const userInfo = state.remote.user ? `  ${dim("-")}  ${brand(state.remote.user.email)}` : "";
    return `  ${dim("↑↓ select  enter open  ? more  q quit")}${userInfo}`;
  }

  // Expanded help
  const lines: string[] = [];
  lines.push(`  ${dim("o")} open  ${dim("s")} studio  ${dim("i")} ide`);

  if (!state.remote.user) {
    lines.push(`  ${dim("n")} new  ${dim("a")} login`);
  } else {
    lines.push(`  ${dim("n")} new  ${dim("p")} pull  ${dim("u")} push  ${dim("x")} logout`);
  }

  lines.push(`  ${dim("? hide  q quit")}`);

  return lines.join("\n");
}

/**
 * Render a boxed dashboard (alternative style)
 */
export function renderDashboardBoxed(state: AppState): string {
  const termWidth = Math.min(getTerminalWidth() - 4, 80);
  const content = renderDashboard(state);

  return box(content, {
    style: "rounded",
    title: "Veryfront Code",
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
  return `\n  ${dim("No projects.")} ${brand("n")} ${dim("to create")}\n`;
}
