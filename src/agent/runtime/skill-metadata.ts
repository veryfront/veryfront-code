import { extract } from "#std/front-matter/yaml.ts";
import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import {
  assertResolvedSkillSelector,
  type ResolvedSkillSelectorSnapshot,
  resolveSkillSelector,
} from "#veryfront/skill/selector.ts";
import { SKILL_NAME_REGEX, SKILL_PROVIDER_SAFE_ID_REGEX } from "#veryfront/skill/types.ts";

function normalizeAllowedTools(value: string | string[] | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  const values = Array.isArray(value)
    ? value
    : value.includes(",")
    ? value.split(",")
    : value.split(/\s+/);

  return values.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

// Hand-written transform output type. The contract DSL erases the parameter
// type through `.transform()`, so we annotate explicitly.
/** Public API contract for runtime skill frontmatter. */
export interface RuntimeSkillFrontmatter {
  name: string | undefined;
  description: string | undefined;
  allowedTools: string[];
  metadata: Record<string, string> | undefined;
  model: string | undefined;
  thinking: false | number | undefined;
  maxSteps: number | undefined;
}

export const getRuntimeSkillFrontmatterSchema = defineSchema((v) =>
  v
    .object({
      name: v.string().optional(),
      description: v.string().optional(),
      "allowed-tools": v.union([v.string(), v.array(v.string())]).optional(),
      allowed_tools: v.union([v.string(), v.array(v.string())]).optional(),
      model: v.string().optional(),
      metadata: v.record(v.string(), v.unknown()).optional(),
      thinking: v.union([v.literal(false), v.coerce.number().int().positive()]).optional(),
      "max-steps": v.coerce.number().int().positive().optional(),
    })
    .passthrough()
    .transform((data): RuntimeSkillFrontmatter => {
      const d = data as Record<string, unknown>;
      const metadata = normalizeMetadata(d.metadata);
      return {
        name: normalizeOptionalString(d.name),
        description: (typeof d.description === "string" ? d.description.trim() : undefined) ||
          undefined,
        allowedTools: normalizeAllowedTools(
          (d["allowed-tools"] ?? d.allowed_tools) as string | string[] | undefined,
        ),
        metadata,
        model: (typeof d.model === "string" ? d.model.trim() : undefined) || undefined,
        thinking: d.thinking as false | number | undefined,
        maxSteps: d["max-steps"] as number | undefined,
      };
    })
);

function normalizeOptionalString(value: unknown): string | undefined {
  return (typeof value === "string" ? value.trim() : undefined) || undefined;
}

function normalizeMetadata(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return undefined;
  }

  const metadata: Record<string, string> = {};
  for (const [key, rawValue] of entries) {
    metadata[key] = String(rawValue);
  }
  return metadata;
}

/** Schema for runtime skill frontmatter.
 * @deprecated Use getRuntimeSkillFrontmatterSchema()
 */
export const RuntimeSkillFrontmatterSchema = lazySchema(getRuntimeSkillFrontmatterSchema);

/** Definition for runtime skill. */
export type RuntimeSkillDefinition = {
  id: string;
  name: string;
  displayName?: string;
  description: string;
  instructions: string;
  allowedTools: string[];
  metadata?: Record<string, string>;
  model?: string;
  thinking?: false | number;
  maxSteps?: number;
  references?: string[];
  /**
   * Owning agent id for agent-scoped (colocated) skills. Unowned (undefined)
   * skills are project-global; owned skills are visible only to their owner.
   */
  ownerAgentId?: string;
  /** Short name used by the owning agent's `skills:` selector (e.g. "cite"). */
  shortName?: string;
  /**
   * Actual discovered source path of the skill's SKILL.md. Consumers must use
   * this instead of reconstructing paths from (possibly namespaced) ids.
   */
  sourcePath?: string;
};

/**
 * Whether a runtime skill definition is visible to the caller identified by
 * the scope — the same owner-aware rule as the local skill registry: unowned
 * skills plus the caller's own.
 */
