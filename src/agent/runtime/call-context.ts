/**
 * Agent Call Context
 *
 * Assembles the complete system-message set for one provider call. Every
 * caller that talks to a model — the hosted cloud runtime, the project
 * runtime's internal agent runs, and the `agent()` factory — gathers its own
 * inputs and hands them here, so ordering, block tags, marker splitting,
 * deduplication, and skill rendering live in exactly one place.
 *
 * The module is pure: it performs no I/O and reads no ambient state. Callers
 * resolve instructions, project facts, skills, and environment facts, then
 * describe them; the module decides how they are laid out.
 *
 * Layout of the returned messages:
 *
 * 1. One cached system message holding, in order, the instructions before the
 *    runtime-context marker, `<project_instructions>`, `<project_context>`,
 *    any caller-supplied extra blocks, the instructions after the marker, and
 *    `<available_skills>`, or an authoritative `<available_skill_ids>` fallback
 *    when the instructions already carry an authored skill catalog.
 * 2. An uncached `<environment_context>` message.
 *
 * Only the instructions are unconditional: each block appears only when the
 * caller supplied its input and the instructions do not already carry that tag
 * as a complete element, so message 2 can be absent and message 1 can be the
 * instructions alone. Callers compose in layers — the factory's output is later
 * re-composed by a project-runtime run — and skipping already-present elements
 * keeps that idempotent instead of repeating a project reference or catalog.
 *
 * @module
 */

import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
import { createRuntimePromptBlock } from "./prompt-block.ts";
import {
  buildRuntimeAvailableSkillIdsPromptBlock,
  buildRuntimeAvailableSkillsPromptBlock,
} from "./skill-prompt.ts";
import type { RuntimeSkillDefinition } from "./skill-metadata.ts";

/** Marker authored instructions use to place runtime blocks mid-prompt. */
export const DEFAULT_RUNTIME_AGENT_CONTEXT_MARKER = "<!-- veryfront-runtime-context -->";

const ENVIRONMENT_CONTEXT_BLOCK_NAME = "environment_context";
const AVAILABLE_SKILLS_BLOCK_NAME = "available_skills";
const AVAILABLE_SKILL_IDS_BLOCK_NAME = "available_skill_ids";

/** Project the call runs against, rendered as the `<project_context>` block. */
export type AgentCallProjectContext = {
  projectId: string;
  branchId?: string | null;
};

/** Input payload for build agent call context. */
export type BuildAgentCallContextInput = {
  /** Agent instructions, optionally split by the runtime-context marker. */
  instructions: string;
  /** Marker that places runtime blocks mid-prompt. Defaults to the shared marker. */
  runtimeContextMarker?: string;
  /** Steering text the host requires the agent to follow. */
  projectInstructions?: string;
  /** Project reference and branch the run is scoped to. */
  projectContext?: AgentCallProjectContext;
  /** Pre-rendered blocks appended after the project blocks (e.g. `<runtime_info>`). */
  extraBlocks?: readonly string[];
  /** Skills the agent may load during the call. */
  skills?: readonly RuntimeSkillDefinition[];
  /** Host-supplied environment facts. */
  environmentContext?: string;
};

/** Builds the shared project-context prompt block (project reference + branch). */
export function buildProjectContextPromptBlock(input: AgentCallProjectContext): string {
  const branchLine = input.branchId
    ? `branch_id: "${input.branchId}"`
    : "branch_id: main (no branch_id needed for file operations)";

  return createRuntimePromptBlock({
    name: "project_context",
    content: `project_reference: "${input.projectId}"
${branchLine}

Use the exact project_reference above for project/platform tools unless a tool result explicitly confirms a different active project.

CRITICAL: Do NOT guess or invent project references. If a tool requires project_reference, use the value above.`,
  });
}

/** Builds the project-instructions prompt block. */
export function buildProjectInstructionsPromptBlock(instructions: string): string {
  return createRuntimePromptBlock({
    name: "project_instructions",
    content: `CRITICAL: You MUST follow these project-specific guidelines:\n\n${instructions}`,
  });
}

