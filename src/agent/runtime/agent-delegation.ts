import type { Tool, ToolExecutionContext } from "../../tool/types.ts";
import type { Agent } from "../types.ts";
import { agentAsTool, getAgent } from "../composition/index.ts";
import { type AgentToolInput, getAgentToolInputSchema } from "../schemas/index.ts";
import { AGENT_DELEGATE_TOOL_PREFIX, isProviderSafeDelegateId } from "./agent-delegation-names.ts";
import { markRuntimeLocalTool } from "./local-tool.ts";
import { defineSchema, getJsonValueSchema } from "#veryfront/schemas/index.ts";

export { AGENT_DELEGATE_TOOL_PREFIX, isProviderSafeDelegateId };

/** Tool id used by hosted/project runtimes for dynamic agent delegation. */
export const RUNTIME_INVOKE_AGENT_TOOL_ID = "invoke_agent";

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

/** Input payload for bind runtime invoke agent tool. */
export type BindRuntimeInvokeAgentToolInput = {
  agentId: string;
  tools: Agent["config"]["tools"];
  delegates: readonly string[];
  resolveAgent?: DelegateAgentResolver;
};

type RuntimeInvokeAgentInput = {
  agent_id: string;
  description?: string;
  prompt: string;
  context?: Record<string, unknown>;
  allow_delegation?: boolean;
};

const getRuntimeInvokeAgentInputSchema = defineSchema((v) =>
  v.object({
    agent_id: v.string().min(1, "agent_id is required").regex(/\S/, "agent_id must not be blank")
      .describe("Specialist agent id to run."),
    description: v.string().optional().describe("3-5 word task summary."),
    prompt: v.string().describe("Detailed instructions for the specialist agent."),
    context: v.record(v.string(), getJsonValueSchema()).default({}).describe(
      "Structured data payload for the specialist task.",
    ),
    allow_delegation: v.boolean().optional().describe(
      "Must be false or omitted. Project specialists cannot delegate further.",
    ),
  })
);

function createRuntimeInvokeAgentTool(input: {
  delegates: readonly string[];
  selfId: string;
  resolveAgent: DelegateAgentResolver;
}): Tool {
  const allowedDelegates = new Set(input.delegates);
  return markRuntimeLocalTool({
    id: RUNTIME_INVOKE_AGENT_TOOL_ID,
    type: "function",
    description: "Delegate a bounded task to one configured specialist agent by agent_id.",
    inputSchema: getRuntimeInvokeAgentInputSchema(),
    async execute(toolInput: RuntimeInvokeAgentInput, context) {
      const delegateId = toolInput.agent_id.trim();
      if (!allowedDelegates.has(delegateId) || delegateId === input.selfId) {
        return {
          text: `Delegate agent "${delegateId}" is not available to this agent.`,
          toolCalls: 0,
          status: "error",
        };
      }

      if (toolInput.allow_delegation === true) {
        return {
          text: "Nested delegation is not available for project specialist agents.",
          toolCalls: 0,
          status: "error",
        };
      }

      const target = input.resolveAgent(delegateId);
      if (!target) {
        return {
          text: `Delegate agent "${delegateId}" is not available.`,
          toolCalls: 0,
          status: "error",
        };
      }

      const response = await target.generate({
        input: toolInput.prompt,
        context: {
          ...(toolInput.context ?? {}),
          parentAgentId: input.selfId,
          delegateDescription: toolInput.description,
        },
        abortSignal: context?.abortSignal,
      });
      return {
        text: response.text,
        status: response.status,
        toolCalls: response.toolCalls.length,
        messages: response.messages,
      };
    },
  }, { exportName: RUNTIME_INVOKE_AGENT_TOOL_ID });
}

/** Replace a hosted-style invoke_agent declaration with a runtime-local tool. */
export function bindRuntimeInvokeAgentTool(
  input: BindRuntimeInvokeAgentToolInput,
): Agent["config"]["tools"] {
  if (
    input.tools === true || !input.tools ||
    input.tools[RUNTIME_INVOKE_AGENT_TOOL_ID] !== true
  ) {
    return input.tools;
  }
  if (input.delegates.length === 0) {
    return input.tools;
  }

  return {
    ...input.tools,
    [RUNTIME_INVOKE_AGENT_TOOL_ID]: createRuntimeInvokeAgentTool({
      delegates: input.delegates,
      selfId: input.agentId,
      resolveAgent: input.resolveAgent ?? getAgent,
    }),
  };
}

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
 * call is a separate agent run with its own maxSteps budget; keep delegate
 * graphs acyclic until a runtime chain-depth cap exists.
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
