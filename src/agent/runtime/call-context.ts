/**
 * Agent Call Context
 *
 * Assembles the complete system-message set for one provider call. Every
 * caller that talks to a model, the hosted cloud runtime, the project
 * runtime's internal agent runs, and the `agent()` factory, gathers its own
 * inputs and hands them here, so ordering, block tags, marker splitting,
 * deduplication, and skill rendering live in exactly one place.
 *
 * The module is pure: it performs no I/O and reads no ambient state. Callers
 * resolve instructions, project facts, skills, and environment facts, then
 * describe them; the module decides how they are laid out.
 *
 * Layout of the returned messages:
 *
 * 1. One cached system message holding only the instructions before the
 *    runtime-context marker (or all instructions when the marker is absent).
 * 2. One optional uncached system message holding, in order,
 *    `<project_instructions>`, `<project_context>`, any caller-supplied extra
 *    blocks, `<available_skills>` or an `<authorized_skill_ids>`
 *    fallback, `<environment_context>`, and the instructions after the marker.
 *
 * Only the instructions are unconditional: each block appears only when the
 * caller supplied its input and the instructions do not already carry that tag
 * as a complete element, so message 2 can be absent and message 1 can be the
 * instructions alone. Callers compose in layers: the factory's output is later
 * re-composed by a project-runtime run, and skipping already-present elements
 * keeps that idempotent instead of repeating a project reference or catalog.
 *
 * @module
 */

import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
import type { AgentSystem } from "#veryfront/agent/types.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { createRuntimePromptBlock } from "./prompt-block.ts";
import {
  buildRuntimeAuthorizedSkillIdsPromptBlock,
  buildRuntimeAvailableSkillsPromptBlock,
  RUNTIME_GENERATED_SKILL_CATALOG_MARKER,
} from "./skill-prompt.ts";
import type { RuntimeSkillDefinition } from "./skill-metadata.ts";
import { flattenSystemInstructions } from "./tool-inventory.ts";
import { isOwnDataPropertyDescriptor, readOwnDataProperty } from "./data-property-descriptor.ts";

const ObjectDefineProperty = Object.defineProperty;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const ReflectApply = Reflect.apply;
const ReflectDeleteProperty = Reflect.deleteProperty;
const ReflectOwnKeys = Reflect.ownKeys;

/** Marker authored instructions use to place runtime blocks mid-prompt. */
export const DEFAULT_RUNTIME_AGENT_CONTEXT_MARKER = "<!-- veryfront-runtime-context -->";

const ENVIRONMENT_CONTEXT_BLOCK_NAME = "environment_context";
const AVAILABLE_SKILLS_BLOCK_NAME = "available_skills";
const AUTHORIZED_SKILL_IDS_BLOCK_NAME = "authorized_skill_ids";
const AUTHORIZED_SKILL_ID_DISCOVERY_BLOCK_NAME = "authorized_skill_id_discovery";

/** Project the call runs against, rendered as the `<project_context>` block. */
export type AgentCallProjectContext = {
  projectId: string;
  branchId?: string | null;
};

