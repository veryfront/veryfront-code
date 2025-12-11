
import type { Agent, Message } from "../../types/agent.ts";
import { getMCPRegistry, getMCPStats } from "../../mcp/registry.ts";
import { agentLogger } from "@veryfront/utils/logger/logger.ts";

export interface InspectionReport {
  agent: {
    id: string;
    model: string;
    maxSteps: number;
    memoryType: string;
  };

  execution: {
    input: string | Message[];
    output: string;
    status: string;
    steps: number;
    executionTime: number;
  };

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

  memory: {
    messagesCount: number;
    estimatedTokens: number;
  };

  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export async function inspectAgent(
  agent: Agent,
  input: string | Message[],
): Promise<InspectionReport> {
  const startTime = Date.now();

  const _memoryStatsBefore = await agent.getMemoryStats();

  const response = await agent.generate({ input });

  const executionTime = Date.now() - startTime;

  const memoryStatsAfter = await agent.getMemoryStats();

  const availableTools = agent.config.tools ? Object.keys(agent.config.tools) : [];

  return {
    agent: {
      id: agent.id,
      model: agent.config.model,
      maxSteps: agent.config.maxSteps || 20,
      memoryType: agent.config.memory?.type || "conversation",
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

export function printInspectionReport(report: InspectionReport): void {
  agentLogger.info("\n=== Agent Inspection Report ===\n");

  agentLogger.info("Agent:");
  agentLogger.info(`  ID: ${report.agent.id}`);
  agentLogger.info(`  Model: ${report.agent.model}`);
  agentLogger.info(`  Max Steps: ${report.agent.maxSteps}`);
  agentLogger.info(`  Memory: ${report.agent.memoryType}\n`);

  agentLogger.info("Execution:");
  agentLogger.info(
    `  Input: ${
      typeof report.execution.input === "string"
        ? report.execution.input
        : `${(report.execution.input as Message[]).length} messages`
    }`,
  );
  agentLogger.info(`  Output: ${report.execution.output.substring(0, 100)}...`);
  agentLogger.info(`  Status: ${report.execution.status}`);
  agentLogger.info(`  Steps: ${report.execution.steps}`);
  agentLogger.info(`  Time: ${report.execution.executionTime}ms\n`);

  agentLogger.info("Tools:");
  agentLogger.info(
    `  Available: ${report.tools.available.length} (${report.tools.available.join(", ")})`,
  );
  agentLogger.info(`  Called: ${report.tools.called.length}`);

  if (report.tools.called.length > 0) {
    report.tools.called.forEach((tool, i) => {
      agentLogger.info(`    ${i + 1}. ${tool.name}(${JSON.stringify(tool.args)})`);
      agentLogger.info(`       Status: ${tool.status}`);
      agentLogger.info(`       Time: ${tool.executionTime}ms`);
      agentLogger.info(`       Result: ${JSON.stringify(tool.result).substring(0, 100)}...`);
    });
  }
  agentLogger.info("");

  agentLogger.info("Memory:");
  agentLogger.info(`  Messages: ${report.memory.messagesCount}`);
  agentLogger.info(`  Estimated Tokens: ${report.memory.estimatedTokens}\n`);

  if (report.usage) {
    agentLogger.info("Token Usage:");
    agentLogger.info(`  Prompt: ${report.usage.promptTokens}`);
    agentLogger.info(`  Completion: ${report.usage.completionTokens}`);
    agentLogger.info(`  Total: ${report.usage.totalTokens}\n`);
  }
}

export function getRegistryOverview(): {
  tools: Array<{ id: string; description: string }>;
  resources: Array<{ id: string; pattern: string; description: string }>;
  prompts: Array<{ id: string; description: string }>;
  stats: ReturnType<typeof getMCPStats>;
} {
  const registry = getMCPRegistry();
  const stats = getMCPStats();

  return {
    tools: Array.from(registry.tools.values()).map((t) => ({
      id: t.id,
      description: t.description,
    })),
    resources: Array.from(registry.resources.values()).map((r) => ({
      id: r.id,
      pattern: r.pattern,
      description: r.description,
    })),
    prompts: Array.from(registry.prompts.values()).map((p) => ({
      id: p.id,
      description: p.description,
    })),
    stats,
  };
}

export function printRegistryOverview(): void {
  const overview = getRegistryOverview();

  agentLogger.info("\n=== MCP Registry Overview ===\n");
  agentLogger.info(`Total: ${overview.stats.total} items\n`);

  agentLogger.info(`Tools (${overview.stats.tools}):`);
  overview.tools.forEach((t) => {
    agentLogger.info(`  • ${t.id}: ${t.description}`);
  });
  agentLogger.info("");

  agentLogger.info(`Resources (${overview.stats.resources}):`);
  overview.resources.forEach((r) => {
    agentLogger.info(`  • ${r.id} (${r.pattern}): ${r.description}`);
  });
  agentLogger.info("");

  agentLogger.info(`Prompts (${overview.stats.prompts}):`);
  overview.prompts.forEach((p) => {
    agentLogger.info(`  • ${p.id}: ${p.description}`);
  });
  agentLogger.info("");
}
