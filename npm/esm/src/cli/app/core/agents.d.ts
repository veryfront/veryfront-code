import type { AgentSession, CodingAgentDef, CodingAgentState } from "./types.js";
export declare const DEFAULT_AGENTS: CodingAgentDef[];
export interface AgentRegistry {
    agents: CodingAgentDef[];
    byId: Map<string, CodingAgentDef>;
}
export declare function createAgentRegistry(agents?: CodingAgentDef[]): AgentRegistry;
export declare function getAgent(registry: AgentRegistry, id: string): CodingAgentDef | undefined;
export declare function getCLIAgents(registry: AgentRegistry): CodingAgentDef[];
export declare function getIDEAgents(registry: AgentRegistry): CodingAgentDef[];
export declare function isCommandAvailable(command: string): Promise<boolean>;
export declare function detectInstalledAgents(registry: AgentRegistry): Promise<string[]>;
export type AgentStateUpdater = (state: CodingAgentState) => CodingAgentState;
export declare function initAgentState(registry: AgentRegistry, installedAgents?: string[]): CodingAgentState;
export declare function setActiveAgent(agentId: string | null): AgentStateUpdater;
export declare function setActiveModel(model: string | null): AgentStateUpdater;
export declare function addInstalledAgent(agentId: string): AgentStateUpdater;
export declare function openAgentPicker(): AgentStateUpdater;
export declare function closeAgentPicker(): AgentStateUpdater;
export declare function movePickerSelection(delta: number): AgentStateUpdater;
export declare function createSession(agentId: string, projectPath: string, model?: string): AgentSession;
export declare function addSession(session: AgentSession): AgentStateUpdater;
export declare function updateSessionStatus(sessionId: string, status: AgentSession["status"]): AgentStateUpdater;
export declare function removeSession(sessionId: string): AgentStateUpdater;
export declare function getActiveSessions(state: CodingAgentState): AgentSession[];
export declare function buildAgentCommand(agent: CodingAgentDef, projectPath: string, model?: string): {
    command: string;
    args: string[];
};
export declare function isAgentInstalled(state: CodingAgentState, agentId: string): boolean;
export declare function getAgentModels(state: CodingAgentState, agentId: string): string[];
export declare function getAgentDisplayName(state: CodingAgentState): string;
//# sourceMappingURL=agents.d.ts.map