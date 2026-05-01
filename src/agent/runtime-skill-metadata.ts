import { extract } from "#std/front-matter/yaml.ts";
import { z } from "zod";

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

const rawRuntimeSkillFrontmatterSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    "allowed-tools": z.union([z.string(), z.array(z.string())]).optional(),
    model: z.string().optional(),
    thinking: z.union([z.literal(false), z.coerce.number().int().positive()]).optional(),
    "max-steps": z.coerce.number().int().positive().optional(),
  })
  .passthrough();

export const RuntimeSkillFrontmatterSchema = rawRuntimeSkillFrontmatterSchema.transform((data) => ({
  name: data.name?.trim() || undefined,
  description: data.description?.trim() || undefined,
  allowedTools: normalizeAllowedTools(data["allowed-tools"]),
  model: data.model?.trim() || undefined,
  thinking: data.thinking,
  maxSteps: data["max-steps"],
}));

export type RuntimeSkillFrontmatter = z.infer<typeof RuntimeSkillFrontmatterSchema>;

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

export type RuntimeLoadedSkillResponseMessages = {
  allowedToolsNote: string;
  noCurrentRunToolsNote: string;
  unavailableCurrentRunToolsDelegationNote: string;
  overrideNote: string;
  referenceNote: string;
};

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

export type RuntimeSkillMetadataLogger = {
  error?: (message: string, metadata?: Record<string, unknown>) => void;
};

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

export function parseRuntimeSkillDocument(
  content: string,
  options: { logger?: RuntimeSkillMetadataLogger } = {},
): ParsedRuntimeSkillDocument | null {
  try {
    const parsed = extract<Record<string, unknown>>(content);
    const result = RuntimeSkillFrontmatterSchema.safeParse(parsed.attrs);

    if (!result.success) {
      options.logger?.error?.("Invalid skill frontmatter; skipping skill", {
        error: result.error.message,
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

export function parseRuntimeSkillMetadata(
  content: string,
  options: { logger?: RuntimeSkillMetadataLogger } = {},
): RuntimeSkillFrontmatter | null {
  return parseRuntimeSkillDocument(content, options)?.metadata ?? null;
}

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