/** Input payload for build agent call context. */
export type BuildAgentCallContextInput = {
  /** Agent instructions, optionally split by the runtime-context marker. */
  instructions: AgentSystem;
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
  /**
   * Prompt-cache TTL for the static (Layer 0) system message. `"5m"` (default)
   * keeps the standard ephemeral breakpoint; `"1h"` extends it for interactive
   * multi-turn sessions. Gate this at the call site. Only set `"1h"` where a
   * second read is likely (root chat run, steering refresh). See RFC 0001.
   */
  cacheTtl?: AgentCallCacheTtl;
  /**
   * Active Anthropic provider alias whose structured cache metadata participates
   * in TTL normalization. Defaults to the built-in `veryfront-cloud` alias.
   */
  anthropicProviderAlias?: string;
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
}): { before: string; after: string | null; hasMarker: boolean } {
  const markerIndex = input.instructions.indexOf(input.runtimeContextMarker);

  if (markerIndex < 0) {
    return { before: input.instructions, after: null, hasMarker: false };
  }

  return {
    before: input.instructions.slice(0, markerIndex).trim(),
    after: input.instructions.slice(markerIndex + input.runtimeContextMarker.length).trim() || null,
    hasMarker: true,
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

function removeGeneratedSkillCatalogBlocks(instructions: string): string {
  const openTag = `<${AVAILABLE_SKILLS_BLOCK_NAME}>`;
  const closeTag = `</${AVAILABLE_SKILLS_BLOCK_NAME}>`;
  let result = instructions;
  let searchIndex = 0;

  while (searchIndex < result.length) {
    const openIndex = result.indexOf(openTag, searchIndex);
    if (openIndex < 0) {
      break;
    }
    const closeIndex = result.indexOf(closeTag, openIndex + openTag.length);
    if (closeIndex < 0) {
      break;
    }
    const content = result.slice(openIndex + openTag.length, closeIndex).trimStart();
    if (!content.startsWith(RUNTIME_GENERATED_SKILL_CATALOG_MARKER)) {
      searchIndex = closeIndex + closeTag.length;
      continue;
    }
    const before = result.slice(0, openIndex).trimEnd();
    const after = result.slice(closeIndex + closeTag.length).trimStart();
    result = before.length > 0 && after.length > 0 ? `${before}\n\n${after}` : `${before}${after}`;
    searchIndex = 0;
  }

  return result;
}

function snapshotOwnEnumerableDataRecord(
  value: unknown,
  label: string,
  options: { ignoreUnsafeDataKeys?: readonly PropertyKey[] } = {},
): Record<PropertyKey, unknown> {
  if (!isRecord(value)) {
    return {};
  }
  if (isProxyWithoutHooks(value)) {
    throw new TypeError(`${label} must not be a Proxy`);
  }

  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = ReflectApply(ObjectGetOwnPropertyDescriptors, undefined, [
      value,
    ]) as PropertyDescriptorMap;
  } catch {
    throw new TypeError(`${label} must expose data properties`);
  }

  const snapshot: Record<PropertyKey, unknown> = {};
  const keys = ReflectApply(ReflectOwnKeys, undefined, [descriptors]) as PropertyKey[];
  for (const key of keys) {
    const descriptorEntry = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
      descriptors,
      key,
    ]) as PropertyDescriptor | undefined;
    const descriptor = isOwnDataPropertyDescriptor(descriptorEntry)
      ? descriptorEntry.value as PropertyDescriptor
      : undefined;
    if (!descriptor?.enumerable) {
      continue;
    }
    if (!isOwnDataPropertyDescriptor(descriptor)) {
      if (options.ignoreUnsafeDataKeys?.includes(key)) {
        continue;
      }
      throw new TypeError(`${label}.${String(key)} must be an own enumerable data property`);
    }
    ReflectApply(ObjectDefineProperty, undefined, [snapshot, key, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    }]);
  }
  return snapshot;
}

function prepareStructuredInstructionMessages(input: {
  instructions: ChatSystemMessage[];
  removeGeneratedSkillContext: boolean;
}): ChatSystemMessage[] {
  return input.instructions.flatMap((message, index) => {
    const label = `Structured system message ${index}`;
    const contentValue = readOwnDataProperty(message, "content", label);
    if (typeof contentValue !== "string") {
      throw new TypeError(`${label}.content must be a string data property`);
    }
    const providerOptionsValue = readOwnDataProperty(
      message,
      "providerOptions",
      label,
      false,
    );
    const providerOptions = isRecord(providerOptionsValue)
      ? snapshotOwnEnumerableDataRecord(providerOptionsValue, `${label} providerOptions`)
      : undefined;
    const withoutGeneratedSkillContext = input.removeGeneratedSkillContext
      ? removeCompleteBlocks(
        removeCompleteBlocks(
          removeGeneratedSkillCatalogBlocks(contentValue),
          AUTHORIZED_SKILL_IDS_BLOCK_NAME,
        ),
        AUTHORIZED_SKILL_ID_DISCOVERY_BLOCK_NAME,
      )
      : contentValue;
    return withoutGeneratedSkillContext.length > 0
      ? [{
        role: "system",
        content: withoutGeneratedSkillContext,
        ...(providerOptions ? { providerOptions } : {}),
      }]
      : [];
  });
}

function splitStructuredInstructionMessages(
  messages: readonly ChatSystemMessage[],
  runtimeContextMarker: string,
): { before: ChatSystemMessage[]; after: ChatSystemMessage[]; hasMarker: boolean } {
  const before: ChatSystemMessage[] = [];
  const after: ChatSystemMessage[] = [];
  let foundMarker = false;

  for (const message of messages) {
    if (foundMarker) {
      after.push(message);
      continue;
    }

    const split = splitInstructionsAtMarker({
      instructions: message.content,
      runtimeContextMarker,
    });
    if (!split.hasMarker) {
      before.push(message);
      continue;
    }

    foundMarker = true;
    if (split.before.length > 0) {
      before.push({ ...message, content: split.before });
    }
    if (split.after !== null) {
      after.push({ ...message, content: split.after });
    }
  }

  return { before, after, hasMarker: foundMarker };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAnthropicCacheProviderKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized === "bedrock" || normalized === "veryfront-cloud" ||
    normalized.includes("anthropic");
}

