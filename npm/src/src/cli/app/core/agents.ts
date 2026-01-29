// Coding Agent Connector Module
// Manages agent definitions, detection, and configuration for Claude Code, Codex, Aider, Gemini CLI
import * as dntShim from "../../../../_dnt.shims.js";


import type { AgentSession, CodingAgentDef, CodingAgentState } from "./types.js";
import { createCodingAgentState } from "./types.js";

// ============================================================================
// Default Agent Definitions
// ============================================================================

export const DEFAULT_AGENTS: CodingAgentDef[] = [
  {
    id: "claude",
    name: "Claude Code",
    command: "claude",
    provider: "Anthropic",
    type: "cli",
    models: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-3.5-sonnet"],
    defaultModel: "claude-sonnet-4-20250514",
  },
  {
    id: "codex",
    name: "Codex",
    command: "codex",
    provider: "OpenAI",
    type: "cli",
    models: ["gpt-5", "o3-mini", "gpt-4.1"],
    defaultModel: "o3-mini",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    command: "gemini",
    provider: "Google",
    type: "cli",
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    defaultModel: "gemini-2.5-pro",
  },
  {
    id: "aider",
    name: "Aider",
    command: "aider",
    provider: "Open Source",
    type: "cli",
    models: ["claude-3.5-sonnet", "gpt-4", "deepseek"],
    defaultModel: "claude-3.5-sonnet",
  },
  {
    id: "continue",
    name: "Continue",
    command: "continue",
    provider: "Open Source",
    type: "cli",
  },
  {
    id: "cursor",
    name: "Cursor",
    command: "cursor .",
    provider: "Cursor",
    type: "ide",
  },
  {
    id: "windsurf",
    name: "Windsurf",
    command: "windsurf .",
    provider: "Codeium",
    type: "ide",
  },
  {
    id: "vscode",
    name: "VS Code",
    command: "code .",
    provider: "Microsoft",
    type: "ide",
  },
];

// ============================================================================
// Agent Registry
// ============================================================================

export interface AgentRegistry {
  agents: CodingAgentDef[];
  byId: Map<string, CodingAgentDef>;
}

export function createAgentRegistry(agents: CodingAgentDef[] = DEFAULT_AGENTS): AgentRegistry {
  const byId = new Map<string, CodingAgentDef>();
  for (const agent of agents) {
    byId.set(agent.id, agent);
  }
  return { agents, byId };
}

export function getAgent(registry: AgentRegistry, id: string): CodingAgentDef | undefined {
  return registry.byId.get(id);
}

export function getCLIAgents(registry: AgentRegistry): CodingAgentDef[] {
  return registry.agents.filter((a) => a.type === "cli");
}

export function getIDEAgents(registry: AgentRegistry): CodingAgentDef[] {
  return registry.agents.filter((a) => a.type === "ide");
}

// ============================================================================
// Agent Detection
// ============================================================================

export async function isCommandAvailable(command: string): Promise<boolean> {
  // Get just the command name (first word)
  const cmdName = command.split(" ")[0];
  if (!cmdName) return false;

  try {
    const isWindows = dntShim.Deno.build.os === "windows";
    const checkCmd = isWindows ? "where" : "which";

    const process = new dntShim.Deno.Command(checkCmd, {
      args: [cmdName],
      stdout: "null",
      stderr: "null",
    });

    const { success } = await process.output();
    return success;
  } catch {
    return false;
  }
}

export async function detectInstalledAgents(
  registry: AgentRegistry,
): Promise<string[]> {
  const installed: string[] = [];

  const checks = registry.agents.map(async (agent) => {
    const available = await isCommandAvailable(agent.command);
    if (available) {
      installed.push(agent.id);
    }
  });

  await Promise.all(checks);
  return installed;
}

// ============================================================================
// State Management
// ============================================================================

export type AgentStateUpdater = (state: CodingAgentState) => CodingAgentState;

