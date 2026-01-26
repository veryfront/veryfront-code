/**
 * Startup View
 *
 * Shows loading progress with consistent box sizing.
 * Displays avatar, title, and step checklist.
 */

import { box } from "../../ui/box.ts";
import { brand, dim, shimmer } from "../../ui/colors.ts";

// Dim orange for completed steps - matches the trailing dots in spinning animation
const dimOrange = (text: string) => `\x1b[38;2;180;100;65m${text}\x1b[0m`;
import { getTerminalWidth } from "../../ui/layout.ts";
import { getAgentFaceWithText, getSpinningAgentFace } from "../../ui/dot-matrix.ts";

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
    // Running state - always reserve space for both URL lines to prevent jumps
    textLines.push("");
    textLines.push(`${brand("Veryfront Code")} ${dim("is now running")}`);
    textLines.push("");
    textLines.push(state.serverUrl ? `${dim("Url")} ${brand(state.serverUrl)}` : "");
    textLines.push(state.mcpUrl ? `${dim("Mcp")} ${brand(state.mcpUrl)}` : "");
  } else {
    // Loading state - match ready state layout
    textLines.push("");
    textLines.push(`${brand("Veryfront Code")} ${dim("starting...")}`);
    textLines.push("");

    for (const step of state.steps) {
      if (step.status === "done") {
        // Completed: dim orange (fades into background, coherent with avatar)
        textLines.push(`${dimOrange("●")} ${dimOrange(step.label)}`);
      } else if (step.status === "active") {
        // Active: bright orange dot with shimmer text
        textLines.push(`${brand("●")} ${shimmer(step.label, state.frame)}`);
      } else {
        // Pending: gray empty circle
        textLines.push(`${dim("○")} ${dim(step.label)}`);
      }
    }
  }

  // Pad to 7 text lines (matching avatar height) for consistent title position
  while (textLines.length < 7) {
    textLines.push("");
  }

  // Use spinning avatar during loading, static when ready or all steps done
  const allStepsDone = state.steps.every((s) => s.status === "done");
  const content = state.ready || allStepsDone
    ? getAgentFaceWithText(textLines, {
      litColor: "\x1b[38;2;252;143;93m", // Veryfront brand orange
    })
    : getSpinningAgentFace(textLines, state.frame, {
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
