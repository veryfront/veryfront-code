import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import { snapshotThrowableDiagnostic } from "#veryfront/errors/safe-diagnostics.ts";
import { snapshotVeryfrontError } from "#veryfront/errors/types.ts";
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import {
  type SkillDocumentParserProvider,
  SkillDocumentParserProviderName,
  snapshotSkillDocumentParserProvider,
} from "#veryfront/extensions/parser/skill-document-parser.ts";
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
import {
  parseBoundedSkillDocument,
  type ParsedSkillContent,
} from "#veryfront/skill/document-parser.ts";
import { validateSkillFileMetadata } from "#veryfront/skill/parser.ts";
import {
  assertResolvedSkillSelector,
  type ResolvedSkillSelectorSnapshot,
  resolveSkillSelector,
} from "#veryfront/skill/selector.ts";
import {
  isValidProviderSafeSkillId,
  isValidSkillName,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_METADATA_KEY_MAX_LENGTH,
  SKILL_METADATA_MAX_ENTRIES,
  SKILL_METADATA_VALUE_MAX_LENGTH,
  type SkillMetadata,
} from "#veryfront/skill/types.ts";
import { hasControlCharacters, isWellFormedUtf16 } from "#veryfront/skill/string-safety.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";

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

function normalizeStrictMetadata(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Skill metadata must be an object with string values");
  }

  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError("Skill metadata keys must be readable");
  }
  if (keys.length === 0) return undefined;
  if (keys.length > SKILL_METADATA_MAX_ENTRIES) {
    throw new RangeError(`Skill metadata accepts at most ${SKILL_METADATA_MAX_ENTRIES} entries`);
  }

  const metadata: Record<string, string> = {};
  for (const key of keys) {
    if (
      typeof key !== "string" ||
      key.length === 0 ||
      key.length > SKILL_METADATA_KEY_MAX_LENGTH ||
      !isWellFormedUtf16(key) ||
      hasControlCharacters(key)
    ) {
      throw new TypeError(
        `Skill metadata keys must be 1-${SKILL_METADATA_KEY_MAX_LENGTH} printable characters`,
      );
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      throw new TypeError(`Skill metadata field "${key}" must be a data property`);
    }
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") {
      throw new TypeError(`Skill metadata field "${key}" must be a string data property`);
    }
    if (
      descriptor.value.length > SKILL_METADATA_VALUE_MAX_LENGTH ||
      !isWellFormedUtf16(descriptor.value) ||
      hasControlCharacters(descriptor.value)
    ) {
      throw new TypeError(
        `Skill metadata values must be at most ${SKILL_METADATA_VALUE_MAX_LENGTH} printable characters`,
      );
    }
    Object.defineProperty(metadata, key, {
      configurable: false,
      enumerable: true,
      value: descriptor.value,
      writable: false,
    });
  }
  return Object.freeze(metadata);
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

const getUnsafeLegacyRuntimeSkillFrontmatterSchema = defineSchema((v) =>
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
        allowedTools: normalizeLegacyAllowedTools(
          (d["allowed-tools"] ?? d.allowed_tools) as string | string[] | undefined,
        ),
        metadata,
        model: (typeof d.model === "string" ? d.model.trim() : undefined) || undefined,
        thinking: d.thinking as false | number | undefined,
        maxSteps: d["max-steps"] as number | undefined,
      };
    })
);

/** Strict schema factory for bounded runtime skill frontmatter. */
export const getRuntimeSkillFrontmatterSchema = defineSchema((v) => {
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
      metadata: v.record(v.string(), v.unknown()).optional(),
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
            message: snapshotThrowableDiagnostic(error),
          });
        }
      }
      try {
        normalizeStrictMetadata(d.metadata);
      } catch (error) {
        context.addIssue({
          message: snapshotThrowableDiagnostic(error),
        });
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
        metadata: normalizeStrictMetadata(d.metadata),
        model: (typeof d.model === "string" ? d.model.trim() : undefined) || undefined,
        thinking: d.thinking as false | number | undefined,
        maxSteps: d["max-steps"] as number | undefined,
      };
    });
});

/** Schema for runtime skill frontmatter.
 * @deprecated Use {@link getRuntimeSkillFrontmatterSchema}.
 */
export const RuntimeSkillFrontmatterSchema = lazySchema(
  getUnsafeLegacyRuntimeSkillFrontmatterSchema,
);