export function isRuntimeSkillVisibleTo(
  definition: Pick<RuntimeSkillDefinition, "ownerAgentId">,
  scope?: { agentId?: string },
): boolean {
  return definition.ownerAgentId === undefined || definition.ownerAgentId === scope?.agentId;
}

/**
 * Resolve the runtime skills advertised to an agent.
 *
 * Explicit selectors use the same rule as the local skill registry: resolve
 * the agent's own short name first, then an exact visible skill id.
 */
export function resolveRuntimeSkillsForAgent(input: {
  skills: readonly RuntimeSkillDefinition[];
  agentId: string;
  selector: true | false | string[] | undefined;
}): RuntimeSkillDefinition[] {
  const visibleSkills = input.skills.filter((skill) =>
    isRuntimeSkillVisibleTo(skill, { agentId: input.agentId })
  );
  if (input.selector === false) {
    return [];
  }
  if (input.selector === undefined || input.selector === true) {
    return visibleSkills;
  }

  const byId = new Map(visibleSkills.map((skill) => [skill.id, skill]));
  const ownByShortName = new Map(
    visibleSkills
      .filter((skill) => skill.ownerAgentId === input.agentId && skill.shortName !== undefined)
      .map((skill) => [skill.shortName as string, skill]),
  );
  const selectedSkills = new Map<string, RuntimeSkillDefinition>();

  for (const requested of input.selector) {
    const skill = ownByShortName.get(requested) ?? byId.get(requested);
    if (skill) {
      selectedSkills.set(skill.id, skill);
    }
  }

  return [...selectedSkills.values()];
}

/** Resolve a presence-aware runtime skill selector snapshot without throwing on explicit misses. */
export function resolveRuntimeSkillSelectorSnapshotForAgent(input: {
  skills: readonly RuntimeSkillDefinition[];
  agentId: string;
  selector: true | string[] | undefined;
}): ResolvedSkillSelectorSnapshot<RuntimeSkillDefinition> {
  return resolveSkillSelector({
    definitions: input.skills,
    selector: input.selector,
    getId: (skill) => skill.id,
    isVisible: (skill) => isRuntimeSkillVisibleTo(skill, { agentId: input.agentId }),
    getShortName: (skill) => skill.shortName,
    isOwnShortNameCandidate: (skill) => skill.ownerAgentId === input.agentId,
    getSourcePath: (skill) => skill.sourcePath,
  });
}

/** Resolve a presence-aware runtime skill selector snapshot and reject explicit misses. */
export function resolveRuntimeSkillSelectorForAgent(input: {
  skills: readonly RuntimeSkillDefinition[];
  agentId: string;
  selector: true | string[] | undefined;
}): ResolvedSkillSelectorSnapshot<RuntimeSkillDefinition> {
  const snapshot = resolveRuntimeSkillSelectorSnapshotForAgent(input);
  assertResolvedSkillSelector(snapshot);
  return snapshot;
}

/** Public API contract for runtime loaded skill response messages. */
export type RuntimeLoadedSkillResponseMessages = {
  allowedToolsNote: string;
  noCurrentRunToolsNote: string;
  unavailableCurrentRunToolsDelegationNote: string;
  overrideNote: string;
  referenceNote: string;
};

/** Response payload for runtime loaded skill. */
export type RuntimeLoadedSkillResponse = {
  skillId: string;
  instructions: string;
  nextStep: string;
  allowedTools?: string[];
  note?: string;
  delegationTools?: string[];
  unavailableCurrentRunTools?: string[];
  delegationNote?: string;
  model?: string;
  thinking?: false | number;
  maxSteps?: number;
  overrideNote?: string;
  references?: string[];
  referenceNote?: string;
};

/** Public API contract for runtime skill metadata logger. */
export type RuntimeSkillMetadataLogger = {
  error?: (message: string, metadata?: Record<string, unknown>) => void;
};

