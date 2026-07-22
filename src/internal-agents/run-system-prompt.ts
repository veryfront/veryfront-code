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
 * already include the factory's skill manifest for skill-enabled agents) with:
 * - the shared project-context block (project reference + branch)
 * - the requested model
 * - the caller-supplied environment context (`studio_context` context item)
 * - the effective run tool inventory
 *
 * @module
 */

import type { Agent } from "#veryfront/agent";
import { buildProjectContextPromptBlock } from "#veryfront/agent/hosted/cloud-runtime-system-messages.ts";
import { createRuntimeAgentSystemMessages } from "#veryfront/agent/runtime/agent-definition.ts";
import { getRuntimeAgentMarkdownDefinition } from "#veryfront/agent/runtime/agent-markdown-adapter.ts";
import { createRuntimePromptBlock } from "#veryfront/agent/runtime/prompt-block.ts";
import {
  flattenSystemInstructions,
  withRuntimeToolInventory,
} from "#veryfront/agent/runtime/tool-inventory.ts";
import type { RuntimeRunAgentInput } from "./schema.ts";

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

    return {
      ...(environmentContext ? { environmentContext } : {}),
      ...(projectId ? { projectId } : {}),
      ...(typeof data.branchId === "string" || data.branchId === null
        ? { branchId: data.branchId }
        : {}),
    };
  }

  return {};
}

async function resolveBaseSystemPrompt(system: Agent["config"]["system"]): Promise<string> {
  if (typeof system === "string") {
    return system;
  }
  if (typeof system === "function") {
    return await system();
  }
  return DEFAULT_SYSTEM_PROMPT;
}

/** Input payload for compose internal agent run system prompt. */
export type ComposeInternalAgentRunSystemPromptInput = {
  agent: Agent;
  runInput: RuntimeRunAgentInput;
  projectId?: string | null;
  toolNames: readonly string[];
};

/** Composes the internal agent run system prompt. */
export async function composeInternalAgentRunSystemPrompt(
  input: ComposeInternalAgentRunSystemPromptInput,
): Promise<string> {
  const baseInstructions = await resolveBaseSystemPrompt(input.agent.config.system);
  const studioContext = getInternalAgentStudioRunContext(input.runInput.context);
  const projectId = input.projectId ?? studioContext.projectId;

  const runtimeBlocks: string[] = [];
  if (projectId) {
    runtimeBlocks.push(
      buildProjectContextPromptBlock({
        projectId,
        branchId: studioContext.branchId ?? null,
      }),
    );
  }
  if (input.agent.config.model) {
    runtimeBlocks.push(
      createRuntimePromptBlock({
        name: "runtime_info",
        content: `model: "${input.agent.config.model}"`,
      }),
    );
  }

  const definition = getRuntimeAgentMarkdownDefinition(input.agent);
  const messages = createRuntimeAgentSystemMessages({
    agent: {
      ...(definition ?? {
        id: input.agent.id,
        name: input.agent.config.name ?? input.agent.id,
        description: input.agent.config.description ?? "",
      }),
      instructions: baseInstructions,
    },
    runtimeBlocks,
    ...(studioContext.environmentContext
      ? { environmentContext: studioContext.environmentContext }
      : {}),
  });

  return flattenSystemInstructions(withRuntimeToolInventory(messages, input.toolNames));
}

/** Creates a lazy system prompt resolver for an internal agent run. */
export function createInternalAgentRunSystemPromptResolver(
  input: ComposeInternalAgentRunSystemPromptInput,
): () => Promise<string> {
  return () => composeInternalAgentRunSystemPrompt(input);
}
