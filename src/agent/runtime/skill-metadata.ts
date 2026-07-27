import { extract } from "#std/front-matter/yaml.ts";
import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import {
  matchesAllowedTool,
  snapshotAllowedToolPatterns,
  validateStrictAllowedToolPatterns,
} from "#veryfront/skill/allowed-tools.ts";
import {
  SKILL_ALLOWED_TOOL_MAX_PATTERNS,
  SKILL_ALLOWED_TOOL_PATTERN_MAX_LENGTH,
  SKILL_DOCUMENT_MAX_CHARACTERS,
  SKILL_ID_MAX_LENGTH,
  SKILL_LOADABLE_REFERENCE_MAX_ENTRIES,
  SKILL_PATH_SEGMENT_MAX_LENGTH,
  SKILL_RELATIVE_PATH_MAX_LENGTH,
  SKILL_RUNTIME_AVAILABLE_TOOL_MAX_ENTRIES,
} from "#veryfront/skill/limits.ts";
import { validateSkillFileMetadata } from "#veryfront/skill/parser.ts";
import { SKILL_DESCRIPTION_MAX_LENGTH, SKILL_STRICT_NAME_REGEX } from "#veryfront/skill/types.ts";
import { hasControlCharacters, isWellFormedUtf16 } from "#veryfront/skill/string-safety.ts";

/** Maximum model identifier length accepted from hosted skill metadata. */
export const MAX_RUNTIME_SKILL_MODEL_LENGTH = 256;
/** Maximum thinking-token override accepted from hosted skill metadata. */
export const MAX_RUNTIME_SKILL_THINKING_TOKENS = 1_000_000;
/** Maximum delegated step override accepted from hosted skill metadata. */
export const MAX_RUNTIME_SKILL_STEPS = 1_000;
const RUNTIME_SKILL_ALLOWED_TOOLS_STRING_MAX_LENGTH =
  SKILL_ALLOWED_TOOL_MAX_PATTERNS * SKILL_ALLOWED_TOOL_PATTERN_MAX_LENGTH +
  SKILL_ALLOWED_TOOL_MAX_PATTERNS - 1;
const RUNTIME_WINDOWS_DRIVE_PATH_REGEX = /^[A-Za-z]:\//;
const UTF8_ENCODER = new TextEncoder();

/** Whether a hosted skill model override is a bounded, printable identifier. */
export function isValidRuntimeSkillModel(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return value.length > 0 &&
    value.length <= MAX_RUNTIME_SKILL_MODEL_LENGTH &&
    value === value.trim() &&
    isWellFormedUtf16(value) &&
    !hasControlCharacters(value);
}

function normalizeLegacyAllowedTools(value: string | string[] | undefined): string[] {
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

function normalizeStrictAllowedTools(value: string | string[]): string[] {
  const values = Array.isArray(value)
    ? value
    : value.includes(",")
    ? value.split(/[,\s]+/)
    : value.split(/\s+/);

  const patterns = values.map((entry) => entry.trim());
  if (Array.isArray(value) && patterns.some((entry) => entry.length === 0)) {
    throw new TypeError("Allowed-tools patterns must not be empty");
  }

  return validateStrictAllowedToolPatterns(patterns.filter((entry) => entry.length > 0));
}

// Hand-written transform output type. The contract DSL erases the parameter
// type through `.transform()`, so we annotate explicitly.
/** Public API contract for runtime skill frontmatter. */
export interface RuntimeSkillFrontmatter {
  name: string | undefined;
  description: string | undefined;
  allowedTools: string[];
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
      thinking: v.union([v.literal(false), v.coerce.number().int().positive()]).optional(),
      "max-steps": v.coerce.number().int().positive().optional(),
    })
    .passthrough()
    .transform((data): RuntimeSkillFrontmatter => {
      const d = data as Record<string, unknown>;
      return {
        name: (typeof d.name === "string" ? d.name.trim() : undefined) || undefined,
        description: (typeof d.description === "string" ? d.description.trim() : undefined) ||
          undefined,
        allowedTools: normalizeLegacyAllowedTools(
          (d["allowed-tools"] ?? d.allowed_tools) as string | string[] | undefined,
        ),
        model: (typeof d.model === "string" ? d.model.trim() : undefined) || undefined,
        thinking: d.thinking as false | number | undefined,
        maxSteps: d["max-steps"] as number | undefined,
      };
    })
);

