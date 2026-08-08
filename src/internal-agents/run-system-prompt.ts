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

import type { Agent } from "#veryfront/agent";
import { buildAgentCallContext } from "#veryfront/agent/runtime/call-context.ts";
import { getEffectiveAgentSystem } from "#veryfront/agent/runtime/effective-agent-system.ts";
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
    const branchId = data.branchId === null ? null : getNonEmptyString(data.branchId);

    return {
      ...(environmentContext ? { environmentContext } : {}),
      ...(projectId ? { projectId } : {}),
      ...(branchId !== undefined ? { branchId } : {}),
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
  branchId?: string | null;
  toolNames: readonly string[];
};

/** Composes the internal agent run system prompt. */
export async function composeInternalAgentRunSystemPrompt(
  input: ComposeInternalAgentRunSystemPromptInput,
): Promise<string> {
  const baseInstructions = await resolveBaseSystemPrompt(getEffectiveAgentSystem(input.agent));
  const studioContext = getInternalAgentStudioRunContext(input.runInput.context);
  const projectId = input.projectId ?? studioContext.projectId;

  const extraBlocks: string[] = [];
  if (input.agent.config.model) {
    extraBlocks.push(
      createRuntimePromptBlock({
        name: "runtime_info",
        content: `model: "${input.agent.config.model}"`,
      }),
    );
  }

  const messages = buildAgentCallContext({
    instructions: baseInstructions,
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

  return flattenSystemInstructions(withRuntimeToolInventory(messages, input.toolNames));
}