function getAnthropicCacheProviderAlias(input: BuildAgentCallContextInput): string {
  const alias = input.anthropicProviderAlias;
  return alias && alias.trim().length > 0 ? alias : "veryfront-cloud";
}

function isAnthropicCacheControl(value: unknown): boolean {
  if (!isRecord(value) || isProxyWithoutHooks(value)) {
    return false;
  }
  try {
    const descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
      value,
      "type",
    ]) as PropertyDescriptor | undefined;
    return descriptor !== undefined && descriptor.enumerable === true &&
      isOwnDataPropertyDescriptor(descriptor) && descriptor.value === "ephemeral";
  } catch {
    return false;
  }
}

type StructuredCacheProviderBucket = {
  key: PropertyKey;
  value: Record<PropertyKey, unknown>;
  cacheControl: unknown;
};

function getStructuredCacheProviderBuckets(
  providerOptions: Record<PropertyKey, unknown>,
  anthropicProviderAlias: string,
): StructuredCacheProviderBucket[] {
  const buckets: StructuredCacheProviderBucket[] = [];
  const keys = ReflectApply(ReflectOwnKeys, undefined, [providerOptions]) as PropertyKey[];
  for (const key of keys) {
    if (key !== "anthropic" && key !== anthropicProviderAlias) {
      continue;
    }
    let bucketDescriptor: PropertyDescriptor | undefined;
    try {
      bucketDescriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
        providerOptions,
        key,
      ]) as PropertyDescriptor | undefined;
    } catch {
      throw new TypeError(
        `Structured system message providerOptions.${String(key)} must be inspectable`,
      );
    }
    if (!bucketDescriptor?.enumerable || !isOwnDataPropertyDescriptor(bucketDescriptor)) {
      continue;
    }
    const value = bucketDescriptor.value;
    if (!isRecord(value)) {
      continue;
    }
    if (isProxyWithoutHooks(value)) {
      throw new TypeError(
        `Structured system message providerOptions.${String(key)} must not be a Proxy`,
      );
    }

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
        value,
        "cacheControl",
      ]) as PropertyDescriptor | undefined;
    } catch {
      throw new TypeError(
        `Structured system message providerOptions.${String(key)}.cacheControl must be inspectable`,
      );
    }
    const cacheControl = descriptor?.enumerable && isOwnDataPropertyDescriptor(descriptor)
      ? descriptor.value
      : undefined;
    buckets.push({
      key,
      cacheControl,
      value: snapshotOwnEnumerableDataRecord(
        value,
        `Structured system message providerOptions.${String(key)}`,
        { ignoreUnsafeDataKeys: ["cacheControl"] },
      ),
    });
  }
  return buckets;
}

function removeStructuredCacheControls(
  messages: readonly ChatSystemMessage[],
  anthropicProviderAlias: string,
): ChatSystemMessage[] {
  return messages.map((message) => {
    const providerOptions = snapshotOwnEnumerableDataRecord(
      message.providerOptions,
      "Structured system message providerOptions",
    );
    const cacheProviderBuckets = getStructuredCacheProviderBuckets(
      providerOptions,
      anthropicProviderAlias,
    );
    if (cacheProviderBuckets.length === 0) {
      return message;
    }

    const nextProviderOptions = { ...providerOptions };
    for (const bucket of cacheProviderBuckets) {
      const nextBucket = { ...bucket.value };
      ReflectApply(ReflectDeleteProperty, undefined, [nextBucket, "cacheControl"]);
      if (ReflectOwnKeys(nextBucket).length > 0) {
        ReflectApply(ObjectDefineProperty, undefined, [nextProviderOptions, bucket.key, {
          configurable: true,
          enumerable: true,
          value: nextBucket,
          writable: true,
        }]);
      } else {
        ReflectApply(ReflectDeleteProperty, undefined, [nextProviderOptions, bucket.key]);
      }
    }

    return ReflectOwnKeys(nextProviderOptions).length > 0
      ? { ...message, providerOptions: nextProviderOptions }
      : { role: "system", content: message.content };
  });
}

