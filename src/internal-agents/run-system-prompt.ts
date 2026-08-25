/**
 * Internal Agent Run System Prompt
 *
 * Composes the system prompt for project-runtime agent runs, mirroring the
 * hosted chat runtime's instruction assembly. Before this, internal runs used
 * the agent's authored instructions verbatim, so request-scoped agents (e.g.
 * Studio-created project agents) never learned the project reference, branch,
 * Studio environment context, or effective tool surface of the run they were
 * executing in and asked users for values the harness already knew.
 *
 * The composed prompt extends the agent's resolved base instructions (which
 * already include the factory's visible skill catalog) with:
 * - the shared project-context block (project reference + branch)
 * - the requested model
 * - the caller-supplied environment context (`studio_context` context item)
 * - the effective run tool inventory
 *
 * @module
 */

import type { Agent, AgentSystem } from "#veryfront/agent";
import { buildAgentCallContext } from "#veryfront/agent/runtime/call-context.ts";
import {
  getEffectiveAgentSystem,
  resolveAgentSystem,
} from "#veryfront/agent/runtime/effective-agent-system.ts";
import { createRuntimePromptBlock } from "#veryfront/agent/runtime/prompt-block.ts";
import { resolveModelProviderOptionKey } from "#veryfront/agent/runtime/model-resolution.ts";
import { withRuntimeToolInventory } from "#veryfront/agent/runtime/tool-inventory.ts";
import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
import type { RuntimeRunAgentInput } from "./schema.ts";
import type { ModelRuntime } from "#veryfront/provider";

const STUDIO_CONTEXT_ITEM_TITLE = "studio_context";
const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";

/** Caller-supplied run context extracted from the `studio_context` item. */
export type InternalAgentStudioRunContext = {
  environmentContext?: string;
  projectId?: string;
  branchId?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getStudioContextData(item: unknown): Record<string, unknown> | undefined {
  if (!isRecord(item) || item.type !== "json" || item.title !== STUDIO_CONTEXT_ITEM_TITLE) {
    return undefined;
  }
  return isRecord(item.data) ? item.data : undefined;
}

/** Extracts the Studio-supplied run context from run context items. */
export function getInternalAgentStudioRunContext(
  context: RuntimeRunAgentInput["context"],
): InternalAgentStudioRunContext {
  for (const item of context) {
    const data = getStudioContextData(item);
    if (!data) {
      continue;
    }

    const environmentContext = getNonEmptyString(data.environmentContext);
    const projectId = getNonEmptyString(data.projectId);
    const branchId = data.branchId === null ? null : getNonEmptyString(data.branchId);

    return {
      ...(environmentContext ? { environmentContext } : {}),
      ...(projectId ? { projectId } : {}),
      ...(branchId !== undefined ? { branchId } : {}),
    };
  }

  return {};
}

async function resolveBaseSystemPrompt(
  system: Agent["config"]["system"],
  providerOptionKey: string | undefined,
): Promise<AgentSystem> {
  const resolved = await resolveAgentSystem(system, providerOptionKey);
  if (typeof resolved === "string") {
    return resolved;
  }
  return resolved.length > 0 ? resolved : DEFAULT_SYSTEM_PROMPT;
}

/** Input payload for compose internal agent run system prompt. */
export type ComposeInternalAgentRunSystemPromptInput = {
  agent: Agent;
  resolvedBaseSystem?: AgentSystem;
  runInput: RuntimeRunAgentInput;
  projectId?: string | null;
  branchId?: string | null;
  toolNames: readonly string[];
  providerOptionKey?: string;
  modelRuntime?: ModelRuntime;
};

/** Composes the internal agent run system prompt. */
export async function composeInternalAgentRunSystemPrompt(
  input: ComposeInternalAgentRunSystemPromptInput,
): Promise<ChatSystemMessage[]> {
  const baseSystem = input.resolvedBaseSystem === undefined
    ? await resolveBaseSystemPrompt(
      getEffectiveAgentSystem(input.agent),
      input.providerOptionKey,
    )
    : typeof input.resolvedBaseSystem === "string" || input.resolvedBaseSystem.length > 0
    ? input.resolvedBaseSystem
    : DEFAULT_SYSTEM_PROMPT;
  const studioContext = getInternalAgentStudioRunContext(input.runInput.context);
  const projectId = input.projectId ?? studioContext.projectId;
  const anthropicProviderAlias = input.providerOptionKey ??
    resolveModelProviderOptionKey(input.agent.config.model, input.modelRuntime);

  const extraBlocks: string[] = [];
  if (input.agent.config.model) {
    extraBlocks.push(
      createRuntimePromptBlock({
        name: "runtime_info",
        content: `model: "${input.agent.config.model}"`,
      }),
    );
  }

  const contextMessages = buildAgentCallContext({
    instructions: baseSystem,
    ...(anthropicProviderAlias ? { anthropicProviderAlias } : {}),
    ...(projectId
      ? {
        projectContext: {
          projectId,
          branchId: input.branchId !== undefined ? input.branchId : studioContext.branchId ?? null,
        },
      }
      : {}),
    extraBlocks,
    ...(studioContext.environmentContext
      ? { environmentContext: studioContext.environmentContext }
      : {}),
  });
  return withRuntimeToolInventory(contextMessages, input.toolNames);
}
