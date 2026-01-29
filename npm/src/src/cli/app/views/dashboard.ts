// Dashboard View
// Main view showing projects, templates, examples, and quick actions

import { box } from "../../ui/box.js";
import { brand, dim, error, muted } from "../../ui/colors.js";
import { getTerminalWidth } from "../../ui/layout.js";
import { getAgentFaceWithText } from "../../ui/dot-matrix.js";
import { renderList } from "../components/list-select.js";
import type { AppState } from "../state.js";

export function renderDashboard(state: AppState): string {
  const termWidth = Math.min(getTerminalWidth() - 4, 80);
  const maxListWidth = termWidth - 4;
  const lines: string[] = [];

  const hasProjects = state.projects.items.length > 0;
  const hasRemote = state.remote.user && state.remote.projects.length > 0;
  const hasTemplates = state.templates.items.length > 0;
  const hasExamples = state.examples.items.length > 0;

  // Local projects
  if (hasProjects) {
    const isActive = state.activeSection === "projects";
    lines.push(renderSection("Local", isActive));
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
  if (hasRemote) {
    const isActive = state.activeSection === "remote";
    const visibleCount = 5;
    const start = state.remote.scrollOffset;
    const end = Math.min(start + visibleCount, state.remote.projects.length);
    const visibleProjects = state.remote.projects.slice(start, end);

    lines.push(renderSection("Remote", isActive));

    if (start > 0) {
      lines.push(`   ${dim("↑")}  ${dim("more above")}`);
    }

    visibleProjects.forEach((p, i) => {
      const actualIndex = start + i;
      const isFocused = isActive && actualIndex === state.remote.focusedIndex;
      const cursor = isFocused ? brand("›") : " ";
      const displayNum = actualIndex + 1;
      const shortcut = displayNum <= 9
        ? String(displayNum)
        : String.fromCharCode(96 + displayNum - 9);
      const num = isFocused ? brand(`[${shortcut}]`) : dim(`[${shortcut}]`);
      const label = isFocused ? p.slug : dim(p.slug);
      lines.push(`${cursor} ${num} ${label}`);
    });

    if (end < state.remote.projects.length) {
      lines.push(`   ${dim("↓")}  ${dim("more below")}`);
    }
    lines.push("");
  }

  // Templates
  if (hasTemplates) {
    const isActive = state.activeSection === "templates";
    lines.push(renderSection("Templates", isActive));
    lines.push(
      renderList(state.templates, {
        maxWidth: maxListWidth,
        visibleCount: 5,
        showNumbers: true,
        showSelection: isActive,
      }),
      "",
    );
  }

  // Examples
  if (hasExamples) {
    const isActive = state.activeSection === "examples";
    lines.push(renderSection("Examples", isActive));
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

export function renderBanner(state: AppState): string {
  const termWidth = Math.min(getTerminalWidth() - 4, 80);
  const textLines: string[] = [];

  textLines.push("");
  textLines.push(`${brand("Veryfront Code")} ${dim("is now running")}`);
  textLines.push("");

  textLines.push(`${dim("Url")} ${brand(state.server.url)}`);
  if (state.mcp.enabled && state.mcp.transport === "http") {
    const port = state.mcp.httpPort ?? 9999;
    textLines.push(`${dim("Mcp")} ${brand(`http://veryfront.me:${port}/mcp`)}`);
  } else {
    textLines.push("");
  }

  // Coding agent info
  if (state.code.agent) {
    const agentName = state.code.agent.name;
    const model = state.code.model ? ` (${state.code.model})` : "";
    textLines.push(`${dim("Agent")} ${brand(agentName)}${dim(model)}`);
  } else {
    textLines.push(`${dim("Agent")} ${muted("none")} ${dim("c to select")}`);
  }

  const { errors, warnings } = state.server;
  if (errors > 0 || warnings > 0) {
    const parts: string[] = [];
    if (errors > 0) parts.push(error(`${errors} errors`));
    if (warnings > 0) parts.push(muted(`${warnings} warnings`));
    textLines.push(parts.join("  "));
  }

  while (textLines.length < 7) {
    textLines.push("");
  }

  const content = getAgentFaceWithText(textLines, {
    litColor: "\x1b[38;2;252;143;93m",
  });

  return box(content, {
    style: "rounded",
    width: termWidth,
    paddingX: 2,
    paddingY: 1,
    borderColor: "\x1b[2m",
  });
}

function renderSection(title: string, isActive: boolean): string {
  const indicator = isActive ? brand("›") : " ";
  const titleText = isActive ? title : dim(title);
  return `  ${indicator} ${titleText}`;
}

function renderHelpBar(state: AppState): string {
  const modeIndicator = state.mode === "COMMAND"
    ? brand(":") + dim("command")
    : state.mode === "SEARCH"
    ? brand("/") + dim("search")
    : "";

  if (!state.showHelp) {
    const userInfo = state.remote.user ? `  ${dim("-")}  ${brand(state.remote.user.email)}` : "";
    const modeSection = modeIndicator ? `  ${modeIndicator}  ` : "";
    return `  ${dim("↑↓/jk nav  c code  r resources  ? more  q quit")}${modeSection}${userInfo}`;
  }

  const lines: string[] = [];
  lines.push(
    `  ${dim("c")} code  ${dim("r")} resources  ${dim("o")} browser  ${dim("s")} studio  ${
      dim("i")
    } ide`,
  );

  if (!state.remote.user) {
    lines.push(`  ${dim("n")} new  ${dim("a")} login`);
  } else {
    lines.push(`  ${dim("n")} new  ${dim("p")} pull  ${dim("u")} push  ${dim("x")} logout`);
  }

  lines.push(`  ${dim("? hide  q quit")}`);

  return lines.join("\n");
}

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

export function renderEmptyState(): string {
  return `\n  ${dim("No projects.")} ${brand("n")} ${dim("to create")}\n`;
}
