import type { Tool } from "../../tool/types.ts";
import type { Agent } from "../types.ts";
import { agentAsTool, getAgent } from "../composition/index.ts";
import { getAgentToolInputSchema } from "../schemas/index.ts";
import { AGENT_DELEGATE_TOOL_PREFIX, isProviderSafeDelegateId } from "./agent-delegation-names.ts";

export { AGENT_DELEGATE_TOOL_PREFIX, isProviderSafeDelegateId };

/** Resolves a registered agent by id (defaults to the global registry). */
export type DelegateAgentResolver = (id: string) => Agent | undefined;

/** Input payload for build agent delegate tools. */
export type BuildAgentDelegateToolsInput = {
  /** Specialist agent ids this coordinator is allowed to delegate to. */
  delegates: readonly string[];
  /** Id of the delegating agent, excluded to prevent self-delegation. */
  selfId?: string;
  /** Override the agent resolver (testing / custom registries). */
  resolveAgent?: DelegateAgentResolver;
};

function createLazyDelegateTool(
  delegateId: string,
  resolveAgent: DelegateAgentResolver,
): Tool {
  return {
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

      return agentAsTool(target, `Delegate to ${delegateId}`).execute(input, context);
    },
  };
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
    tools[`${AGENT_DELEGATE_TOOL_PREFIX}${id}`] = createLazyDelegateTool(id, resolveAgent);
  }

  return tools;
}