/** Definition for runtime skill. */
export type RuntimeSkillDefinition = {
  id: string;
  name: string;
  displayName?: string;
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
  selector: true | false | readonly string[] | undefined;
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
  selector: true | readonly string[] | undefined;
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
  selector: true | readonly string[] | undefined;
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

/** Composition options for synchronous runtime Skill document parsing. */
export type RuntimeSkillMetadataParseOptions = {
  logger?: RuntimeSkillMetadataLogger;
  skillDocumentParserProvider?: SkillDocumentParserProvider;
};

function canUseLegacyInvokeAgent(availableToolNameSet: ReadonlySet<string> | null): boolean {
  return availableToolNameSet?.has("invoke_agent") === true;
}

function canUnsafeLegacyUseInvokeAgent(
  availableToolNameSet: ReadonlySet<string> | null,
): boolean {
  return availableToolNameSet === null || availableToolNameSet.has("invoke_agent");
}

function hasUnsafeLegacyAvailableDelegationTool(
  availableToolNameSet: ReadonlySet<string> | null,
): boolean {
  if (availableToolNameSet === null || availableToolNameSet.has("invoke_agent")) return true;
  for (const toolName of availableToolNameSet) {
    if (toolName.startsWith("agent_")) return true;
  }
  return false;
}

function isDelegationToolName(toolName: string): boolean {
  return toolName === "invoke_agent" || toolName.startsWith("agent_");
}

function isToolAllowedByResolvedPolicy(
  toolName: string,
  declaredAllowedTools: readonly string[],
  hasDeclaredAllowedTools: boolean,
): boolean {
  return !hasDeclaredAllowedTools ||
    declaredAllowedTools.some((pattern) => matchesAllowedTool(toolName, pattern));
}

function hasAllowedAvailableDelegationTool(
  availableToolNameSet: ReadonlySet<string> | null,
  declaredAllowedTools: readonly string[],
  hasDeclaredAllowedTools: boolean,
): boolean {
  if (availableToolNameSet === null) return false;
  for (const toolName of availableToolNameSet) {
    if (
      isDelegationToolName(toolName) &&
      isToolAllowedByResolvedPolicy(
        toolName,
        declaredAllowedTools,
        hasDeclaredAllowedTools,
      )
    ) {
      return true;
    }
  }
  return false;
}

function snapshotAvailableRuntimeToolNames(
  value: readonly string[] | undefined,
): ReadonlySet<string> | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) {
    throw new TypeError("Runtime availableToolNames must be an array");
  }
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  } catch {
    throw new TypeError("Runtime availableToolNames length must be a data property");
  }
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new TypeError("Runtime availableToolNames length must be a data property");
  }
  if (length > SKILL_RUNTIME_AVAILABLE_TOOL_MAX_ENTRIES) {
    throw new RangeError(
      `Runtime availableToolNames accepts at most ${SKILL_RUNTIME_AVAILABLE_TOOL_MAX_ENTRIES} entries`,
    );
  }

  const snapshot = new Set<string>();
  for (let index = 0; index < length; index += 1) {
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
  options: RuntimeSkillMetadataParseOptions = {},
): ParsedRuntimeSkillSource | null {
  const configuredProvider = options.skillDocumentParserProvider === undefined
    ? tryResolve<SkillDocumentParserProvider>(SkillDocumentParserProviderName)
    : options.skillDocumentParserProvider;
  const parser = configuredProvider === undefined
    ? undefined
    : snapshotSkillDocumentParserProvider(configuredProvider);
  try {
    // Compatibility applies only to the legacy metadata shape. Document
    // splitting, bounds, and YAML decoding remain on the strict extension-owned
    // parser contract; core never falls back to a private YAML grammar.
    const parsed = parseBoundedSkillDocument(
      content,
      parser,
    );
    const result = getUnsafeLegacyRuntimeSkillFrontmatterSchema().safeParse(parsed.frontmatter);

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
      frontmatter: parsed.frontmatter,
      allowedToolsDeclared: hasDeclaredAllowedTools(parsed.frontmatter),
    };
  } catch (error) {
    if (snapshotVeryfrontError(error)?.slug === "missing-extension") {
      throw error;
    }
    options.logger?.error?.("Invalid skill frontmatter; skipping skill", {
      error: snapshotThrowableDiagnostic(error),
    });
    return null;
  }
}