function hasStructuredCacheControl(
  messages: readonly ChatSystemMessage[],
  anthropicProviderAlias: string,
): boolean {
  for (const message of messages) {
    const providerOptions = snapshotOwnEnumerableDataRecord(
      message.providerOptions,
      "Structured system message providerOptions",
    );
    if (
      getStructuredCacheProviderBuckets(providerOptions, anthropicProviderAlias).some((bucket) =>
        bucket.cacheControl !== undefined
      )
    ) {
      return true;
    }
  }
  return false;
}

function applyStructuredCacheTtl(
  messages: ChatSystemMessage[],
  cacheTtl: AgentCallCacheTtl | undefined,
  anthropicProviderAlias: string,
): ChatSystemMessage[] {
  if (messages.length === 0) {
    return messages;
  }
  if (cacheTtl === undefined && hasStructuredCacheControl(messages, anthropicProviderAlias)) {
    return messages;
  }

  const breakpointIndex = messages.length - 1;
  return messages.map((message, index) => {
    const providerOptions = snapshotOwnEnumerableDataRecord(
      message.providerOptions,
      "Structured system message providerOptions",
    );
    const structuredCacheProviderBuckets = getStructuredCacheProviderBuckets(
      providerOptions,
      anthropicProviderAlias,
    );
    const cacheProviderBuckets = structuredCacheProviderBuckets.filter((bucket) =>
      bucket.cacheControl !== undefined
    );
    const undefinedCacheProviderBuckets = structuredCacheProviderBuckets.filter((bucket) =>
      bucket.cacheControl === undefined
    );
    const addCanonicalBreakpoint = index === breakpointIndex && cacheProviderBuckets.length === 0;
    if (
      cacheProviderBuckets.length === 0 && undefinedCacheProviderBuckets.length === 0 &&
      !addCanonicalBreakpoint
    ) {
      return message;
    }

    const nextProviderOptions = { ...providerOptions };
    for (const bucket of undefinedCacheProviderBuckets) {
      const nextBucket = { ...bucket.value };
      ReflectApply(ReflectDeleteProperty, undefined, [nextBucket, "cacheControl"]);
      if (ReflectOwnKeys(nextBucket).length > 0) {
        ReflectApply(ObjectDefineProperty, undefined, [nextProviderOptions, bucket.key, {
          configurable: true,
          enumerable: true,
          value: nextBucket,
          writable: true,
        }]);
      } else {
        ReflectApply(ReflectDeleteProperty, undefined, [nextProviderOptions, bucket.key]);
      }
    }
    for (const bucket of cacheProviderBuckets) {
      ReflectApply(ObjectDefineProperty, undefined, [nextProviderOptions, bucket.key, {
        configurable: true,
        enumerable: true,
        value: {
          ...bucket.value,
          cacheControl: buildCacheControl(cacheTtl),
        },
        writable: true,
      }]);
    }
    if (addCanonicalBreakpoint) {
      const anthropic = snapshotOwnEnumerableDataRecord(
        providerOptions.anthropic,
        "Structured system message providerOptions.anthropic",
        { ignoreUnsafeDataKeys: ["cacheControl"] },
      );
      ReflectApply(ObjectDefineProperty, undefined, [nextProviderOptions, "anthropic", {
        configurable: true,
        enumerable: true,
        value: {
          ...anthropic,
          cacheControl: buildCacheControl(cacheTtl),
        },
        writable: true,
      }]);
    }
    return {
      ...message,
      providerOptions: nextProviderOptions,
    };
  });
}

/**
 * Builds the layered system-message set for one provider call (RFC 0001).
 *
 * Layer 0 (cached, shared across runs): the agent prompt only, with nothing
 * project- or turn-specific. Its `cacheControl` breakpoint is the sole shared
 * cache key, so it must be byte-identical across projects.
 *
 * Dynamic tail (uncached): project context/instructions, extra blocks, the
 * skills catalog, and host environment facts. This includes everything that varies by
 * project, session, or turn. Kept out of the cached prefix so a fresh project
 * or session still reads the shared Layer 0 instead of paying full price.
 */