export function initAgentState(
  registry: AgentRegistry,
  installedAgents: string[] = [],
): CodingAgentState {
  return {
    ...createCodingAgentState(),
    agents: registry.agents,
    installedAgents,
  };
}

export function setActiveAgent(agentId: string | null): AgentStateUpdater {
  return (state) => {
    if (!agentId) {
      return { ...state, activeAgent: null, activeModel: null };
    }

    const agent = state.agents.find((a) => a.id === agentId);
    if (!agent) return state;

    return {
      ...state,
      activeAgent: agent,
      activeModel: agent.defaultModel ?? null,
    };
  };
}

export function setActiveModel(model: string | null): AgentStateUpdater {
  return (state) => ({
    ...state,
    activeModel: model,
  });
}

export function addInstalledAgent(agentId: string): AgentStateUpdater {
  return (state) => ({
    ...state,
    installedAgents: state.installedAgents.includes(agentId)
      ? state.installedAgents
      : [...state.installedAgents, agentId],
  });
}

export function openAgentPicker(): AgentStateUpdater {
  return (state) => ({
    ...state,
    pickerOpen: true,
    pickerIndex: 0,
  });
}

export function closeAgentPicker(): AgentStateUpdater {
  return (state) => ({
    ...state,
    pickerOpen: false,
  });
}

export function movePickerSelection(delta: number): AgentStateUpdater {
  return (state) => {
    const maxIndex = state.agents.length - 1;
    let newIndex = state.pickerIndex + delta;
    if (newIndex < 0) newIndex = maxIndex;
    if (newIndex > maxIndex) newIndex = 0;
    return { ...state, pickerIndex: newIndex };
  };
}

// ============================================================================
// Session Management
// ============================================================================

let sessionCounter = 0;

export function createSession(
  agentId: string,
  projectPath: string,
  model?: string,
): AgentSession {
  return {
    id: `session-${++sessionCounter}`,
    agentId,
    model,
    status: "starting",
    projectPath,
    startedAt: Date.now(),
  };
}

export function addSession(session: AgentSession): AgentStateUpdater {
  return (state) => ({
    ...state,
    sessions: [...state.sessions, session],
  });
}

export function updateSessionStatus(
  sessionId: string,
  status: AgentSession["status"],
): AgentStateUpdater {
  return (state) => ({
    ...state,
    sessions: state.sessions.map((s) => s.id === sessionId ? { ...s, status } : s),
  });
}

export function removeSession(sessionId: string): AgentStateUpdater {
  return (state) => ({
    ...state,
    sessions: state.sessions.filter((s) => s.id !== sessionId),
  });
}

export function getActiveSessions(state: CodingAgentState): AgentSession[] {
  return state.sessions.filter((s) => s.status !== "stopped");
}

// ============================================================================
// Agent Commands
// ============================================================================

export function buildAgentCommand(
  agent: CodingAgentDef,
  projectPath: string,
  model?: string,
): { command: string; args: string[] } {
  const parts = agent.command.split(" ");
  const command = parts[0]!;
  const args = parts.slice(1);

  // Replace '.' with project path
  const resolvedArgs = args.map((arg) => (arg === "." ? projectPath : arg));

  // Add model flag if supported and specified
  // Most CLI agents use --model flag
  if (model && agent.models?.includes(model)) {
    if (agent.id === "claude" || agent.id === "aider" || agent.id === "codex") {
      resolvedArgs.push("--model", model);
    }
  }

  return { command, args: resolvedArgs };
}

// ============================================================================
// Query Functions
// ============================================================================

export function isAgentInstalled(state: CodingAgentState, agentId: string): boolean {
  return state.installedAgents.includes(agentId);
}

export function getAgentModels(state: CodingAgentState, agentId: string): string[] {
  const agent = state.agents.find((a) => a.id === agentId);
  return agent?.models ?? [];
}

export function getAgentDisplayName(state: CodingAgentState): string {
  if (!state.activeAgent) return "None";

  let name = state.activeAgent.name;
  if (state.activeModel) {
    name += ` (${state.activeModel})`;
  }
  return name;
}
