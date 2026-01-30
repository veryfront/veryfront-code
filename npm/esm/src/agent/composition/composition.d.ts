/**
 * Agent Composition and Registry
 *
 * Project-scoped registry for agents. Each project has its own isolated
 * agent namespace, preventing cross-project agent access.
 *
 * @module
 */
import type { Agent } from "../types.js";
import type { Tool } from "../../tool/index.js";
export declare function agentAsTool(agent: Agent, description: string): Tool;
export interface WorkflowStep {
    agent: Agent;
    name: string;
    transform?: (output: string) => string | Promise<string>;
    skip?: (context: Record<string, unknown>) => boolean | Promise<boolean>;
}
export interface WorkflowConfig {
    steps: WorkflowStep[];
    initialContext?: Record<string, unknown>;
}
export interface WorkflowResult {
    output: string;
    steps: Array<{
        name: string;
        output: string;
        skipped: boolean;
    }>;
    context: Record<string, unknown>;
}
export declare function createWorkflow(config: WorkflowConfig): {
    execute(input: string): Promise<WorkflowResult>;
};
declare class AgentRegistryClass {
    register(id: string, agent: Agent): void;
    /**
     * Register a framework-provided agent available to all projects.
     */
    registerShared(id: string, agent: Agent): void;
    get(id: string): Agent | undefined;
    has(id: string): boolean;
    getAllIds(): string[];
    getAll(): Map<string, Agent>;
    clear(): void;
    /**
     * Clear everything (for testing).
     */
    clearAll(): void;
    getStats(): {
        projectCount: number;
        sharedCount: number;
        totalItems: number;
        currentProjectItems: number;
    };
}
export declare const agentRegistry: AgentRegistryClass;
export { AgentRegistryClass };
export declare function registerAgent(id: string, agent: Agent): void;
export declare function getAgent(id: string): Agent | undefined;
export declare function getAllAgentIds(): string[];
export declare function getAgentsAsTools(descriptions?: Record<string, string>): Record<string, Tool>;
//# sourceMappingURL=composition.d.ts.map