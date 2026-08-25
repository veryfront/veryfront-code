/**
 * Dashboard View
 *
 * Main view showing server status, projects, and quick actions.
 */

import { brand, dim, error, muted } from "../../ui/colors.ts";
import { getTerminalWidth } from "../../ui/layout.ts";
import { renderList } from "../components/list-select.ts";
import type { AppState } from "../state.ts";

/**
 * Render the dashboard view
 */
export function renderDashboard(state: AppState): string {
  const termWidth = Math.max(0, Math.min(getTerminalWidth() - 4, 80));
  const maxListWidth = Math.max(0, termWidth - 4);
  const lines: string[] = [];

  lines.push(renderStatus(state), "");

  if (state.projects.items.length > 0) {
    lines.push(...renderProjectSection("Local", state.projects, "projects", state, maxListWidth));
  }

  if (hasRemoteProjects(state)) {
    lines.push(
      ...renderProjectSection(
        "Remote",
        state.remoteProjects,
        "remoteProjects",
        state,
        maxListWidth,
      ),
    );
  }

  lines.push(renderHelpBar(state));

  return lines.join("\n");
}

function renderProjectSection(
  title: string,
  list: AppState["projects"],
  key: AppState["activeList"],
  state: AppState,
  maxWidth: number,
): string[] {
  const isActive = state.activeList === key;
  return [
    renderSection(title, isActive),
    renderList(list, {
      maxWidth,
      visibleCount: 5,
      showNumbers: true,
      showSelection: isActive,
    }),
    "",
  ];
}

function hasRemoteProjects(state: AppState): boolean {
  return !!state.remote.user && state.remoteProjects.items.length > 0;
}

function renderStatus(state: AppState): string {
  const lines = [`  ✓ Server ready at ${brand(state.server.url)}`];

  if (state.mcp.enabled && state.mcp.transport === "http" && state.mcp.httpPort !== undefined) {
    lines.push(`  ✓ MCP ready at ${brand(`http://localhost:${state.mcp.httpPort}/mcp`)}`);
  }

  const { errors, warnings } = state.server;
  if (errors > 0 || warnings > 0) {
    const parts: string[] = [];
    if (errors > 0) parts.push(error(`${errors} errors`));
    if (warnings > 0) parts.push(muted(`${warnings} warnings`));
    lines.push(`  ${parts.join("  ")}`);
  }

  return lines.join("\n");
}

/**
 * Render a section header
 */
function renderSection(title: string, isActive = true): string {
  const indicator = isActive ? brand("›") : " ";
  const titleText = isActive ? title : dim(title);
  return `  ${indicator} ${titleText}`;
}

/**
 * Render the help bar at the bottom
 */
function renderHelpBar(state: AppState): string {
  const hasItems = state.projects.items.length > 0 || hasRemoteProjects(state);

  if (!state.showHelp) {
    const userInfo = state.remote.user ? `  ${dim("-")}  ${dim(state.remote.user.email)}` : "";
    if (!hasItems) {
      const authHint = state.remote.user
        ? `${dim("x")} ${dim("logout")}`
        : `${dim("a")} ${dim("login")}`;
      return `  ${dim("n")} ${dim("new project")}  ${authHint}  ${dim("? more")}  ${
        dim("q quit")
      }${userInfo}`;
    }
    return `  ${dim("↑↓ select  enter open  ? more  q quit")}${userInfo}`;
  }

  const lines: string[] = [];

  if (hasItems) {
    lines.push(`  ${dim("o")} open  ${dim("s")} studio  ${dim("i")} ide`);
  }

  if (!state.remote.user) {
    lines.push(`  ${dim("n")} new  ${dim("a")} login`);
  } else {
    const parts = [`  ${dim("n")} new`];
    if (hasItems) parts.push(`${dim("p")} pull  ${dim("u")} push`);
    parts.push(`${dim("x")} logout`);
    lines.push(parts.join("  "));
  }

  lines.push(`  ${dim("? hide  q quit")}`);

  return lines.join("\n");
}

/**
 * Render empty state when no projects found
 */
export function renderEmptyState(state: AppState): string {
  const lines: string[] = [];

  lines.push(renderStatus(state), "");
  lines.push(`  ${dim("No projects.")} ${brand("n")} ${dim("to create")}`, "");
  lines.push(renderHelpBar(state));

  return lines.join("\n");
}
