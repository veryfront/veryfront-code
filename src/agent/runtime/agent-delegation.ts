import type { Tool, ToolExecutionContext } from "../../tool/types.ts";
import type { Agent } from "../types.ts";
import { agentAsTool, getAgent } from "../composition/index.ts";
import { type AgentToolInput, getAgentToolInputSchema } from "../schemas/index.ts";
import { AGENT_DELEGATE_TOOL_PREFIX, isProviderSafeDelegateId } from "./agent-delegation-names.ts";
import { markRuntimeLocalTool } from "./local-tool.ts";

export { AGENT_DELEGATE_TOOL_PREFIX, isProviderSafeDelegateId };

/** Resolves a registered agent by id (defaults to the global registry). */
export type DelegateAgentResolver = (id: string) => Agent | undefined;

/** Fixed-target delegate execution used by hosts with their own child-run lifecycle. */
export type DelegateAgentExecutor = (input: {
  delegateId: string;
  agent: Agent;
  toolInput: AgentToolInput;
  context?: ToolExecutionContext;
}) => Promise<unknown>;

/** Input payload for build agent delegate tools. */
export type BuildAgentDelegateToolsInput = {
  /** Specialist agent ids this coordinator is allowed to delegate to. */
  delegates: readonly string[];
  /** Id of the delegating agent, excluded to prevent self-delegation. */
  selfId?: string;
  /** Override the agent resolver (testing / custom registries). */
  resolveAgent?: DelegateAgentResolver;
  /** Override execution while keeping the delegate id fixed by the tool wrapper. */
  executeDelegate?: DelegateAgentExecutor;
};

function createLazyDelegateTool(
  delegateId: string,
  resolveAgent: DelegateAgentResolver,
  executeDelegate?: DelegateAgentExecutor,
): Tool {
  return markRuntimeLocalTool({
    id: `${AGENT_DELEGATE_TOOL_PREFIX}${delegateId}`,
    type: "function",
    description: `Delegate a self-contained subtask to the "${delegateId}" specialist agent, ` +
      `which runs with its own settings and skills. Provide a complete, standalone instruction.`,
    inputSchema: getAgentToolInputSchema(),
    execute(input, context) {
      const target = resolveAgent(delegateId);
      if (!target) {
        return Promise.resolve({
          text: `Delegate agent "${delegateId}" is not available.`,
          toolCalls: 0,
          status: "error",
        });
      }

      if (executeDelegate) {
        return executeDelegate({
          delegateId,
          agent: target,
          toolInput: input,
          context,
        });
      }

      return agentAsTool(target, `Delegate to ${delegateId}`).execute(input, context);
    },
  });
}

/**
 * Builds the opt-in delegate tools for a coordinator agent.
 *
 * Each entry in `delegates` becomes an `agent_{id}` tool that runs the named
 * specialist agent. Agents are resolved lazily at execution time so discovery
 * order does not matter. Self-delegation, duplicates, and ids that would
 * produce a provider-unsafe tool name are skipped defensively here; markdown
 * parsing rejects the latter two cases up front with an explicit diagnostic.
 * Returns an empty map when `delegates` is empty — i.e. an agent with no
 * `delegates` runs with no orchestration.
 *
 * Delegation chains are intentionally not cycle-detected here. Each delegated
 * call is a separate agent run with its own maxSteps budget; hosted nested
 * invocation metadata enforces a runtime depth cap, but authors should still
 * keep delegate graphs acyclic so cycles do not burn the available depth.
 */
export function buildAgentDelegateTools(
  input: BuildAgentDelegateToolsInput,
): Record<string, Tool> {
  const resolveAgent = input.resolveAgent ?? getAgent;
  const tools: Record<string, Tool> = {};
  const seen = new Set<string>();

  for (const delegateId of input.delegates) {
    const id = delegateId.trim();
    if (id.length === 0 || id === input.selfId || seen.has(id)) {
      continue;
    }
    if (!isProviderSafeDelegateId(id)) {
      continue;
    }
    seen.add(id);
    tools[`${AGENT_DELEGATE_TOOL_PREFIX}${id}`] = createLazyDelegateTool(
      id,
      resolveAgent,
      input.executeDelegate,
    );
  }

  return tools;
}
