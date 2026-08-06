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
 *    `<available_skills>`.
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
import { buildRuntimeAvailableSkillsPromptBlock } from "./skill-prompt.ts";
import type { RuntimeSkillDefinition } from "./skill-metadata.ts";

/** Marker authored instructions use to place runtime blocks mid-prompt. */
export const DEFAULT_RUNTIME_AGENT_CONTEXT_MARKER = "<!-- veryfront-runtime-context -->";

const ENVIRONMENT_CONTEXT_BLOCK_NAME = "environment_context";
const AVAILABLE_SKILLS_BLOCK_NAME = "available_skills";

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
  /** Tool names actually available in this run, used to scope delegation guidance. */
  availableToolNames?: readonly string[];
  /** Include the skill tool call signatures in the skills block. */
  includeSkillToolUsage?: boolean;
  /** Host-supplied environment facts. */
  environmentContext?: string;
  /**
   * Prompt-cache TTL for the static (Layer 0) system message. `"5m"` (default)
   * keeps the standard ephemeral breakpoint; `"1h"` extends it for interactive
   * multi-turn sessions. Gate this at the call site — only set `"1h"` where a
   * second read is likely (root chat run, steering refresh). See RFC 0001.
   */
  cacheTtl?: AgentCallCacheTtl;
};

/** Supported prompt-cache TTLs for the cached static system message. */
export type AgentCallCacheTtl = "5m" | "1h";

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

/**
 * Renders the Anthropic `cacheControl` for the static system message. The
 * default (`"5m"`) omits `ttl` to preserve the standard 5-minute ephemeral
 * breakpoint byte-for-byte; `"1h"` requests the 1-hour cache.
 */
function buildCacheControl(cacheTtl: AgentCallCacheTtl | undefined): {
  type: "ephemeral";
  ttl?: "1h";
} {
  return cacheTtl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
}

/**
 * Builds the layered system-message set for one provider call (RFC 0001).
 *
 * Layer 0 (cached, shared across runs): the agent prompt only — nothing
 * project- or turn-specific. Its `cacheControl` breakpoint is the sole shared
 * cache key, so it must be byte-identical across projects.
 *
 * Dynamic tail (uncached): project context/instructions, extra blocks, the
 * skills catalog, and host environment facts — everything that varies by
 * project, session, or turn. Kept out of the cached prefix so a fresh project
 * or session still reads the shared Layer 0 instead of paying full price.
 */
export function buildAgentCallContext(input: BuildAgentCallContextInput): ChatSystemMessage[] {
  const runtimeContextMarker = input.runtimeContextMarker ?? DEFAULT_RUNTIME_AGENT_CONTEXT_MARKER;
  const instructions = splitInstructionsAtMarker({
    instructions: input.instructions,
    runtimeContextMarker,
  });

  // Layer 0 — static prompt only (the marker split's head and tail).
  const staticPrompt = [instructions.before, instructions.after]
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join("\n\n");

  // Dynamic tail — project blocks, extra blocks, skills, environment. Each is
  // dropped if the agent's instructions already carry the same block (dedup).
  const dynamicParts: string[] = [];

  const projectBlocks: string[] = [];
  if (input.projectInstructions) {
    projectBlocks.push(buildProjectInstructionsPromptBlock(input.projectInstructions));
  }
  if (input.projectContext) {
    projectBlocks.push(buildProjectContextPromptBlock(input.projectContext));
  }
  projectBlocks.push(...(input.extraBlocks ?? []));

  for (const block of projectBlocks) {
    if (block.length === 0) {
      continue;
    }
    const blockName = getBlockName(block);
    if (blockName !== null && hasBlock(input.instructions, blockName)) {
      continue;
    }
    dynamicParts.push(block);
  }

  if (input.skills?.length && !hasBlock(input.instructions, AVAILABLE_SKILLS_BLOCK_NAME)) {
    dynamicParts.push(
      buildRuntimeAvailableSkillsPromptBlock(input.skills, {
        ...(input.availableToolNames === undefined
          ? {}
          : { availableToolNames: input.availableToolNames }),
        ...(input.includeSkillToolUsage === undefined
          ? {}
          : { includeSkillToolUsage: input.includeSkillToolUsage }),
      }),
    );
  }

  if (input.environmentContext && !hasBlock(input.instructions, ENVIRONMENT_CONTEXT_BLOCK_NAME)) {
    dynamicParts.push(
      createRuntimePromptBlock({
        name: ENVIRONMENT_CONTEXT_BLOCK_NAME,
        content: input.environmentContext,
      }),
    );
  }

  const messages: ChatSystemMessage[] = [
    {
      role: "system",
      content: staticPrompt,
      providerOptions: {
        anthropic: { cacheControl: buildCacheControl(input.cacheTtl) },
      },
    },
  ];

  if (dynamicParts.length > 0) {
    messages.push({
      role: "system",
      content: dynamicParts.join("\n\n"),
    });
  }

  return messages;
}