function getAvailableScopedDelegateToolNames(
  availableToolNameSet: ReadonlySet<string> | null,
): string[] {
  if (!availableToolNameSet) {
    return [];
  }

  return [...availableToolNameSet].filter((toolName) => toolName.startsWith("agent_")).sort();
}

function canUseLegacyInvokeAgent(availableToolNameSet: ReadonlySet<string> | null): boolean {
  return availableToolNameSet === null || availableToolNameSet.has("invoke_agent");
}

function hasAvailableDelegationTool(availableToolNameSet: ReadonlySet<string> | null): boolean {
  return availableToolNameSet === null || canUseLegacyInvokeAgent(availableToolNameSet) ||
    getAvailableScopedDelegateToolNames(availableToolNameSet).length > 0;
}

/** Public API contract for parsed runtime skill document. */
export type ParsedRuntimeSkillDocument = {
  metadata: RuntimeSkillFrontmatter;
  body: string;
};

function extractDescriptionFromMarkdown(content: string, fallback: string): string {
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const headerMatch = /^#+\s+(.+)$/.exec(trimmed);
    const description = (headerMatch?.[1] ?? trimmed).trim();

    if (description.length <= 100) {
      return description;
    }

    return `${description.slice(0, 97)}...`;
  }

  return fallback;
}