function parseStrictRuntimeSkillSource(
  content: string,
  options: RuntimeSkillMetadataParseOptions = {},
): ParsedRuntimeSkillSource | null {
  const configuredProvider = options.skillDocumentParserProvider === undefined
    ? tryResolve<SkillDocumentParserProvider>(SkillDocumentParserProviderName)
    : options.skillDocumentParserProvider;
  const parser = configuredProvider === undefined
    ? undefined
    : snapshotSkillDocumentParserProvider(configuredProvider);
  try {
    const parsed: ParsedSkillContent = parseBoundedSkillDocument(
      content,
      parser,
    );
    const result = getRuntimeSkillFrontmatterSchema().safeParse(parsed.frontmatter);
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
      frontmatter: parsed.frontmatter,
      allowedToolsDeclared: hasDeclaredAllowedTools(parsed.frontmatter),
    };
  } catch (error) {
    if (snapshotVeryfrontError(error)?.slug === "missing-extension") {
      throw error;
    }
    options.logger?.error?.("Invalid skill frontmatter; skipping skill", {
      error: snapshotThrowableDiagnostic(error),
    });
    return null;
  }
}

type ParsedStrictRuntimeSkillFileSource = {
  source: ParsedRuntimeSkillSource;
  metadata: SkillMetadata;
};

function parseStrictRuntimeSkillFileSource(
  content: string,
  canonicalName: string,
  options: RuntimeSkillMetadataParseOptions,
  providerSafeName = false,
): ParsedStrictRuntimeSkillFileSource | null {
  const source = parseStrictRuntimeSkillSource(content, options);
  if (!source) return null;

  try {
    return {
      source,
      metadata: validateSkillFileMetadata(source.frontmatter, canonicalName, {
        providerSafeName,
      }),
    };
  } catch (error) {
    options.logger?.error?.("Invalid skill frontmatter; skipping skill", {
      error: snapshotThrowableDiagnostic(error),
    });
    return null;
  }
}

/** Validate one bounded Agent Skills file from a single decoded snapshot. */
export function isValidStrictRuntimeSkillFileDocument(
  content: string,
  canonicalName: string,
  options: RuntimeSkillMetadataParseOptions = {},
): boolean {
  return parseStrictRuntimeSkillFileSource(content, canonicalName, options) !== null;
}

/**
 * Parses runtime skill document through the historical permissive contract.
 *
 * @deprecated Use {@link parseRuntimeSkillDocument}.
 */
export function parseUnsafeLegacyRuntimeSkillDocument(
  content: string,
  options: RuntimeSkillMetadataParseOptions = {},
): ParsedRuntimeSkillDocument | null {
  return parseLegacyRuntimeSkillSource(content, options)?.document ?? null;
}

/**
 * Parses runtime skill metadata through the historical permissive contract.
 *
 * @deprecated Use {@link parseRuntimeSkillMetadata}.
 */
export function parseUnsafeLegacyRuntimeSkillMetadata(
  content: string,
  options: RuntimeSkillMetadataParseOptions = {},
): RuntimeSkillFrontmatter | null {
  return parseUnsafeLegacyRuntimeSkillDocument(content, options)?.metadata ?? null;
}

/** Parses a bounded runtime skill document and fails closed on invalid input. */
export function parseStrictRuntimeSkillDocument(
  content: string,
  options: RuntimeSkillMetadataParseOptions = {},
): ParsedRuntimeSkillDocument | null {
  return parseStrictRuntimeSkillSource(content, options)?.document ?? null;
}

/** Strict runtime-boundary parser for hosted and filesystem skill metadata. */
export function parseStrictRuntimeSkillMetadata(
  content: string,
  options: RuntimeSkillMetadataParseOptions = {},
): RuntimeSkillFrontmatter | null {
  return parseStrictRuntimeSkillDocument(content, options)?.metadata ?? null;
}

/** Parses a bounded runtime skill document and fails closed on invalid input. */
export function parseRuntimeSkillDocument(
  content: string,
  options: RuntimeSkillMetadataParseOptions = {},
): ParsedRuntimeSkillDocument | null {
  return parseStrictRuntimeSkillDocument(content, options);
}

