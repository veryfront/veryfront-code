/**
 * Header Banner Component
 *
 * The distinctive Veryfront header with dot-matrix logo showing
 * server status, agent info, and active project.
 */

import { z } from "zod";
import { box } from "../../ui/box.ts";
import { brand, dim, error as errorColor, muted, success } from "../../ui/colors.ts";

// ============================================================================
// Schemas
// ============================================================================

export const ServerStatusSchema = z.enum(["starting", "running", "error", "stopped"]);
export type ServerStatus = z.infer<typeof ServerStatusSchema>;

export const HeaderStateSchema = z.object({
  /** Server status */
  status: ServerStatusSchema,
  /** Dev server URL */
  serverUrl: z.string().nullable(),
  /** MCP server URL */
  mcpUrl: z.string().nullable(),
  /** Current coding agent name */
  agentName: z.string().nullable(),
  /** Current model name */
  modelName: z.string().nullable(),
  /** Active project name */
  projectName: z.string().nullable(),
  /** Error message if status is error */
  errorMessage: z.string().nullable(),
});

export type HeaderState = z.infer<typeof HeaderStateSchema>;

// ============================================================================
// State Management
// ============================================================================

/** Create initial header state */
export function createHeaderState(): HeaderState {
  return {
    status: "stopped",
    serverUrl: null,
    mcpUrl: null,
    agentName: null,
    modelName: null,
    projectName: null,
    errorMessage: null,
  };
}

export type HeaderUpdater = (state: HeaderState) => HeaderState;

/** Update server status */
export function setServerStatus(status: ServerStatus, errorMessage?: string): HeaderUpdater {
  return (state) => ({
    ...state,
    status,
    errorMessage: errorMessage ?? null,
  });
}

/** Set server URLs */
export function setServerUrls(serverUrl: string, mcpUrl?: string): HeaderUpdater {
  return (state) => ({
    ...state,
    serverUrl,
    mcpUrl: mcpUrl ?? null,
  });
}

/** Set coding agent */
export function setAgent(name: string, model?: string): HeaderUpdater {
  return (state) => ({
    ...state,
    agentName: name,
    modelName: model ?? null,
  });
}

/** Set active project */
export function setProject(name: string): HeaderUpdater {
  return (state) => ({
    ...state,
    projectName: name,
  });
}

// ============================================================================
// Logo Rendering
// ============================================================================

/**
 * The Veryfront "V" logo in dot matrix form
 * ○ = empty dot (dim)
 * ● = filled dot (brand color)
 */
const LOGO_MATRIX = [
  "○ ○ ○ ○ ○ ○ ○",
  "○ ● ● ● ○ ○ ○",
  "○ ● ● ● ● ○ ○",
  "○ ● ● ○ ● ● ○",
  "○ ○ ● ● ● ○ ○",
  "○ ○ ○ ● ● ● ○",
  "○ ○ ○ ○ ○ ○ ○",
];

/** Render the dot matrix logo */
export function renderLogo(): string[] {
  return LOGO_MATRIX.map((row) => {
    return row
      .split("")
      .map((char) => {
        if (char === "●") return brand("●");
        if (char === "○") return dim("○");
        return char;
      })
      .join("");
  });
}

// ============================================================================
// Status Rendering
// ============================================================================

/** Get status text with color */
function getStatusText(status: ServerStatus): string {
  switch (status) {
    case "running":
      return success("is now running");
    case "starting":
      return muted("starting...");
    case "error":
      return errorColor("error");
    case "stopped":
      return dim("stopped");
  }
}

/** Render info lines (right side of logo) */
function renderInfoLines(state: HeaderState): string[] {
  const lines: string[] = [];

  // Line 1: Status
  lines.push(`Veryfront Code ${getStatusText(state.status)}`);

  // Line 2: Empty or error
  if (state.status === "error" && state.errorMessage) {
    lines.push(errorColor(state.errorMessage));
  } else {
    lines.push("");
  }

  // Line 3: Server URL
  if (state.serverUrl) {
    lines.push(`${dim("Url")} ${state.serverUrl}`);
  } else {
    lines.push("");
  }

  // Line 4: MCP URL
  if (state.mcpUrl) {
    lines.push(`${dim("Mcp")} ${state.mcpUrl}`);
  } else {
    lines.push("");
  }

  // Line 5: Empty
  lines.push("");

  // Line 6: Coding Agent
  if (state.agentName) {
    const modelPart = state.modelName ? ` (${state.modelName})` : "";
    lines.push(`${dim("Coding Agent:")} ${brand(state.agentName)}${dim(modelPart)}`);
  } else {
    lines.push(`${dim("Coding Agent:")} ${muted("none")}`);
  }

  // Line 7: Active Project
  if (state.projectName) {
    lines.push(`${dim("Active Project:")} ${state.projectName}`);
  } else {
    lines.push(`${dim("Active Project:")} ${muted("none")}`);
  }

  return lines;
}

// ============================================================================
// Main Rendering
// ============================================================================

/** Render the full header banner */
export function renderHeaderBanner(state: HeaderState, width = 70): string {
  const logo = renderLogo();
  const info = renderInfoLines(state);

  // Combine logo and info side by side
  const lines: string[] = [];
  const logoWidth = 15; // "○ ○ ○ ○ ○ ○ ○" visible length
  const gap = "      "; // 6 spaces

  for (let i = 0; i < Math.max(logo.length, info.length); i++) {
    const logoLine = logo[i] ?? " ".repeat(logoWidth);
    const infoLine = info[i] ?? "";
    lines.push(`${logoLine}${gap}${infoLine}`);
  }

  return box(lines.join("\n"), {
    style: "rounded",
    width,
    padding: 1,
  });
}

/** Render compact header (single line) */
export function renderCompactHeader(state: HeaderState): string {
  const parts: string[] = [];

  // Status
  parts.push(`Veryfront ${getStatusText(state.status)}`);

  // Agent
  if (state.agentName) {
    parts.push(`${dim("|")} ${brand(state.agentName)}`);
  }

  // Project
  if (state.projectName) {
    parts.push(`${dim("|")} ${state.projectName}`);
  }

  return parts.join(" ");
}
