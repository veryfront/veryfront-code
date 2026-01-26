/**
 * Startup View
 *
 * Shows loading progress with consistent box sizing.
 * Displays avatar, title, and step checklist.
 */

import { box } from "../../ui/box.ts";
import { brand, dim, shimmer, success } from "../../ui/colors.ts";
import { getTerminalWidth } from "../../ui/layout.ts";
import { getAgentFaceWithText } from "../../ui/dot-matrix.ts";

export interface StartupStep {
  label: string;
  status: "pending" | "active" | "done";
}

export interface StartupState {
  steps: StartupStep[];
  serverUrl?: string;
  mcpUrl?: string;
  ready: boolean;
  /** Animation frame counter for shimmer effect */
  frame: number;
}

/**
 * Render the startup view inside a consistent-sized box
 */
export function renderStartup(state: StartupState): string {
  const termWidth = Math.min(getTerminalWidth() - 4, 80);
  const textLines: string[] = [];

  if (state.ready) {
    // Running state
    textLines.push(`${brand("Veryfront Code")} ${dim("is now running")}`);
    textLines.push("");
    if (state.serverUrl) {
      textLines.push(`${dim("Url")}  ${brand(state.serverUrl)}`);
    }
    if (state.mcpUrl) {
      textLines.push(`${dim("Mcp")}  ${brand(state.mcpUrl)}`);
    }
  } else {
    // Loading state
    textLines.push(`${brand("Veryfront Code")} ${dim("starting...")}`);
    textLines.push("");

    for (const step of state.steps) {
      if (step.status === "done") {
        textLines.push(`${success("●")} ${dim(step.label)}`);
      } else if (step.status === "active") {
        // Apply shimmer effect to active step
        textLines.push(`${brand("●")} ${shimmer(step.label, state.frame)}`);
      } else {
        textLines.push(`${dim("○")} ${dim(step.label)}`);
      }
    }
  }

  // Pad to minimum 5 text lines for consistent height
  while (textLines.length < 5) {
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
  });
}

/**
 * Create initial startup state with steps
 */
export function createStartupState(stepLabels: string[]): StartupState {
  return {
    steps: stepLabels.map((label) => ({ label, status: "pending" })),
    ready: false,
    frame: 0,
  };
}

/**
 * Increment animation frame for shimmer effect
 */
export function incrementFrame(state: StartupState): StartupState {
  return { ...state, frame: state.frame + 1 };
}

/**
 * Set a step to active
 */
export function setStepActive(state: StartupState, index: number): StartupState {
  const steps = state.steps.map((step, i) => ({
    ...step,
    status: i < index ? "done" : i === index ? "active" : "pending",
  })) as StartupStep[];

  return { ...state, steps };
}

/**
 * Mark all steps done and set ready
 */
export function setStartupReady(
  state: StartupState,
  serverUrl: string,
  mcpUrl?: string,
): StartupState {
  const steps = state.steps.map((step) => ({
    ...step,
    status: "done" as const,
  }));

  return { ...state, steps, serverUrl, mcpUrl, ready: true };
}