/** Parses bounded runtime skill metadata and fails closed on invalid input. */
export function parseRuntimeSkillMetadata(
  content: string,
  options: RuntimeSkillMetadataParseOptions = {},
): RuntimeSkillFrontmatter | null {
  return parseStrictRuntimeSkillMetadata(content, options);
}

type BuildRuntimeSkillDefinitionInput = {
  id: string;
  content: string;
  references?: readonly string[];
  ownerAgentId?: string;
  shortName?: string;
  sourcePath?: string;
  logger?: RuntimeSkillMetadataLogger;
  skillDocumentParserProvider?: SkillDocumentParserProvider;
};

function readOwnDataInputProperty(
  input: unknown,
  key: PropertyKey,
  label: string,
  required: boolean,
): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`${label} must be an object`);
  }
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(input, key);
  } catch {
    throw new TypeError(`${label}.${String(key)} must be a data property`);
  }
  if (descriptor === undefined) {
    if (required) {
      throw new TypeError(`${label}.${String(key)} must be a data property`);
    }
    return undefined;
  }
  if (!("value" in descriptor)) {
    throw new TypeError(`${label}.${String(key)} must be a data property`);
  }
  return descriptor.value;
}

function snapshotRuntimeSkillDefinitionInput(
  input: BuildRuntimeSkillDefinitionInput,
): BuildRuntimeSkillDefinitionInput {
  return Object.freeze({
    id: readOwnDataInputProperty(input, "id", "Runtime skill definition", true) as string,
    content: readOwnDataInputProperty(
      input,
      "content",
      "Runtime skill definition",
      true,
    ) as string,
    references: readOwnDataInputProperty(
      input,
      "references",
      "Runtime skill definition",
      false,
    ) as readonly string[] | undefined,
    ownerAgentId: readOwnDataInputProperty(
      input,
      "ownerAgentId",
      "Runtime skill definition",
      false,
    ) as string | undefined,
    shortName: readOwnDataInputProperty(
      input,
      "shortName",
      "Runtime skill definition",
      false,
    ) as string | undefined,
    sourcePath: readOwnDataInputProperty(
      input,
      "sourcePath",
      "Runtime skill definition",
      false,
    ) as string | undefined,
    logger: readOwnDataInputProperty(
      input,
      "logger",
      "Runtime skill definition",
      false,
    ) as RuntimeSkillMetadataLogger | undefined,
    skillDocumentParserProvider: readOwnDataInputProperty(
      input,
      "skillDocumentParserProvider",
      "Runtime skill definition",
      false,
    ) as SkillDocumentParserProvider | undefined,
  });
}

function isBoundedRuntimeIdentity(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= SKILL_ID_MAX_LENGTH &&
    isWellFormedUtf16(value) &&
    !hasControlCharacters(value) &&
    !value.includes("/") &&
    !value.includes("\\");
}

function isRuntimeSkillIdValid(input: {
  id: unknown;
  ownerAgentId?: unknown;
  shortName?: unknown;
}): boolean {
  const isOwned = input.ownerAgentId !== undefined || input.shortName !== undefined;
  if (isOwned) {
    return input.ownerAgentId !== undefined &&
      input.shortName !== undefined &&
      isBoundedRuntimeIdentity(input.ownerAgentId) &&
      isValidProviderSafeSkillId(input.shortName) &&
      isValidProviderSafeSkillId(input.id);
  }
  return isValidSkillName(input.id);
}

function normalizeRuntimeSkillSourcePath(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > SKILL_RELATIVE_PATH_MAX_LENGTH ||
    utf8ByteLength(value, SKILL_RELATIVE_PATH_MAX_LENGTH) >
      SKILL_RELATIVE_PATH_MAX_LENGTH ||
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
  if (!Array.isArray(references)) {
    return null;
  }
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    lengthDescriptor = Object.getOwnPropertyDescriptor(references, "length");
  } catch {
    return null;
  }
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > SKILL_LOADABLE_REFERENCE_MAX_ENTRIES
  ) return null;

  const normalized = new Set<string>();
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(references, index);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError(`Runtime skill reference ${index} must be a data property`);
    }
    const value = normalizeStrictRuntimeSkillReferencePath(descriptor.value);
    if (value === null) return null;
    normalized.add(value);
  }
  return Object.freeze([...normalized].sort()) as string[];
}

type ParsedRuntimeSkillBuildDocument = {
  document: ParsedRuntimeSkillDocument;
  allowedToolsDeclared: boolean;
  displayName?: string;
};

