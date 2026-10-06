/**
 * Agent Composition and Registry
 *
 * Project-scoped registry for agents. Each project has its own isolated
 * agent namespace, preventing cross-project agent access.
 *
 * @module
 */

import { executeLocalChild, type LocalChildInvocation } from "./local-child-execution.ts";
import type { Agent, AgentResponse } from "../types.ts";
import { getAgentExecutionConfig } from "../runtime/execution-config.ts";
import {
  getPrivateApplicationInferenceRuntimeOptions,
  shouldUseApplicationInferenceRuntime,
} from "../runtime/application-inference-admission.ts";
import { defineOwnDataProperty } from "#veryfront/security/own-data-property.ts";
import type { Tool, ToolExecutionContext } from "#veryfront/tool";
import { AGENT_ERROR } from "#veryfront/errors";
import { setActiveSpanAttributes } from "#veryfront/observability/tracing/otlp-setup.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { ScopedRegistryFacade } from "#veryfront/registry/scoped-registry-facade.ts";
import { ProjectScopedRegistryManager } from "#veryfront/registry/project-scoped-registry-manager.ts";
import { getAgentToolInputSchema } from "../schemas/index.ts";
import { getRuntimeSourceIntegrationPolicyFromContext } from "../runtime/runtime-tool-config.ts";
import { runWithExactSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import type { SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import { streamDataStreamEvents } from "../streaming/data-stream.ts";
import {
  buildInvokeAgentStreamDataEvent,
  type InvokeAgentStreamIdentity,
} from "#veryfront/chat/invoke-agent-stream.ts";

const DELEGATED_STREAM_CONTEXT_EXCLUSIONS = new Set([
  "abortSignal",
  "agentId",
  "progressToken",
  "runId",
  "runIdBindsToolAuthorization",
  "toolCallId",
]);

function buildAdmittedChildStreamContext(
  context: ToolExecutionContext | undefined,
  runId: string,
): Record<string, unknown> {
  const streamContext: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context ?? {})) {
    if (!DELEGATED_STREAM_CONTEXT_EXCLUSIONS.has(key)) streamContext[key] = value;
  }
  streamContext.runId = runId;
  streamContext.runIdBindsToolAuthorization = true;
  return streamContext;
}

/** Agent as tool helper. */
async function runAgentAsStreamingTool(
  agent: Agent,
  input: string,
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest | undefined,
  context?: ToolExecutionContext,
  publishChildStream = false,
  control?: Parameters<LocalChildInvocation["execute"]>[0],
): Promise<AgentResponse> {
  // Resolved once: the identity rides along with every published event, so
  // recomputing it per chunk would repeat the work on the stream's hot path.
  const childIdentity: InvokeAgentStreamIdentity = {
    ...(agent.config.name ? { agentName: agent.config.name } : {}),
    ...(agent.config.avatarUrl ?? agent.config.avatar_url
      ? { avatarUrl: agent.config.avatarUrl ?? agent.config.avatar_url }
      : {}),
  };
  const execute = async (): Promise<AgentResponse> => {
    let finalResponse: AgentResponse | undefined;
    const signal = control?.signal ?? context?.abortSignal;
    const useApplicationRuntime = shouldUseApplicationInferenceRuntime(
      getAgentExecutionConfig(agent.config).model,
    );
    // The factory also imports the registry. Defer loading it until invocation
    // so composition does not create an eager module-initialization cycle.
    const createAdmittedAgent = useApplicationRuntime
      ? (await import("../factory.ts")).createEphemeralAgentWithRuntimeOptions
      : undefined;
    const privateRuntime = useApplicationRuntime
      ? await getPrivateApplicationInferenceRuntimeOptions(agent.id, signal)
      : undefined;
    try {
      const streamAgent = privateRuntime && createAdmittedAgent
        ? await privateRuntime.prepareAgent(() => {
          const admittedAgent = createAdmittedAgent(
            { ...getAgentExecutionConfig(agent.config), id: agent.id },
            privateRuntime.runtimeOptions,
          );
          defineOwnDataProperty(admittedAgent, "then", undefined);
          return admittedAgent;
        })
        : agent;
      const streamContext = privateRuntime
        ? buildAdmittedChildStreamContext(context, privateRuntime.runId)
        : undefined;
      const stream = await streamAgent.stream({
        input,
        ...(streamContext ? { context: streamContext } : {}),
        abortSignal: privateRuntime?.signal ?? signal,
        onFinish: (response) => {
          finalResponse = response;
        },
      });
      let streamError: string | undefined;
      const response = stream.toDataStreamResponse();
      if (response.body) {
        for await (const event of streamDataStreamEvents(response.body)) {
          await control?.onEvent?.(event);
          if (publishChildStream && context?.toolCallId && context.publishDataEvent) {
            await context.publishDataEvent(buildInvokeAgentStreamDataEvent({
              toolCallId: context.toolCallId,
              agentId: agent.id,
              ...childIdentity,
              event,
            }));
          }
          if (event.type === "error") {
            streamError = typeof event.errorText === "string"
              ? event.errorText
              : typeof event.error === "string"
              ? event.error
              : "Child agent stream failed";
          }
        }
      }

      if (!finalResponse) {
        throw AGENT_ERROR.create({
          detail: streamError ?? `Agent "${agent.id}" stream completed without a final response.`,
        });
      }
      privateRuntime?.finish(
        streamError || finalResponse.status === "error" ? "failed" : "completed",
      );
      return finalResponse;
    } catch (error) {
      privateRuntime?.onAbandon();
      throw error;
    }
  };

  return sourceIntegrationPolicy
    ? runWithExactSourceIntegrationPolicy(sourceIntegrationPolicy, execute)
    : execute();
}

