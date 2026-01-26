/**
 * Agent & Tool Inspector
 *
 * Debugging utilities for inspecting agent execution and tool calls.
 *
 * @module veryfront/agent/debug
 */
import type { Agent, Message } from "../types.js";
import { getMCPStats } from "../../mcp/index.js";
export interface InspectionReport {
    /** Agent information */
    agent: {
        id: string;
        model: string;
        maxSteps: number;
        memoryType: string;
    };
    /** Execution details */
    execution: {
        input: string | Message[];
        output: string;
        status: string;
        steps: number;
        executionTime: number;
    };
    /** Tool usage */
    tools: {
        called: Array<{
            name: string;
            args: Record<string, unknown>;
            result: unknown;
            executionTime?: number;
            status: string;
        }>;
        available: string[];
    };
    /** Memory usage */
    memory: {
        messagesCount: number;
        estimatedTokens: number;
    };
    /** Token usage */
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}
/**
 * Inspect an agent execution
 *
 * @example
 * ```typescript
 * import { inspectAgent } from 'veryfront/agent/debug';
 *
 * const report = await inspectAgent(myAgent, 'Test input');
 * console.log(report);
 * ```
 */
export declare function inspectAgent(agent: Agent, input: string | Message[]): Promise<InspectionReport>;
/**
 * Print inspection report
 */
export declare function printInspectionReport(report: InspectionReport): void;
/**
 * Get MCP registry overview
 */
export declare function getRegistryOverview(): {
    tools: Array<{
        id: string;
        description: string;
    }>;
    resources: Array<{
        id: string;
        pattern: string;
        description: string;
    }>;
    prompts: Array<{
        id: string;
        description: string;
    }>;
    stats: ReturnType<typeof getMCPStats>;
};
/**
 * Print registry overview
 */
export declare function printRegistryOverview(): void;
//# sourceMappingURL=inspector.d.ts.map