function getRuntimeSkillDisplayName(
  metadata: RuntimeSkillFrontmatter,
  canonicalName: string,
): string | undefined {
  const explicitDisplayName = metadata.metadata?.display_name?.trim() || undefined;
  const legacyDisplayName = metadata.name && metadata.name !== canonicalName
    ? metadata.name
    : undefined;
  return explicitDisplayName ?? legacyDisplayName;
}

function parseRuntimeSkillDirectoryDocument(
  content: string,
  input: Pick<
    BuildRuntimeSkillDefinitionInput,
    "id" | "ownerAgentId" | "skillDocumentParserProvider"
  >,
  logger?: RuntimeSkillMetadataLogger,
): ParsedRuntimeSkillBuildDocument | null {
  const parsed = parseStrictRuntimeSkillFileSource(
    content,
    input.id,
    {
      logger,
      skillDocumentParserProvider: input.skillDocumentParserProvider,
    },
    input.ownerAgentId !== undefined,
  );
  if (!parsed) return null;

  const { source, metadata } = parsed;
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
        metadata: metadata.metadata === undefined
          ? undefined
          : Object.freeze({ ...metadata.metadata }),
      },
    },
    allowedToolsDeclared: metadata.allowedTools !== undefined,
    ...(metadata.displayName === undefined ? {} : { displayName: metadata.displayName }),
  };
}