const objectHasOwn = Object.hasOwn;

export function agentAsTool(
  agent: Agent,
  description: string,
  options: { publishChildStream?: boolean; toolName?: string; toolInput?: unknown } = {},
): Tool {
  return {
    id: `agent_${agent.id}`,
    type: "function",
    description,
    inputSchema: getAgentToolInputSchema(),
    execute({ input }, context) {
      return withSpan(
        "agent.composition.agentAsTool.execute",
        () =>
          executeLocalChild({
            agentId: agent.id,
            input,
            context,
            toolName: options.toolName ?? `agent_${agent.id}`,
            toolInput: options.toolInput ?? { input },
            execute: async (control) => {
              const response = await runAgentAsStreamingTool(
                agent,
                input,
                getRuntimeSourceIntegrationPolicyFromContext(context),
                context,
                options.publishChildStream,
                control,
              );

              setActiveSpanAttributes({
                "agent.tool_calls": response.toolCalls.length,
                "agent.status": response.status,
              });

              // The child's accepted value: its parsed object when it declares an
              // outputSchema and parsing succeeded, next to the text. Any own `object`
              // (including null or a transform's undefined) is passed through; an
              // inherited `object` is never forwarded.
              return {
                text: response.text,
                ...(objectHasOwn(response, "object") ? { object: response.object } : {}),
                toolCalls: response.toolCalls.length,
                status: response.status,
              };
            },
          }),
        { "agent.id": agent.id },
      );
    },
  };
}

/** Public API contract for workflow step. */
export interface WorkflowStep {
  agent: Agent;
  name: string;
  transform?: (output: string) => string | Promise<string>;
  skip?: (context: Record<string, unknown>) => boolean | Promise<boolean>;
}

/** Configuration used by workflow. */
export interface WorkflowConfig {
  steps: WorkflowStep[];
  initialContext?: Record<string, unknown>;
}

/** Result returned from workflow. */
export interface WorkflowResult {
  output: string;
  steps: Array<{
    name: string;
    output: string;
    skipped: boolean;
  }>;
  context: Record<string, unknown>;
}

