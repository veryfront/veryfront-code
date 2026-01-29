/**
 * Agent Picker Modal Component
 *
 * Modal for selecting and switching between coding agents.
 * Triggered by Ctrl+A or /coding-agent command.
 */

import { box } from "../../../ui/box.ts";
import { brand, dim, muted, success } from "../../../ui/colors.ts";
import { visibleLength } from "../../../ui/layout.ts";
import type { CodingAgentDef, CodingAgentState } from "../../core/types.ts";
import {
  type AgentStateUpdater,
  closeAgentPicker,
  getCLIAgents,
  getIDEAgents,
  isAgentInstalled,
  movePickerSelection,
  openAgentPicker,
  setActiveAgent,
} from "../../core/agents.ts";

// ============================================================================
// State Management
// ============================================================================

export { closeAgentPicker, movePickerSelection, openAgentPicker };

/**
 * Select agent at current index
 */
export function selectCurrentAgent(state: CodingAgentState): AgentStateUpdater {
  const agent = state.agents[state.pickerIndex];
  if (!agent) return (s) => s;
  return setActiveAgent(agent.id);
}

// ============================================================================
// Rendering
// ============================================================================

/**
 * Get status label for agent
 */
function getStatusLabel(installed: boolean): string {
  return installed ? success("[installed ✓]") : dim("[not found]");
}

/**
 * Render agent picker modal
 */
export function renderAgentPicker(state: CodingAgentState, width = 65): string {
  if (!state.pickerOpen) return "";

  const cliAgents = getCLIAgents({ agents: state.agents, byId: new Map() });
  const ideAgents = getIDEAgents({ agents: state.agents, byId: new Map() });

  const lines: string[] = [];

  // CLI agents section
  if (cliAgents.length > 0) {
    lines.push(dim("CLI Agents (embedded in TUI):"));

    for (const agent of cliAgents) {
      const index = state.agents.indexOf(agent);
      const isSelected = index === state.pickerIndex;
      const isInstalled = isAgentInstalled(state, agent.id);
      const isActive = state.activeAgent?.id === agent.id;

      const indicator = isSelected ? brand("›") : " ";
      const name = isSelected ? agent.name : dim(agent.name);
      const provider = dim(agent.provider);
      const status = isActive ? brand("[active]") : getStatusLabel(isInstalled);

      const line = `${indicator} ${name.padEnd(20)}${provider.padEnd(20)}${status}`;
      lines.push(line);
    }
  }

  // IDE agents section
  if (ideAgents.length > 0) {
    lines.push("");
    lines.push(dim("IDE Agents (opens external):"));

    for (const agent of ideAgents) {
      const index = state.agents.indexOf(agent);
      const isSelected = index === state.pickerIndex;
      const isInstalled = isAgentInstalled(state, agent.id);

      const indicator = isSelected ? brand("›") : " ";
      const name = isSelected ? agent.name : dim(agent.name);
      const provider = dim(agent.provider);
      const status = getStatusLabel(isInstalled);

      const line = `${indicator} ${name.padEnd(20)}${provider.padEnd(20)}${status}`;
      lines.push(line);
    }
  }

  lines.push("");

  // Custom agent option
  lines.push(dim("+ Add custom agent"));

  lines.push("");
  lines.push(muted("↑↓ select  Enter launch  Esc cancel  + add custom"));

  const content = lines.join("\n");

  return box(content, {
    title: "Launch Coding Agent",
    titleAlign: "left",
    style: "rounded",
    width,
    padding: 1,
  });
}

/**
 * Render agent picker centered
 */
export function renderAgentPickerCentered(
  state: CodingAgentState,
  termWidth: number,
  termHeight: number,
): string {
  if (!state.pickerOpen) return "";

  const pickerWidth = Math.min(65, termWidth - 4);
  const content = renderAgentPicker(state, pickerWidth);
  const contentLines = content.split("\n");
  const contentHeight = contentLines.length;
  const contentWidth = Math.max(...contentLines.map(visibleLength));

  const topPadding = Math.max(0, Math.floor((termHeight - contentHeight) / 2));
  const leftPadding = Math.max(0, Math.floor((termWidth - contentWidth) / 2));

  const output: string[] = [];

  for (let i = 0; i < topPadding; i++) {
    output.push("");
  }

  const padStr = " ".repeat(leftPadding);
  for (const line of contentLines) {
    output.push(padStr + line);
  }

  return output.join("\n");
}

// ============================================================================
// Key Handling
// ============================================================================

/** Result from handling key */
export interface AgentPickerKeyResult {
  handled: boolean;
  close: boolean;
  launchAgent?: CodingAgentDef;
  updater?: AgentStateUpdater;
}

/**
 * Handle key press in agent picker
 */
export function handleAgentPickerKey(
  key: string,
  state: CodingAgentState,
): AgentPickerKeyResult {
  if (!state.pickerOpen) {
    return { handled: false, close: false };
  }

  // Escape - close
  if (key === "\x1b") {
    return { handled: true, close: true, updater: closeAgentPicker() };
  }

  // Enter - launch selected
  if (key === "\r" || key === "\n") {
    const agent = state.agents[state.pickerIndex];
    if (agent) {
      // Compose: close picker + set active agent
      const updater: AgentStateUpdater = (s) => setActiveAgent(agent.id)(closeAgentPicker()(s));

      return {
        handled: true,
        close: true,
        launchAgent: agent,
        updater,
      };
    }
    return { handled: true, close: false };
  }

  // Up arrow or k
  if (key === "\x1b[A" || key === "k") {
    return { handled: true, close: false, updater: movePickerSelection(-1) };
  }

  // Down arrow or j
  if (key === "\x1b[B" || key === "j") {
    return { handled: true, close: false, updater: movePickerSelection(1) };
  }

  // Number keys for quick select (1-9)
  if (/^[1-9]$/.test(key)) {
    const index = parseInt(key, 10) - 1;
    if (index < state.agents.length) {
      const agent = state.agents[index];
      if (agent) {
        const updater: AgentStateUpdater = (s) => setActiveAgent(agent.id)(closeAgentPicker()(s));

        return {
          handled: true,
          close: true,
          launchAgent: agent,
          updater,
        };
      }
    }
  }

  return { handled: true, close: false }; // Consume key
}