/** Parses runtime skill document. */
export function parseRuntimeSkillDocument(
  content: string,
  options: { logger?: RuntimeSkillMetadataLogger } = {},
): ParsedRuntimeSkillDocument | null {
  try {
    const parsed = extract<Record<string, unknown>>(content);
    const result = getRuntimeSkillFrontmatterSchema().safeParse(parsed.attrs);

    if (!result.success) {
      options.logger?.error?.("Invalid skill frontmatter; skipping skill", {
        error: result.issues?.map((i) => i.message).join("; ") ?? "validation failed",
      });
      return null;
    }

    return {
      metadata: result.data,
      body: parsed.body,
    };
  } catch (error) {
    options.logger?.error?.("Invalid skill frontmatter; skipping skill", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Parses runtime skill metadata. */
export function parseRuntimeSkillMetadata(
  content: string,
  options: { logger?: RuntimeSkillMetadataLogger } = {},
): RuntimeSkillFrontmatter | null {
  return parseRuntimeSkillDocument(content, options)?.metadata ?? null;
}

/** Definition for build runtime skill. */
export function buildRuntimeSkillDefinition(input: {
  id: string;
  content: string;
  references?: readonly string[];
  ownerAgentId?: string;
  shortName?: string;
  sourcePath?: string;
  logger?: RuntimeSkillMetadataLogger;
}): RuntimeSkillDefinition | null {
  if (!isRuntimeSkillIdValid(input)) {
    input.logger?.error?.("Invalid skill id; skipping skill", {
      id: input.id,
      error: input.ownerAgentId === undefined && input.shortName === undefined
        ? "must be lowercase alphanumeric with hyphens, 1-64 characters"
        : "must be provider-safe letters, numbers, underscores, or hyphens, 1-64 characters",
    });
    return null;
  }

  const document = parseRuntimeSkillDocument(input.content, { logger: input.logger });
  if (!document) {
    return null;
  }

  const { metadata, body } = document;
  const canonicalName = input.id;
  const explicitDisplayName = metadata.metadata?.display_name?.trim() || undefined;
  const legacyDisplayName = metadata.name && metadata.name !== canonicalName
    ? metadata.name
    : undefined;
  const displayName = explicitDisplayName ?? legacyDisplayName;

  return {
    id: input.id,
    name: canonicalName,
    ...(displayName ? { displayName } : {}),
    description: metadata.description ?? extractDescriptionFromMarkdown(body, input.id),
    instructions: input.content,
    allowedTools: metadata.allowedTools,
    ...(metadata.metadata ? { metadata: metadata.metadata } : {}),
    ...(metadata.model ? { model: metadata.model } : {}),
    ...(metadata.thinking !== undefined ? { thinking: metadata.thinking } : {}),
    ...(metadata.maxSteps !== undefined ? { maxSteps: metadata.maxSteps } : {}),
    ...(input.references && input.references.length > 0
      ? { references: [...input.references] }
      : {}),
    ...(input.ownerAgentId === undefined ? {} : { ownerAgentId: input.ownerAgentId }),
    ...(input.shortName === undefined ? {} : { shortName: input.shortName }),
    ...(input.sourcePath === undefined ? {} : { sourcePath: input.sourcePath }),
  };
}

function isRuntimeSkillIdValid(input: {
  id: string;
  ownerAgentId?: string;
  shortName?: string;
}): boolean {
  if (input.ownerAgentId !== undefined || input.shortName !== undefined) {
    return SKILL_PROVIDER_SAFE_ID_REGEX.test(input.id);
  }

  return SKILL_NAME_REGEX.test(input.id);
}

/** Normalizes runtime skill reference path. */
export function normalizeRuntimeSkillReferencePath(path: string): string | null {
  const normalized = path.trim().replaceAll("\\", "/");

  if (normalized.length === 0 || normalized.startsWith("/")) {
    return null;
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return null;
  }

  return segments.join("/");
}

/** Response payload for build runtime loaded skill. */
export function buildRuntimeLoadedSkillResponse(input: {
  skillId: string;
  instructions: string;
  nextStep: string;
  messages: RuntimeLoadedSkillResponseMessages;
  references?: readonly string[];
  availableToolNames?: readonly string[];
  logger?: RuntimeSkillMetadataLogger;
}): RuntimeLoadedSkillResponse {
  const metadata = parseRuntimeSkillMetadata(input.instructions, { logger: input.logger });
  const declaredAllowedTools = metadata?.allowedTools ?? [];
  const availableToolNameSet = input.availableToolNames !== undefined
    ? new Set(input.availableToolNames)
    : null;
  const currentRunAllowedTools = availableToolNameSet
    ? declaredAllowedTools.filter((toolName) => availableToolNameSet.has(toolName))
    : declaredAllowedTools;
  const unavailableCurrentRunTools = availableToolNameSet && declaredAllowedTools.length > 0
    ? declaredAllowedTools.filter((toolName) => !availableToolNameSet.has(toolName))
    : [];
  const hasOverrides = metadata?.model !== undefined || metadata?.thinking !== undefined ||
    metadata?.maxSteps !== undefined;
  const hasDeclaredAllowedTools = declaredAllowedTools.length > 0;

  return {
    skillId: input.skillId,
    instructions: input.instructions,
    nextStep: input.nextStep,
    ...(hasDeclaredAllowedTools
      ? {
        allowedTools: currentRunAllowedTools,
        note: currentRunAllowedTools.length > 0
          ? input.messages.allowedToolsNote
          : input.messages.noCurrentRunToolsNote,
      }
      : {}),
    ...(hasDeclaredAllowedTools ? { delegationTools: declaredAllowedTools } : {}),
    ...(unavailableCurrentRunTools.length > 0
      ? {
        unavailableCurrentRunTools,
        ...(hasAvailableDelegationTool(availableToolNameSet)
          ? { delegationNote: input.messages.unavailableCurrentRunToolsDelegationNote }
          : {}),
      }
      : {}),
    ...(metadata?.model ? { model: metadata.model } : {}),
    ...(metadata?.thinking !== undefined ? { thinking: metadata.thinking } : {}),
    ...(metadata?.maxSteps !== undefined ? { maxSteps: metadata.maxSteps } : {}),
    ...(hasOverrides && canUseLegacyInvokeAgent(availableToolNameSet)
      ? {
        overrideNote: input.messages.overrideNote,
      }
      : {}),
    ...(input.references && input.references.length > 0
      ? {
        references: [...input.references],
        referenceNote: input.messages.referenceNote,
      }
      : {}),
  };
}
