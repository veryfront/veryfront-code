/**
 * Agent & Tool Inspector
 *
 * Debugging utilities for inspecting agent execution and tool calls.
 *
 * @module veryfront/agent/debug
 */

import type { Agent, Message } from "../types.js";
import { getMCPRegistry, getMCPStats } from "../../mcp/index.js";
import { agentLogger } from "../../utils/logger/logger.js";

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
export async function inspectAgent(
  agent: Agent,
  input: string | Message[],
): Promise<InspectionReport> {
  const startTime = Date.now();

  await agent.getMemoryStats(); // memory stats before execution (intentionally unused)

  const response = await agent.generate({ input });
  const executionTime = Date.now() - startTime;

  const memoryStatsAfter = await agent.getMemoryStats();
  const availableTools = Object.keys(agent.config.tools ?? {});

  return {
    agent: {
      id: agent.id,
      model: agent.config.model,
      maxSteps: agent.config.maxSteps ?? 20,
      memoryType: agent.config.memory?.type ?? "conversation",
    },
    execution: {
      input,
      output: response.text,
      status: response.status,
      steps: response.toolCalls.length + 1,
      executionTime,
    },
    tools: {
      called: response.toolCalls.map((tc) => ({
        name: tc.name,
        args: tc.args,
        result: tc.result,
        executionTime: tc.executionTime,
        status: tc.status,
      })),
      available: availableTools,
    },
    memory: {
      messagesCount: memoryStatsAfter.totalMessages,
      estimatedTokens: memoryStatsAfter.estimatedTokens,
    },
    usage: response.usage,
  };
}

/**
 * Print inspection report
 */
export function printInspectionReport(report: InspectionReport): void {
  agentLogger.info("\n=== Agent Inspection Report ===\n");

  agentLogger.info("Agent:");
  agentLogger.info(`  ID: ${report.agent.id}`);
  agentLogger.info(`  Model: ${report.agent.model}`);
  agentLogger.info(`  Max Steps: ${report.agent.maxSteps}`);
  agentLogger.info(`  Memory: ${report.agent.memoryType}\n`);

  agentLogger.info("Execution:");
  const inputSummary = typeof report.execution.input === "string"
    ? report.execution.input
    : `${report.execution.input.length} messages`;
  agentLogger.info(`  Input: ${inputSummary}`);
  agentLogger.info(`  Output: ${report.execution.output.substring(0, 100)}...`);
  agentLogger.info(`  Status: ${report.execution.status}`);
  agentLogger.info(`  Steps: ${report.execution.steps}`);
  agentLogger.info(`  Time: ${report.execution.executionTime}ms\n`);

  agentLogger.info("Tools:");
  agentLogger.info(
    `  Available: ${report.tools.available.length} (${report.tools.available.join(", ")})`,
  );
  agentLogger.info(`  Called: ${report.tools.called.length}`);

  for (const [i, tool] of report.tools.called.entries()) {
    agentLogger.info(`    ${i + 1}. ${tool.name}(${JSON.stringify(tool.args)})`);
    agentLogger.info(`       Status: ${tool.status}`);
    agentLogger.info(`       Time: ${tool.executionTime}ms`);
    agentLogger.info(`       Result: ${JSON.stringify(tool.result).substring(0, 100)}...`);
  }
  agentLogger.info("");

  agentLogger.info("Memory:");
  agentLogger.info(`  Messages: ${report.memory.messagesCount}`);
  agentLogger.info(`  Estimated Tokens: ${report.memory.estimatedTokens}\n`);

  if (!report.usage) return;

  agentLogger.info("Token Usage:");
  agentLogger.info(`  Prompt: ${report.usage.promptTokens}`);
  agentLogger.info(`  Completion: ${report.usage.completionTokens}`);
  agentLogger.info(`  Total: ${report.usage.totalTokens}\n`);
}

/**
 * Get MCP registry overview
 */
export function getRegistryOverview(): {
  tools: Array<{ id: string; description: string }>;
  resources: Array<{ id: string; pattern: string; description: string }>;
  prompts: Array<{ id: string; description: string }>;
  stats: ReturnType<typeof getMCPStats>;
} {
  const registry = getMCPRegistry();

  return {
    tools: Array.from(registry.tools.values()).map(({ id, description }) => ({
      id,
      description,
    })),
    resources: Array.from(registry.resources.values()).map(
      ({ id, pattern, description }) => ({
        id,
        pattern,
        description,
      }),
    ),
    prompts: Array.from(registry.prompts.values()).map(({ id, description }) => ({
      id,
      description,
    })),
    stats: getMCPStats(),
  };
}

/**
 * Print registry overview
 */
export function printRegistryOverview(): void {
  const overview = getRegistryOverview();

  agentLogger.info("\n=== MCP Registry Overview ===\n");
  agentLogger.info(`Total: ${overview.stats.total} items\n`);

  agentLogger.info(`Tools (${overview.stats.tools}):`);
  for (const t of overview.tools) {
    agentLogger.info(`  • ${t.id}: ${t.description}`);
  }
  agentLogger.info("");

  agentLogger.info(`Resources (${overview.stats.resources}):`);
  for (const r of overview.resources) {
    agentLogger.info(`  • ${r.id} (${r.pattern}): ${r.description}`);
  }
  agentLogger.info("");

  agentLogger.info(`Prompts (${overview.stats.prompts}):`);
  for (const p of overview.prompts) {
    agentLogger.info(`  • ${p.id}: ${p.description}`);
  }
  agentLogger.info("");
}
