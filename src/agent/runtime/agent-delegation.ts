import type { Tool, ToolExecutionContext } from "../../tool/types.ts";
import type { Agent } from "../types.ts";
import { agentAsTool, getAgent } from "../composition/index.ts";
import { type AgentToolInput, getAgentToolInputSchema } from "../schemas/index.ts";
import { AGENT_DELEGATE_TOOL_PREFIX, isProviderSafeDelegateId } from "./agent-delegation-names.ts";
import { markRuntimeLocalTool, markSkillDelegationOverridesUnsupported } from "./local-tool.ts";
import { defineSchema, getJsonValueSchema } from "#veryfront/schemas/index.ts";

export { AGENT_DELEGATE_TOOL_PREFIX, isProviderSafeDelegateId };

export const INVOKE_AGENT_TOOL_ID = "invoke_agent";

const getInvokeAgentInputSchema = defineSchema((v) =>
  v.object({
    agent_id: v.string()
      .min(1, "agent_id is required")
      .regex(/\S/, "agent_id must not be blank")
      .describe("Built-in child agent type or user-defined agent id."),
    description: v.string().describe("3-5 word task summary"),
    prompt: v.string().describe("Detailed instructions for the task"),
    context: v.record(v.string(), getJsonValueSchema()).default({}).describe(
      "Structured data payload containing facts, records, ids, decisions, and values the child must act on.",
    ),
  })
);

/** Resolves a registered agent by id (defaults to the global registry). */
export type DelegateAgentResolver = (id: string) => Agent | undefined;

/** Fixed-target delegate execution used by hosts with their own child-run lifecycle. */
export type DelegateAgentExecutor = (input: {
  delegateId: string;
  agent: Agent;
  toolInput: AgentToolInput;
  context?: ToolExecutionContext;
}) => Promise<unknown>;

/** Input payload for creating the generic local invoke_agent platform tool. */
export type CreateInvokeAgentToolInput = {
  /** Id of the invoking agent, excluded to prevent self-invocation. */
  selfId?: string;
  /** Override the project-scoped agent resolver (testing / custom registries). */
  resolveAgent?: DelegateAgentResolver;
};

function buildInvokeAgentPrompt(
  prompt: string,
  context: Record<string, unknown> | undefined,
): string {
  if (!context) return prompt;
  if (Object.keys(context).length === 0) return prompt;
  return `${prompt}\n\n<structured_context>\n${JSON.stringify(context)}\n</structured_context>`;
}

/**
 * Create the generic invoke_agent platform tool for direct runtimes.
 *
 * Targets resolve lazily from the active project registry so agent discovery
 * order and HMR updates do not freeze the available child definitions.
 */
export function createInvokeAgentTool(input: CreateInvokeAgentToolInput = {}): Tool {
  const resolveAgent = input.resolveAgent ?? getAgent;
  return markSkillDelegationOverridesUnsupported(markRuntimeLocalTool({
    id: INVOKE_AGENT_TOOL_ID,
    type: "function",
    description:
      "Invoke a registered project agent for a self-contained task. Select the target with agent_id and provide complete standalone instructions.",
    inputSchema: getInvokeAgentInputSchema(),
    execute(toolInput, context) {
      const agentId = toolInput.agent_id.trim();
      if (agentId === input.selfId) {
        return Promise.resolve({
          text: `Agent "${agentId}" cannot invoke itself.`,
          toolCalls: 0,
          status: "error",
        });
      }

      const target = resolveAgent(agentId);
      if (!target) {
        return Promise.resolve({
          text: `Agent "${agentId}" is not available.`,
          toolCalls: 0,
          status: "error",
        });
      }

      return agentAsTool(target, toolInput.description).execute({
        input: buildInvokeAgentPrompt(toolInput.prompt, toolInput.context),
      }, context);
    },
  }));
}

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
 * invocation metadata enforces a runtime depth cap. Stateful input validation
 * rejects re-entry into an ancestor runtime with an active memory transaction
 * before waiting on its queue. Keep your delegate graph acyclic.
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
