/**************************
 * Startup View
 *
 * Shows compact loading progress before the main TUI is ready.
 **************************/

import { brand, dim } from "../../ui/colors.ts";
import { getSpinnerFrame } from "../../ui/ansi.ts";

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

export function renderStartup(state: StartupState): string {
  const lines: string[] = [];

  if (state.ready) {
    lines.push(
      state.serverUrl ? `  ✓ Server ready at ${brand(state.serverUrl)}` : "  ✓ Server ready",
    );
    if (state.mcpUrl) lines.push(`  ✓ MCP ready at ${brand(state.mcpUrl)}`);
    return lines.join("\n");
  }

  for (const step of state.steps) {
    if (step.status === "done") lines.push(`  ✓ ${dim(step.label)}`);
    else if (step.status === "active") {
      lines.push(`  ${brand(getSpinnerFrame(state.frame))} ${step.label}`);
    } else lines.push(`  ${dim("○")} ${dim(step.label)}`);
  }

  return lines.join("\n");
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

export function incrementFrame(state: StartupState): StartupState {
  return { ...state, frame: state.frame + 1 };
}

/**
 * Set a step to active
 */
export function setStepActive(state: StartupState, index: number): StartupState {
  const steps = state.steps.map((step, i): StartupStep => ({
    ...step,
    status: i < index ? "done" : i === index ? "active" : "pending",
  }));

  return { ...state, steps };
}