/** Create workflow. */
export function createWorkflow(
  config: WorkflowConfig,
): { execute(input: string): Promise<WorkflowResult> } {
  return {
    execute(input: string): Promise<WorkflowResult> {
      return withSpan(
        "agent.composition.workflow.execute",
        async () => {
          const result: WorkflowResult = {
            output: input,
            steps: [],
            context: { ...config.initialContext },
          };

          for (const step of config.steps) {
            await withSpan(
              `agent.composition.workflow.step.${step.name}`,
              async () => {
                const shouldSkip = await step.skip?.(result.context);
                if (shouldSkip) {
                  result.steps.push({ name: step.name, output: "", skipped: true });
                  setActiveSpanAttributes({ "workflow.step.skipped": true });
                  return;
                }

                const response = await step.agent.generate({
                  input: result.output,
                  context: result.context,
                });

                const output = step.transform ? await step.transform(response.text) : response.text;

                result.output = output;
                result.steps.push({ name: step.name, output, skipped: false });
                result.context[step.name] = output;

                setActiveSpanAttributes({
                  "workflow.step.skipped": false,
                  "workflow.step.output_length": output.length,
                });
              },
              { "workflow.step.name": step.name, "workflow.step.agent_id": step.agent.id },
            );
          }

          setActiveSpanAttributes({
            "workflow.total_steps": config.steps.length,
            "workflow.executed_steps": result.steps.filter((s) => !s.skipped).length,
          });

          return result;
        },
        { "workflow.steps_count": config.steps.length },
      );
    },
  };
}

const agentManager = new ProjectScopedRegistryManager<Agent>("agent");

class AgentRegistryClass extends ScopedRegistryFacade<Agent> {}

// Singleton instance - maintains same interface but now project-scoped internally
export const agentRegistry = new AgentRegistryClass(agentManager);

export { AgentRegistryClass };

const GET_AGENT_BRIDGE_KEY = "__vfGetAgent";
const REGISTER_AGENT_BRIDGE_KEY = "__vfRegisterAgent";
const GET_ALL_AGENT_IDS_BRIDGE_KEY = "__vfGetAllAgentIds";

function getExistingGlobalAgentBridge(key: string, localValue: unknown): unknown | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  if (!descriptor) return undefined;
  if (typeof descriptor.value !== "function") {
    throw new TypeError(`Global agent bridge ${key} already exists and is not callable.`);
  }
  return descriptor.value === localValue ? undefined : descriptor.value;
}

/** Registers agent. */
export function registerAgent(id: string, agent: Agent): void {
  const register = getExistingGlobalAgentBridge(REGISTER_AGENT_BRIDGE_KEY, registerAgent) as
    | ((id: string, agent: Agent) => void)
    | undefined;
  if (register) {
    register(id, agent);
    return;
  }

  agentRegistry.register(id, agent);
}

/** Return agent. */
export function getAgent(id: string): Agent | undefined {
  const get = getExistingGlobalAgentBridge(GET_AGENT_BRIDGE_KEY, getAgent) as
    | ((id: string) => Agent | undefined)
    | undefined;
  if (get) return get(id);

  return agentRegistry.get(id);
}

/** Return all agent IDs. */
export function getAllAgentIds(): string[] {
  const getAllIds = getExistingGlobalAgentBridge(GET_ALL_AGENT_IDS_BRIDGE_KEY, getAllAgentIds) as
    | (() => string[])
    | undefined;
  if (getAllIds) return getAllIds();

  return agentRegistry.getAllIds();
}

// Register on globalThis so compiled-binary runtime shim can delegate to the
// real registry. External temp-file modules can't import from the embedded
// binary FS, so they use globalThis bridges instead.
// Use Object.defineProperty to prevent accidental overwriting or enumeration.
function defineGlobalAgentBridge(key: string, value: unknown): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  if (descriptor) {
    if (typeof descriptor.value === "function") return;
    throw new TypeError(`Global agent bridge ${key} already exists and is not callable.`);
  }

  Object.defineProperty(globalThis, key, {
    value,
    writable: false,
    enumerable: false,
    configurable: false,
  });
}

for (
  const [key, value] of Object.entries({
    [GET_AGENT_BRIDGE_KEY]: getAgent,
    [REGISTER_AGENT_BRIDGE_KEY]: registerAgent,
    [GET_ALL_AGENT_IDS_BRIDGE_KEY]: getAllAgentIds,
  })
) {
  defineGlobalAgentBridge(key, value);
}

/** Return agents as tools. */
export function getAgentsAsTools(descriptions?: Record<string, string>): Record<string, Tool> {
  const tools: Record<string, Tool> = {};

  for (const id of getAllAgentIds()) {
    const agent = getAgent(id);
    if (!agent) continue;
    tools[id] = agentAsTool(agent, descriptions?.[id] ?? `Call ${id} agent`);
  }

  return tools;
}