function buildRuntimeSkillDefinitionFromDocument(
  input: BuildRuntimeSkillDefinitionInput,
  parsed: ParsedRuntimeSkillBuildDocument | null,
): RuntimeSkillDefinition | null {
  if (!parsed) {
    return null;
  }
  if (!isRuntimeSkillIdValid(input)) {
    input.logger?.error?.("Invalid skill id; skipping skill", {
      id: input.id,
      error: input.ownerAgentId === undefined && input.shortName === undefined
        ? "must be lowercase alphanumeric with hyphens, 1-64 characters"
        : "must be provider-safe letters, numbers, underscores, or hyphens, 1-64 characters",
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
  const displayName = parsed.displayName ?? getRuntimeSkillDisplayName(metadata, input.id);
  const metadataSnapshot = metadata.metadata === undefined
    ? undefined
    : Object.freeze({ ...metadata.metadata });

  const definition: RuntimeSkillDefinition = {
    id: input.id,
    name: input.id,
    ...(displayName === undefined ? {} : { displayName }),
    description: metadata.description ?? extractDescriptionFromMarkdown(body, input.id),
    instructions: input.content,
    allowedTools: snapshotAllowedToolPatterns(metadata.allowedTools),
    allowedToolsDeclared: parsed.allowedToolsDeclared,
    ...(metadataSnapshot === undefined ? {} : { metadata: metadataSnapshot }),
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
  skillDocumentParserProvider?: SkillDocumentParserProvider,
): ParsedRuntimeSkillBuildDocument | null {
  const source = parseStrictRuntimeSkillSource(content, {
    logger,
    skillDocumentParserProvider,
  });
  return source
    ? {
      document: source.document,
      allowedToolsDeclared: source.allowedToolsDeclared,
    }
    : null;
}

/** Build a bounded, immutable runtime skill definition. */
export function buildRuntimeSkillDefinition(
  input: BuildRuntimeSkillDefinitionInput,
): RuntimeSkillDefinition | null {
  const snapshot = snapshotRuntimeSkillDefinitionInput(input);
  return buildRuntimeSkillDefinitionFromDocument(
    snapshot,
    parseRuntimeSkillBuildDocument(
      snapshot.content,
      snapshot.logger,
      snapshot.skillDocumentParserProvider,
    ),
  );
}

/**
 * Build a runtime skill definition through the historical permissive contract.
 *
 * @deprecated This builder accepts unbounded mutable programmatic inputs. Use
 * {@link buildRuntimeSkillDefinition}.
 */
export function buildUnsafeLegacyRuntimeSkillDefinition(
  input: BuildRuntimeSkillDefinitionInput,
): RuntimeSkillDefinition | null {
  const source = parseLegacyRuntimeSkillSource(input.content, {
    logger: input.logger,
    skillDocumentParserProvider: input.skillDocumentParserProvider,
  });
  if (!source) return null;

  const { metadata, body } = source.document;
  return {
    id: input.id,
    name: metadata.name ?? input.id,
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

/** Build a strict, immutable Agent Skills directory definition for discovery. */
export function buildRuntimeDirectorySkillDefinition(
  input: BuildRuntimeSkillDefinitionInput,
): RuntimeSkillDefinition | null {
  const snapshot = snapshotRuntimeSkillDefinitionInput(input);
  return buildRuntimeSkillDefinitionFromDocument(
    snapshot,
    parseRuntimeSkillDirectoryDocument(snapshot.content, snapshot, snapshot.logger),
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
  const snapshot = snapshotRuntimeSkillDefinitionInput(input);
  return buildRuntimeSkillDefinitionFromDocument(
    snapshot,
    parseRuntimeSkillBuildDocument(
      snapshot.content,
      snapshot.logger,
      snapshot.skillDocumentParserProvider,
    ),
  );
}

/**
 * Normalizes a runtime skill reference path through the historical contract.
 *
 * @deprecated Use {@link normalizeRuntimeSkillReferencePath}.
 */
export function normalizeUnsafeLegacyRuntimeSkillReferencePath(path: string): string | null {
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
    utf8ByteLength(path, SKILL_RELATIVE_PATH_MAX_LENGTH) >
      SKILL_RELATIVE_PATH_MAX_LENGTH ||
    !isWellFormedUtf16(path) ||
    hasControlCharacters(path)
  ) {
    return null;
  }
  const normalized = normalizeUnsafeLegacyRuntimeSkillReferencePath(path);

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

/** Normalizes and bounds a portable runtime skill reference path. */
export function normalizeRuntimeSkillReferencePath(path: string): string | null {
  return normalizeStrictRuntimeSkillReferencePath(path);
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

const RUNTIME_LOADED_SKILL_MESSAGE_FIELDS = [
  "allowedToolsNote",
  "noCurrentRunToolsNote",
  "unavailableCurrentRunToolsDelegationNote",
  "overrideNote",
  "referenceNote",
] as const satisfies readonly (keyof RuntimeLoadedSkillResponseMessages)[];

function requireBoundedRuntimeLoadedSkillText(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Runtime loaded skill ${label} must be a string`);
  }
  if (value.length > SKILL_DOCUMENT_MAX_CHARACTERS) {
    throw new RangeError(
      `Runtime loaded skill ${label} must be at most ${SKILL_DOCUMENT_MAX_CHARACTERS} characters`,
    );
  }
  return value;
}

function snapshotRuntimeLoadedSkillResponseMessages(
  input: unknown,
): RuntimeLoadedSkillResponseMessages {
  const snapshot = {} as RuntimeLoadedSkillResponseMessages;
  for (const field of RUNTIME_LOADED_SKILL_MESSAGE_FIELDS) {
    snapshot[field] = requireBoundedRuntimeLoadedSkillText(
      readOwnDataInputProperty(input, field, "Runtime loaded skill messages", true),
      `messages.${field}`,
    );
  }
  return Object.freeze(snapshot);
}

function snapshotRuntimeLoadedSkillResponseInput(
  input: BuildRuntimeLoadedSkillResponseInput,
): BuildRuntimeLoadedSkillResponseInput {
  return Object.freeze({
    skillId: readOwnDataInputProperty(
      input,
      "skillId",
      "Runtime loaded skill response",
      true,
    ) as string,
    instructions: readOwnDataInputProperty(
      input,
      "instructions",
      "Runtime loaded skill response",
      true,
    ) as string,
    nextStep: requireBoundedRuntimeLoadedSkillText(
      readOwnDataInputProperty(
        input,
        "nextStep",
        "Runtime loaded skill response",
        true,
      ),
      "nextStep",
    ),
    messages: snapshotRuntimeLoadedSkillResponseMessages(
      readOwnDataInputProperty(
        input,
        "messages",
        "Runtime loaded skill response",
        true,
      ),
    ),
    references: readOwnDataInputProperty(
      input,
      "references",
      "Runtime loaded skill response",
      false,
    ) as readonly string[] | undefined,
    availableToolNames: readOwnDataInputProperty(
      input,
      "availableToolNames",
      "Runtime loaded skill response",
      false,
    ) as readonly string[] | undefined,
    logger: readOwnDataInputProperty(
      input,
      "logger",
      "Runtime loaded skill response",
      false,
    ) as RuntimeSkillMetadataLogger | undefined,
  });
}

/**
 * Build a loaded-skill response through the historical permissive contract.
 *
 * @deprecated This builder accepts unbounded mutable programmatic inputs. Use
 * {@link buildRuntimeLoadedSkillResponse}.
 */
export function buildUnsafeLegacyRuntimeLoadedSkillResponse(
  input: BuildRuntimeLoadedSkillResponseInput,
): RuntimeLoadedSkillResponse {
  const metadata = parseUnsafeLegacyRuntimeSkillMetadata(input.instructions, {
    logger: input.logger,
  });
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
        ...(hasUnsafeLegacyAvailableDelegationTool(availableToolNameSet)
          ? { delegationNote: input.messages.unavailableCurrentRunToolsDelegationNote }
          : {}),
      }
      : {}),
    ...(metadata?.model ? { model: metadata.model } : {}),
    ...(metadata?.thinking !== undefined ? { thinking: metadata.thinking } : {}),
    ...(metadata?.maxSteps !== undefined ? { maxSteps: metadata.maxSteps } : {}),
    ...(hasOverrides && canUnsafeLegacyUseInvokeAgent(availableToolNameSet)
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
  const snapshot = snapshotRuntimeLoadedSkillResponseInput(input);
  if (!isBoundedRuntimeIdentity(snapshot.skillId)) {
    throw new TypeError("Runtime loaded skill response skillId is invalid");
  }
  if (
    typeof snapshot.instructions !== "string" ||
    snapshot.instructions.length > SKILL_DOCUMENT_MAX_CHARACTERS
  ) {
    throw new RangeError(
      `Runtime loaded skill instructions must be at most ${SKILL_DOCUMENT_MAX_CHARACTERS} characters`,
    );
  }
  const references = snapshotRuntimeSkillReferences(snapshot.references);
  if (references === null) {
    throw new TypeError("Runtime loaded skill references are invalid");
  }
  const parsedSource = parseStrictRuntimeSkillSource(snapshot.instructions, {
    logger: snapshot.logger,
  });
  const metadata = parsedSource?.document.metadata ?? null;
  const invalidMetadata = parsedSource === null;
  const declaredAllowedTools = metadata?.allowedTools ?? [];
  const availableToolNameSet = snapshotAvailableRuntimeToolNames(snapshot.availableToolNames);
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
    skillId: snapshot.skillId,
    instructions: snapshot.instructions,
    nextStep: snapshot.nextStep,
    ...(hasDeclaredAllowedTools
      ? {
        allowedTools: currentRunAllowedTools,
        note: currentRunAllowedTools.length > 0
          ? snapshot.messages.allowedToolsNote
          : snapshot.messages.noCurrentRunToolsNote,
      }
      : {}),
    ...(hasDeclaredAllowedTools ? { delegationTools: declaredAllowedTools } : {}),
    ...(unavailableCurrentRunTools.length > 0
      ? {
        unavailableCurrentRunTools,
        ...(hasAllowedAvailableDelegationTool(
            availableToolNameSet,
            declaredAllowedTools,
            hasDeclaredAllowedTools,
          )
          ? { delegationNote: snapshot.messages.unavailableCurrentRunToolsDelegationNote }
          : {}),
      }
      : {}),
    ...(metadata?.model ? { model: metadata.model } : {}),
    ...(metadata?.thinking !== undefined ? { thinking: metadata.thinking } : {}),
    ...(metadata?.maxSteps !== undefined ? { maxSteps: metadata.maxSteps } : {}),
    ...(hasOverrides && canUseLegacyInvokeAgent(availableToolNameSet) &&
        isToolAllowedByResolvedPolicy(
          "invoke_agent",
          declaredAllowedTools,
          hasDeclaredAllowedTools,
        )
      ? {
        overrideNote: snapshot.messages.overrideNote,
      }
      : {}),
    ...(references && references.length > 0
      ? {
        references: [...references],
        referenceNote: snapshot.messages.referenceNote,
      }
      : {}),
  };
}

/** Build a bounded loaded-skill response and fail closed on invalid metadata. */
export function buildRuntimeLoadedSkillResponse(
  input: BuildRuntimeLoadedSkillResponseInput,
): RuntimeLoadedSkillResponse {
  return buildStrictRuntimeLoadedSkillResponse(input);
}
