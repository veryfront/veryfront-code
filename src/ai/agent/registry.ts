import type { Agent } from "../types/agent.ts";
import { agentLogger } from "../../core/utils/logger/logger.ts";

/**
 * Agent registry for managing agents
 */
export class AgentRegistryClass {
  private agents = new Map<string, Agent>();

  /**
   * Register an agent
   */
  register(id: string, agentInstance: Agent): void {
    if (this.agents.has(id)) {
      agentLogger.warn(`Agent "${id}" is already registered. Overwriting.`);
    }

    this.agents.set(id, agentInstance);
    agentLogger.debug(`Registered agent: ${id}`);
  }

  /**
   * Get an agent by ID
   */
  get(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  /**
   * Check if an agent exists
   */
  has(id: string): boolean {
    return this.agents.has(id);
  }

  /**
   * Get all agent IDs
   */
  getAllIds(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * Get all agents
   */
  getAll(): Map<string, Agent> {
    return new Map(this.agents);
  }

  /**
   * Clear all agents (for testing)
   */
  clear(): void {
    this.agents.clear();
  }
}

// Singleton instance
export const agentRegistry = new AgentRegistryClass();