const getStrictRuntimeSkillFrontmatterSchema = defineSchema((v) => {
  const allowedToolsValue = v.union([
    v.string().max(RUNTIME_SKILL_ALLOWED_TOOLS_STRING_MAX_LENGTH),
    v.array(v.string().min(1).max(SKILL_ALLOWED_TOOL_PATTERN_MAX_LENGTH)).max(
      SKILL_ALLOWED_TOOL_MAX_PATTERNS,
    ),
  ]);

  return v
    .object({
      name: v.string().max(SKILL_ID_MAX_LENGTH).optional(),
      description: v.string().max(SKILL_DESCRIPTION_MAX_LENGTH).optional(),
      "allowed-tools": allowedToolsValue.optional(),
      allowed_tools: allowedToolsValue.optional(),
      model: v.string().max(MAX_RUNTIME_SKILL_MODEL_LENGTH).refine(
        (model) => isValidRuntimeSkillModel(model),
        "Skill model must be a non-empty, trimmed identifier without control characters",
      ).optional(),
      thinking: v.union([
        v.literal(false),
        v.coerce.number().int().positive().max(MAX_RUNTIME_SKILL_THINKING_TOKENS),
      ]).optional(),
      "max-steps": v.coerce.number().int().positive().max(MAX_RUNTIME_SKILL_STEPS).optional(),
    })
    .passthrough()
    .superRefine((data, context) => {
      const d = data as Record<string, unknown>;
      const hasCanonicalAllowedTools = Object.prototype.hasOwnProperty.call(d, "allowed-tools");
      const hasCompatibilityAllowedTools = Object.prototype.hasOwnProperty.call(d, "allowed_tools");

      if (hasCanonicalAllowedTools && hasCompatibilityAllowedTools) {
        context.addIssue({
          message: 'Skill must not declare both "allowed-tools" and "allowed_tools"',
        });
        return;
      }

      const rawAllowedTools = hasCanonicalAllowedTools
        ? d["allowed-tools"]
        : hasCompatibilityAllowedTools
        ? d.allowed_tools
        : undefined;
      if (rawAllowedTools !== undefined) {
        try {
          normalizeStrictAllowedTools(rawAllowedTools as string | string[]);
        } catch (error) {
          context.addIssue({
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })
    .transform((data): RuntimeSkillFrontmatter => {
      const d = data as Record<string, unknown>;
      const hasCanonicalAllowedTools = Object.prototype.hasOwnProperty.call(d, "allowed-tools");
      const hasCompatibilityAllowedTools = Object.prototype.hasOwnProperty.call(d, "allowed_tools");
      const rawAllowedTools = hasCanonicalAllowedTools ? d["allowed-tools"] : d.allowed_tools;

      return {
        name: (typeof d.name === "string" ? d.name.trim() : undefined) || undefined,
        description: (typeof d.description === "string" ? d.description.trim() : undefined) ||
          undefined,
        allowedTools: hasCanonicalAllowedTools || hasCompatibilityAllowedTools
          ? normalizeStrictAllowedTools(rawAllowedTools as string | string[])
          : [],
        model: (typeof d.model === "string" ? d.model.trim() : undefined) || undefined,
        thinking: d.thinking as false | number | undefined,
        maxSteps: d["max-steps"] as number | undefined,
      };
    });
});

/** Schema for runtime skill frontmatter.
 * @deprecated Use getRuntimeSkillFrontmatterSchema()
 */
export const RuntimeSkillFrontmatterSchema = lazySchema(getRuntimeSkillFrontmatterSchema);

/** Definition for runtime skill. */
export type RuntimeSkillDefinition = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  allowedTools: string[];
  /**
   * Serializable discriminator used by strict runtime catalogs to distinguish
   * an omitted policy from an explicitly empty deny-all policy. Legacy/public
   * definitions may omit it; a non-empty allowedTools array still implies a
   * declared policy.
   */
  allowedToolsDeclared?: boolean;
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
 * Catalog-policy check that preserves the legacy public definition contract.
 *
 * Non-empty arrays always describe a policy. Strict builders persist the
 * omitted-versus-empty distinction in an additive serializable discriminator;
 * legacy definitions without it retain their historical empty-array
 * interpretation until their instructions are loaded and parsed.
 */
export function hasRuntimeSkillAllowedToolsPolicy(
  definition: RuntimeSkillDefinition,
): boolean {
  if (definition.allowedTools.length > 0) return true;
  return definition.allowedToolsDeclared === true;
}

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

function snapshotAvailableRuntimeToolNames(
  value: readonly string[] | undefined,
): ReadonlySet<string> | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) {
    throw new TypeError("Runtime availableToolNames must be an array");
  }
  if (value.length > SKILL_RUNTIME_AVAILABLE_TOOL_MAX_ENTRIES) {
    throw new RangeError(
      `Runtime availableToolNames accepts at most ${SKILL_RUNTIME_AVAILABLE_TOOL_MAX_ENTRIES} entries`,
    );
  }

  const snapshot = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (
      !descriptor ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "string" ||
      descriptor.value.length === 0 ||
      descriptor.value.length > SKILL_ALLOWED_TOOL_PATTERN_MAX_LENGTH ||
      !isWellFormedUtf16(descriptor.value) ||
      hasControlCharacters(descriptor.value)
    ) {
      throw new TypeError(`Runtime available tool name ${index} is invalid`);
    }
    snapshot.add(descriptor.value);
  }
  return snapshot;
}

/** Public API contract for parsed runtime skill document. */
export type ParsedRuntimeSkillDocument = {
  metadata: RuntimeSkillFrontmatter;
  body: string;
};

type ParsedRuntimeSkillSource = {
  document: ParsedRuntimeSkillDocument;
  frontmatter: Record<string, unknown>;
  allowedToolsDeclared: boolean;
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

function hasDeclaredAllowedTools(frontmatter: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(frontmatter, "allowed-tools") ||
    Object.prototype.hasOwnProperty.call(frontmatter, "allowed_tools");
}

function parseLegacyRuntimeSkillSource(
  content: string,
  options: { logger?: RuntimeSkillMetadataLogger } = {},
): ParsedRuntimeSkillSource | null {
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
      document: {
        metadata: result.data,
        body: parsed.body,
      },
      frontmatter: parsed.attrs,
      allowedToolsDeclared: hasDeclaredAllowedTools(parsed.attrs),
    };
  } catch (error) {
    options.logger?.error?.("Invalid skill frontmatter; skipping skill", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function parseStrictRuntimeSkillSource(
  content: string,
  options: { logger?: RuntimeSkillMetadataLogger } = {},
): ParsedRuntimeSkillSource | null {
  try {
    if (typeof content !== "string") {
      throw new TypeError("Skill document content must be a string");
    }
    if (!isWellFormedUtf16(content)) {
      throw new TypeError("Skill document content must contain well-formed UTF-16");
    }
    if (content.length > SKILL_DOCUMENT_MAX_CHARACTERS) {
      throw new RangeError(
        `Skill document exceeds ${SKILL_DOCUMENT_MAX_CHARACTERS} characters`,
      );
    }

    const parsed = extract<Record<string, unknown>>(content);
    const result = getStrictRuntimeSkillFrontmatterSchema().safeParse(parsed.attrs);
    if (!result.success) {
      options.logger?.error?.("Invalid skill frontmatter; skipping skill", {
        error: result.issues?.map((i) => i.message).join("; ") ?? "validation failed",
      });
      return null;
    }

    return {
      document: {
        metadata: result.data,
        body: parsed.body,
      },
      frontmatter: parsed.attrs,
      allowedToolsDeclared: hasDeclaredAllowedTools(parsed.attrs),
    };
  } catch (error) {
    options.logger?.error?.("Invalid skill frontmatter; skipping skill", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Parses runtime skill document. */
export function parseRuntimeSkillDocument(
  content: string,
  options: { logger?: RuntimeSkillMetadataLogger } = {},
): ParsedRuntimeSkillDocument | null {
  return parseLegacyRuntimeSkillSource(content, options)?.document ?? null;
}

/** Parses runtime skill metadata. */
export function parseRuntimeSkillMetadata(
  content: string,
  options: { logger?: RuntimeSkillMetadataLogger } = {},
): RuntimeSkillFrontmatter | null {
  return parseRuntimeSkillDocument(content, options)?.metadata ?? null;
}

/** Strict runtime-boundary parser for hosted and filesystem skill metadata. */
export function parseStrictRuntimeSkillMetadata(
  content: string,
  options: { logger?: RuntimeSkillMetadataLogger } = {},
): RuntimeSkillFrontmatter | null {
  return parseStrictRuntimeSkillSource(content, options)?.document.metadata ?? null;
}

type BuildRuntimeSkillDefinitionInput = {
  id: string;
  content: string;
  references?: readonly string[];
  ownerAgentId?: string;
  shortName?: string;
  sourcePath?: string;
  logger?: RuntimeSkillMetadataLogger;
};

function isBoundedRuntimeIdentity(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= SKILL_ID_MAX_LENGTH &&
    isWellFormedUtf16(value) &&
    !hasControlCharacters(value) &&
    !value.includes("/") &&
    !value.includes("\\");
}

function normalizeRuntimeSkillSourcePath(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > SKILL_RELATIVE_PATH_MAX_LENGTH ||
    UTF8_ENCODER.encode(value).byteLength > SKILL_RELATIVE_PATH_MAX_LENGTH ||
    value !== value.trim() ||
    value.includes("\\") ||
    !isWellFormedUtf16(value) ||
    hasControlCharacters(value) ||
    value.startsWith("/") ||
    RUNTIME_WINDOWS_DRIVE_PATH_REGEX.test(value)
  ) {
    return null;
  }

  const segments = value.split("/");
  if (
    segments.some((segment) =>
      segment.length === 0 ||
      segment.length > SKILL_PATH_SEGMENT_MAX_LENGTH ||
      segment === "." ||
      segment === ".."
    )
  ) {
    return null;
  }
  return value;
}

function snapshotRuntimeSkillReferences(
  references: readonly string[] | undefined,
): string[] | null | undefined {
  if (references === undefined) return undefined;
  if (
    !Array.isArray(references) ||
    references.length > SKILL_LOADABLE_REFERENCE_MAX_ENTRIES
  ) {
    return null;
  }

  const normalized = new Set<string>();
  for (const reference of references) {
    const value = normalizeStrictRuntimeSkillReferencePath(reference);
    if (value === null) return null;
    normalized.add(value);
  }
  return Object.freeze([...normalized].sort()) as string[];
}

type ParsedRuntimeSkillBuildDocument = {
  document: ParsedRuntimeSkillDocument;
  allowedToolsDeclared: boolean;
};

function parseRuntimeSkillDirectoryDocument(
  content: string,
  directoryName: string,
  logger?: RuntimeSkillMetadataLogger,
): ParsedRuntimeSkillBuildDocument | null {
  const source = parseStrictRuntimeSkillSource(content, { logger });
  if (!source) {
    return null;
  }

  try {
    const metadata = validateSkillFileMetadata(source.frontmatter, directoryName);
    return {
      document: {
        body: source.document.body,
        metadata: {
          ...source.document.metadata,
          name: metadata.name,
          description: metadata.description,
          allowedTools: metadata.allowedTools === undefined
            ? []
            : snapshotAllowedToolPatterns(metadata.allowedTools),
        },
      },
      allowedToolsDeclared: metadata.allowedTools !== undefined,
    };
  } catch (error) {
    logger?.error?.("Invalid skill frontmatter; skipping skill", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function buildRuntimeSkillDefinitionFromDocument(
  input: BuildRuntimeSkillDefinitionInput,
  parsed: ParsedRuntimeSkillBuildDocument | null,
): RuntimeSkillDefinition | null {
  if (!parsed) {
    return null;
  }
  if (!isBoundedRuntimeIdentity(input.id)) {
    input.logger?.error?.("Invalid runtime skill id; skipping skill", {
      skillId: input.id,
    });
    return null;
  }
  if (
    (input.ownerAgentId === undefined) !== (input.shortName === undefined) ||
    (input.ownerAgentId !== undefined && !isBoundedRuntimeIdentity(input.ownerAgentId)) ||
    (input.shortName !== undefined && !SKILL_STRICT_NAME_REGEX.test(input.shortName))
  ) {
    input.logger?.error?.("Invalid runtime skill ownership; skipping skill", {
      skillId: input.id,
    });
    return null;
  }
  const sourcePath = input.sourcePath === undefined
    ? undefined
    : normalizeRuntimeSkillSourcePath(input.sourcePath);
  if (sourcePath === null) {
    input.logger?.error?.("Invalid runtime skill source path; skipping skill", {
      skillId: input.id,
    });
    return null;
  }
  const references = snapshotRuntimeSkillReferences(input.references);
  if (references === null) {
    input.logger?.error?.("Invalid runtime skill references; skipping skill", {
      skillId: input.id,
    });
    return null;
  }

  const { metadata, body } = parsed.document;

  const definition: RuntimeSkillDefinition = {
    id: input.id,
    name: metadata.name ?? input.id,
    description: metadata.description ?? extractDescriptionFromMarkdown(body, input.id),
    instructions: input.content,
    allowedTools: snapshotAllowedToolPatterns(metadata.allowedTools),
    allowedToolsDeclared: parsed.allowedToolsDeclared,
    ...(metadata.model ? { model: metadata.model } : {}),
    ...(metadata.thinking !== undefined ? { thinking: metadata.thinking } : {}),
    ...(metadata.maxSteps !== undefined ? { maxSteps: metadata.maxSteps } : {}),
    ...(references && references.length > 0 ? { references } : {}),
    ...(input.ownerAgentId === undefined ? {} : { ownerAgentId: input.ownerAgentId }),
    ...(input.shortName === undefined ? {} : { shortName: input.shortName }),
    ...(sourcePath === undefined ? {} : { sourcePath }),
  };
  return Object.freeze(definition);
}

function parseRuntimeSkillBuildDocument(
  content: string,
  logger?: RuntimeSkillMetadataLogger,
): ParsedRuntimeSkillBuildDocument | null {
  const source = parseStrictRuntimeSkillSource(content, { logger });
  return source
    ? {
      document: source.document,
      allowedToolsDeclared: source.allowedToolsDeclared,
    }
    : null;
}

/**
 * Build a runtime skill definition through the historical public contract.
 *
 * Programmatic callers may omit file-only metadata such as `name` and
 * `description`; those values retain their documented fallbacks. Filesystem
 * discovery uses `buildRuntimeDirectorySkillDefinition` below instead.
 */
export function buildRuntimeSkillDefinition(
  input: BuildRuntimeSkillDefinitionInput,
): RuntimeSkillDefinition | null {
  const source = parseLegacyRuntimeSkillSource(input.content, { logger: input.logger });
  if (!source) return null;

  const { metadata, body } = source.document;
  return {
    id: input.id,
    name: metadata.name ?? input.id,
    description: metadata.description ?? extractDescriptionFromMarkdown(body, input.id),
    instructions: input.content,
    allowedTools: metadata.allowedTools,
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

/** Build a strict, immutable Agent Skills directory definition for discovery. */
export function buildRuntimeDirectorySkillDefinition(
  input: BuildRuntimeSkillDefinitionInput,
): RuntimeSkillDefinition | null {
  const directoryName = input.shortName ?? input.id;
  return buildRuntimeSkillDefinitionFromDocument(
    input,
    parseRuntimeSkillDirectoryDocument(input.content, directoryName, input.logger),
  );
}

/**
 * Build a legacy flat-file runtime skill.
 *
 * Flat `{skillsPath}/{id}.md` files predate the Agent Skills directory
 * contract. They may omit `name` and `description`, which are derived from the
 * file id and first Markdown line. New `SKILL.md` files must use
 * `buildRuntimeDirectorySkillDefinition` and satisfy the strict core contract.
 */
export function buildLegacyRuntimeFlatSkillDefinition(
  input: BuildRuntimeSkillDefinitionInput,
): RuntimeSkillDefinition | null {
  return buildRuntimeSkillDefinitionFromDocument(
    input,
    parseRuntimeSkillBuildDocument(input.content, input.logger),
  );
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

/** Strict runtime-boundary normalizer for hosted and filesystem reference paths. */
export function normalizeStrictRuntimeSkillReferencePath(path: string): string | null {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.length > SKILL_RELATIVE_PATH_MAX_LENGTH ||
    UTF8_ENCODER.encode(path).byteLength > SKILL_RELATIVE_PATH_MAX_LENGTH ||
    !isWellFormedUtf16(path) ||
    hasControlCharacters(path)
  ) {
    return null;
  }
  const normalized = normalizeRuntimeSkillReferencePath(path);

  if (
    normalized === null ||
    RUNTIME_WINDOWS_DRIVE_PATH_REGEX.test(normalized)
  ) {
    return null;
  }

  const segments = normalized.split("/");
  if (
    segments.some((segment) =>
      segment.length > SKILL_PATH_SEGMENT_MAX_LENGTH ||
      segment.length === 0
    )
  ) {
    return null;
  }

  return segments.join("/");
}

type BuildRuntimeLoadedSkillResponseInput = {
  skillId: string;
  instructions: string;
  nextStep: string;
  messages: RuntimeLoadedSkillResponseMessages;
  references?: readonly string[];
  availableToolNames?: readonly string[];
  logger?: RuntimeSkillMetadataLogger;
};

/**
 * Build a loaded-skill response through the historical public contract.
 *
 * Runtime loading of untrusted hosted or filesystem content uses
 * `buildStrictRuntimeLoadedSkillResponse` below.
 */
export function buildRuntimeLoadedSkillResponse(
  input: BuildRuntimeLoadedSkillResponseInput,
): RuntimeLoadedSkillResponse {
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

/** Build a bounded loaded-skill response at hosted and filesystem trust boundaries. */
export function buildStrictRuntimeLoadedSkillResponse(
  input: BuildRuntimeLoadedSkillResponseInput,
): RuntimeLoadedSkillResponse {
  if (!isBoundedRuntimeIdentity(input.skillId)) {
    throw new TypeError("Runtime loaded skill response skillId is invalid");
  }
  if (
    typeof input.instructions !== "string" ||
    input.instructions.length > SKILL_DOCUMENT_MAX_CHARACTERS
  ) {
    throw new RangeError(
      `Runtime loaded skill instructions must be at most ${SKILL_DOCUMENT_MAX_CHARACTERS} characters`,
    );
  }
  const references = snapshotRuntimeSkillReferences(input.references);
  if (references === null) {
    throw new TypeError("Runtime loaded skill references are invalid");
  }
  const parsedSource = parseStrictRuntimeSkillSource(input.instructions, { logger: input.logger });
  const metadata = parsedSource?.document.metadata ?? null;
  const invalidMetadata = parsedSource === null;
  const declaredAllowedTools = metadata?.allowedTools ?? [];
  const availableToolNameSet = snapshotAvailableRuntimeToolNames(input.availableToolNames);
  const isAvailableAllowedToolPattern = (pattern: string): boolean => {
    if (availableToolNameSet === null) return false;
    for (const toolName of availableToolNameSet) {
      if (matchesAllowedTool(toolName, pattern)) return true;
    }
    return false;
  };
  const currentRunAllowedTools = availableToolNameSet
    ? declaredAllowedTools.filter(isAvailableAllowedToolPattern)
    : declaredAllowedTools;
  const unavailableCurrentRunTools = availableToolNameSet && declaredAllowedTools.length > 0
    ? declaredAllowedTools.filter((pattern) => !isAvailableAllowedToolPattern(pattern))
    : [];
  const hasOverrides = metadata?.model !== undefined || metadata?.thinking !== undefined ||
    metadata?.maxSteps !== undefined;
  const hasDeclaredAllowedTools = invalidMetadata || parsedSource.allowedToolsDeclared;

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
    ...(references && references.length > 0
      ? {
        references: [...references],
        referenceNote: input.messages.referenceNote,
      }
      : {}),
  };
}
