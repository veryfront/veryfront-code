import type { Prompt, PromptArgument, PromptConfig, PromptRenderContext } from "./types.ts";
import {
  analyzePromptTemplate,
  assertPromptContent,
  assertPromptId,
  assertPromptText,
  MAX_PROMPT_CONTENT_BYTES,
  MAX_PROMPT_DESCRIPTION_LENGTH,
  MAX_PROMPT_PLACEHOLDERS,
  MAX_PROMPT_SUGGESTION_LENGTH,
  snapshotPromptArguments,
  snapshotPromptDefinition,
} from "./definition.ts";
import type { PromptTemplatePlaceholder } from "./definition.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";

type PromptGenerateFn = (
  variables: Record<string, unknown>,
  context: PromptRenderContext,
) => unknown | Promise<unknown>;

type PromptTemplateSegment = string | PromptTemplatePlaceholder;

interface CompiledPromptTemplate {
  readonly segments: readonly PromptTemplateSegment[];
  readonly placeholderNames: readonly string[];
}

const PROMPT_CONFIG_KEYS = new Set([
  "id",
  "description",
  "content",
  "generate",
  "arguments",
  "suggestion",
]);
function invalidPromptConfig(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail });
}

function safeConfigKeys(config: object): readonly PropertyKey[] {
  try {
    return Reflect.ownKeys(config);
  } catch {
    invalidPromptConfig("Prompt configuration properties must be readable");
  }
}

function readOwnConfigProperty(config: object, key: string): unknown {
  try {
    return Object.hasOwn(config, key) ? Reflect.get(config, key) : undefined;
  } catch {
    invalidPromptConfig("Prompt configuration properties must be readable");
  }
}

function generatePromptId(): string {
  return `prompt_${crypto.randomUUID().replaceAll("-", "")}`;
}

function compileTemplate(content: string): CompiledPromptTemplate {
  const analysis = analyzePromptTemplate(content);
  if (analysis.exceedsPlaceholderLimit) {
    invalidPromptConfig(
      `Prompt content must contain at most ${MAX_PROMPT_PLACEHOLDERS} placeholders`,
    );
  }

  const segments: PromptTemplateSegment[] = [];
  let cursor = 0;

  for (const placeholder of analysis.placeholders) {
    if (placeholder.index > cursor) {
      segments.push(content.slice(cursor, placeholder.index));
    }
    segments.push(placeholder);
    cursor = placeholder.index + placeholder.source.length;
  }

  if (cursor < content.length) segments.push(content.slice(cursor));
  return Object.freeze({
    segments: Object.freeze(segments),
    placeholderNames: analysis.placeholderNames,
  });
}

function interpolateVariables(
  segments: readonly PromptTemplateSegment[],
  variables: Record<string, unknown>,
): string {
  const output: string[] = [];
  let outputLength = 0;

  for (const segment of segments) {
    let value: string;
    if (typeof segment === "string") {
      value = segment;
    } else if (Object.hasOwn(variables, segment.key) && variables[segment.key] != null) {
      value = String(variables[segment.key]);
    } else {
      value = segment.source;
    }

    if (value.length > MAX_PROMPT_CONTENT_BYTES - outputLength) {
      invalidPromptConfig(
        `Rendered prompt content must not exceed ${MAX_PROMPT_CONTENT_BYTES} bytes`,
      );
    }
    outputLength += value.length;
    output.push(value);
  }

  return output.join("");
}

/** Create a validated, immutable prompt definition. */
export function prompt(config: PromptConfig): Prompt {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    invalidPromptConfig("Prompt configuration must be an object");
  }

  const keys = safeConfigKeys(config);
  for (const key of keys) {
    if (typeof key !== "string" || !PROMPT_CONFIG_KEYS.has(key)) {
      invalidPromptConfig("Prompt configuration contains an unsupported property");
    }
  }

  const configuredId = readOwnConfigProperty(config, "id");
  const id = configuredId === undefined ? generatePromptId() : assertPromptId(configuredId);
  const description = assertPromptText(
    readOwnConfigProperty(config, "description"),
    "Prompt description",
    MAX_PROMPT_DESCRIPTION_LENGTH,
  ) as string;
  const suggestion = assertPromptText(
    readOwnConfigProperty(config, "suggestion"),
    "Prompt suggestion",
    MAX_PROMPT_SUGGESTION_LENGTH,
    true,
  );
  const configuredContent = readOwnConfigProperty(config, "content");
  const configuredGenerate = readOwnConfigProperty(config, "generate");
  const configuredArguments = readOwnConfigProperty(config, "arguments");

  if ((configuredContent === undefined) === (configuredGenerate === undefined)) {
    invalidPromptConfig("Prompt configuration must define exactly one of content or generate");
  }

  let getContent: (
    variables?: Record<string, unknown>,
    context?: PromptRenderContext,
  ) => Promise<unknown>;
  let argumentsList: PromptArgument[] | undefined;
  if (configuredContent !== undefined) {
    const content = assertPromptContent(configuredContent, "Prompt content");
    const template = compileTemplate(content);
    argumentsList = snapshotPromptArguments(configuredArguments, template.placeholderNames);
    getContent = (variables = {}) =>
      Promise.resolve(interpolateVariables(template.segments, variables));
  } else {
    if (typeof configuredGenerate !== "function") {
      invalidPromptConfig("Prompt generate must be a function");
    }
    const generate = configuredGenerate as PromptGenerateFn;
    argumentsList = snapshotPromptArguments(configuredArguments);
    getContent = async (variables = {}, context = {}) =>
      await Reflect.apply(generate, undefined, [variables, context]);
  }

  return snapshotPromptDefinition({
    id,
    description,
    ...(suggestion === undefined ? {} : { suggestion }),
    ...(argumentsList === undefined ? {} : { arguments: argumentsList }),
    getContent,
  });
}