function splitInstructionsAtMarker(input: {
  instructions: string;
  runtimeContextMarker: string;
}): { before: string; after: string | null } {
  const markerIndex = input.instructions.indexOf(input.runtimeContextMarker);

  if (markerIndex < 0) {
    return { before: input.instructions, after: null };
  }

  return {
    before: input.instructions.slice(0, markerIndex).trim(),
    after: input.instructions.slice(markerIndex + input.runtimeContextMarker.length).trim() || null,
  };
}

function getBlockName(block: string): string | null {
  return /^<([A-Za-z0-9_-]+)[\s>]/.exec(block)?.[1] ?? null;
}

/**
 * Whether the instructions carry the block as a complete element. Prose that
 * merely names a tag ("wrap the reference in <project_context>") must not
 * suppress the real block, so an opening tag only counts when a matching
 * closing tag follows it.
 */
function hasBlock(instructions: string, blockName: string): boolean {
  const openIndex = instructions.indexOf(`<${blockName}>`);
  if (openIndex < 0) {
    return false;
  }
  return instructions.indexOf(`</${blockName}>`, openIndex) > openIndex;
}

function removeCompleteBlocks(instructions: string, blockName: string): string {
  const openTag = `<${blockName}>`;
  const closeTag = `</${blockName}>`;
  let result = instructions;
  let openIndex = result.indexOf(openTag);

  while (openIndex >= 0) {
    const closeIndex = result.indexOf(closeTag, openIndex + openTag.length);
    if (closeIndex < 0) {
      break;
    }
    const before = result.slice(0, openIndex).trimEnd();
    const after = result.slice(closeIndex + closeTag.length).trimStart();
    result = before.length > 0 && after.length > 0 ? `${before}\n\n${after}` : `${before}${after}`;
    openIndex = result.indexOf(openTag);
  }

  return result;
}

/** Builds the complete system-message set for one provider call. */
export function buildAgentCallContext(input: BuildAgentCallContextInput): ChatSystemMessage[] {
  const runtimeContextMarker = input.runtimeContextMarker ?? DEFAULT_RUNTIME_AGENT_CONTEXT_MARKER;
  const sourceInstructions = input.skills === undefined
    ? input.instructions
    : removeCompleteBlocks(input.instructions, AVAILABLE_SKILL_IDS_BLOCK_NAME);
  const instructions = splitInstructionsAtMarker({
    instructions: sourceInstructions,
    runtimeContextMarker,
  });

  const blocks: string[] = [];
  if (input.projectInstructions) {
    blocks.push(buildProjectInstructionsPromptBlock(input.projectInstructions));
  }
  if (input.projectContext) {
    blocks.push(buildProjectContextPromptBlock(input.projectContext));
  }
  blocks.push(...(input.extraBlocks ?? []));

  const staticParts: string[] = [];

  if (instructions.before) {
    staticParts.push(instructions.before);
  }

  for (const block of blocks) {
    if (block.length === 0) {
      continue;
    }
    const blockName = getBlockName(block);
    if (blockName !== null && hasBlock(sourceInstructions, blockName)) {
      continue;
    }
    staticParts.push(block);
  }

  if (instructions.after) {
    staticParts.push(instructions.after);
  }

  if (input.skills?.length) {
    staticParts.push(
      hasBlock(sourceInstructions, AVAILABLE_SKILLS_BLOCK_NAME)
        ? buildRuntimeAvailableSkillIdsPromptBlock(input.skills)
        : buildRuntimeAvailableSkillsPromptBlock(input.skills),
    );
  }

  const messages: ChatSystemMessage[] = [
    {
      role: "system",
      content: staticParts.join("\n\n"),
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    },
  ];

  if (input.environmentContext && !hasBlock(sourceInstructions, ENVIRONMENT_CONTEXT_BLOCK_NAME)) {
    messages.push({
      role: "system",
      content: createRuntimePromptBlock({
        name: ENVIRONMENT_CONTEXT_BLOCK_NAME,
        content: input.environmentContext,
      }),
    });
  }

  return messages;
}
