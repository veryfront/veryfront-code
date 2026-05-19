import { extract } from "#std/front-matter/yaml.ts";
import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";

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
        allowedTools: normalizeAllowedTools(d["allowed-tools"] as string | string[] | undefined),
        model: (typeof d.model === "string" ? d.model.trim() : undefined) || undefined,
        thinking: d.thinking as false | number | undefined,
        maxSteps: d["max-steps"] as number | undefined,
      };
    })
);

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
  model?: string;
  thinking?: false | number;
  maxSteps?: number;
  references?: string[];
};

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
  logger?: RuntimeSkillMetadataLogger;
}): RuntimeSkillDefinition | null {
  const document = parseRuntimeSkillDocument(input.content, { logger: input.logger });
  if (!document) {
    return null;
  }

  const { metadata, body } = document;

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
  };
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
  const availableToolNameSet = input.availableToolNames && input.availableToolNames.length > 0
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
        delegationNote: input.messages.unavailableCurrentRunToolsDelegationNote,
      }
      : {}),
    ...(metadata?.model ? { model: metadata.model } : {}),
    ...(metadata?.thinking !== undefined ? { thinking: metadata.thinking } : {}),
    ...(metadata?.maxSteps !== undefined ? { maxSteps: metadata.maxSteps } : {}),
    ...(hasOverrides
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