export function buildAgentCallContext(input: BuildAgentCallContextInput): ChatSystemMessage[] {
  const preserveRuntimeContextMarker = (
    input as InternalBuildAgentCallContextInput
  )[PRESERVE_RUNTIME_CONTEXT_MARKER] === true;
  const runtimeContextMarker = input.runtimeContextMarker ?? DEFAULT_RUNTIME_AGENT_CONTEXT_MARKER;
  const anthropicProviderAlias = getAnthropicCacheProviderAlias(input);
  if (Array.isArray(input.instructions)) {
    const preparedMessages = prepareStructuredInstructionMessages({
      instructions: input.instructions,
      removeGeneratedSkillContext: input.skills !== undefined,
    });
    const splitMessages = splitStructuredInstructionMessages(
      preparedMessages,
      runtimeContextMarker,
    );
    const staticMessages = applyStructuredCacheTtl(
      splitMessages.before,
      input.cacheTtl,
      anthropicProviderAlias,
    );
    const flattenedInstructions = flattenSystemInstructions([
      ...splitMessages.before,
      ...splitMessages.after,
    ]);
    const generatedMessages = buildAgentCallContext({
      ...input,
      instructions: flattenedInstructions,
    });
    const dynamicMessage = generatedMessages[flattenedInstructions.length > 0 ? 1 : 0];
    return [
      ...staticMessages,
      ...(preserveRuntimeContextMarker && splitMessages.hasMarker
        ? [{ role: "system" as const, content: runtimeContextMarker }]
        : []),
      ...(dynamicMessage ? [dynamicMessage] : []),
      ...removeStructuredCacheControls(splitMessages.after, anthropicProviderAlias),
    ];
  }
  const sourceInstructions = input.skills === undefined ? input.instructions : removeCompleteBlocks(
    removeCompleteBlocks(
      removeGeneratedSkillCatalogBlocks(input.instructions),
      AUTHORIZED_SKILL_IDS_BLOCK_NAME,
    ),
    AUTHORIZED_SKILL_ID_DISCOVERY_BLOCK_NAME,
  );
  const instructions = splitInstructionsAtMarker({
    instructions: sourceInstructions,
    runtimeContextMarker,
  });

  // Layer 0 contains only the static prompt before the marker. When no marker
  // exists, `before` contains the complete instructions.
  const staticPrompt = instructions.before;

  // The dynamic tail contains project blocks, extra blocks, skills, and environment. Each is
  // dropped if the agent's instructions already carry the same block (dedup).
  const dynamicParts: string[] = [];

  if (preserveRuntimeContextMarker && instructions.hasMarker) {
    dynamicParts.push(runtimeContextMarker);
  }

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
    if (blockName !== null && hasBlock(sourceInstructions, blockName)) {
      continue;
    }
    dynamicParts.push(block);
  }

  if (input.skills !== undefined) {
    const hasAuthoredSkillCatalog = hasBlock(sourceInstructions, AVAILABLE_SKILLS_BLOCK_NAME);
    if (input.skills.length > 0 || hasAuthoredSkillCatalog) {
      dynamicParts.push(
        hasAuthoredSkillCatalog
          ? buildRuntimeAuthorizedSkillIdsPromptBlock(input.skills)
          : buildRuntimeAvailableSkillsPromptBlock(input.skills),
      );
    }
  }

  if (input.environmentContext && !hasBlock(sourceInstructions, ENVIRONMENT_CONTEXT_BLOCK_NAME)) {
    dynamicParts.push(
      createRuntimePromptBlock({
        name: ENVIRONMENT_CONTEXT_BLOCK_NAME,
        content: input.environmentContext,
      }),
    );
  }

  if (instructions.after) {
    dynamicParts.push(instructions.after);
  }

  const messages: ChatSystemMessage[] = staticPrompt.length > 0
    ? [{
      role: "system",
      content: staticPrompt,
      providerOptions: {
        anthropic: { cacheControl: buildCacheControl(input.cacheTtl) },
      },
    }]
    : [];

  if (dynamicParts.length > 0) {
    messages.push({
      role: "system",
      content: dynamicParts.join("\n\n"),
    });
  }

  return messages;
}

const PRESERVE_RUNTIME_CONTEXT_MARKER = Symbol("preserveRuntimeContextMarker");
type InternalBuildAgentCallContextInput = BuildAgentCallContextInput & {
  [PRESERVE_RUNTIME_CONTEXT_MARKER]?: true;
};

/** Keeps the marker so another internal context composer can consume it. */
export function buildAgentCallContextPreservingRuntimeMarker(
  input: BuildAgentCallContextInput,
): ChatSystemMessage[] {
  return buildAgentCallContext({
    ...input,
    [PRESERVE_RUNTIME_CONTEXT_MARKER]: true,
  } as InternalBuildAgentCallContextInput);
}
