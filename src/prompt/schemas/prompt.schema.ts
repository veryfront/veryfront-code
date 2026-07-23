import { defineSchema } from "#veryfront/schemas/index.ts";
import {
  analyzePromptTemplate,
  isSafePromptContent,
  isSafePromptIdentifier,
  isSafePromptText,
  isSafePromptVariableName,
  MAX_PROMPT_ARGUMENT_DESCRIPTION_LENGTH,
  MAX_PROMPT_CONTENT_BYTES,
  MAX_PROMPT_DESCRIPTION_LENGTH,
  MAX_PROMPT_ID_LENGTH,
  MAX_PROMPT_PLACEHOLDERS,
  MAX_PROMPT_SUGGESTION_LENGTH,
  MAX_PROMPT_VARIABLE_KEY_LENGTH,
  MAX_PROMPT_VARIABLES,
} from "../definition.ts";

/** Cancellation and lifecycle values available while rendering a prompt. */
export interface PromptRenderContext {
  /** Signal that aborts prompt rendering when the caller no longer needs it. */
  readonly signal?: AbortSignal;
}

/** Callback used to render dynamic prompt content. */
export type PromptGenerate = (
  variables: Record<string, unknown>,
  context: PromptRenderContext,
) => string | Promise<string>;

/** One argument advertised to MCP clients for a prompt. */
export interface PromptArgument {
  /** Variable name used by the prompt template or generator. */
  name: string;
  /** Human-readable explanation shown to prompt clients. */
  description?: string;
  /** Whether callers must provide the variable. Defaults to false. */
  required?: boolean;
}

/** Configuration used to create a prompt definition. */
export interface PromptConfig {
  /** Optional stable identifier. A random identifier is generated when omitted. */
  id?: string;
  /** Human-readable description shown to prompt clients. */
  description: string;
  /** Static prompt template. Define either content or generate. */
  content?: string;
  /** Dynamic prompt renderer. Define either generate or content. */
  generate?: PromptGenerate;
  /** Argument metadata advertised to MCP clients. Static templates derive this when omitted. */
  arguments?: PromptArgument[];
  /** Example message text to use as a chat suggestion. */
  suggestion?: string;
}

/** Return the schema for a prompt factory configuration. */
export const getPromptConfigSchema = defineSchema<PromptConfig>((v) =>
  v.object({
    id: v.string().min(1).max(MAX_PROMPT_ID_LENGTH).refine(
      isSafePromptIdentifier,
      "Prompt id contains unsupported characters",
    ).optional(),
    description: v.string().min(1).max(MAX_PROMPT_DESCRIPTION_LENGTH).refine(
      (value) => isSafePromptText(value, MAX_PROMPT_DESCRIPTION_LENGTH),
      "Prompt description must contain safe visible text",
    ),
    content: v.string().min(1).max(MAX_PROMPT_CONTENT_BYTES).refine(
      isSafePromptContent,
      "Prompt content must contain safe visible text",
    ).optional(),
    generate: v.custom<PromptGenerate>(
      (value) => typeof value === "function",
      "Prompt generate must be a function",
    ).optional(),
    arguments: v.array(
      v.object({
        name: v.string().min(1).max(MAX_PROMPT_VARIABLE_KEY_LENGTH).refine(
          isSafePromptVariableName,
          "Prompt argument name is invalid",
        ),
        description: v.string().min(1).max(MAX_PROMPT_ARGUMENT_DESCRIPTION_LENGTH).refine(
          (value) => isSafePromptText(value, MAX_PROMPT_ARGUMENT_DESCRIPTION_LENGTH),
          "Prompt argument description must contain safe visible text",
        ).optional(),
        required: v.boolean().optional(),
      }).strict(),
    ).max(MAX_PROMPT_VARIABLES).refine(
      (argumentsList) =>
        new Set(argumentsList.map((argument) => argument.name)).size ===
          argumentsList.length,
      "Prompt argument names must be unique",
    ).optional(),
    /** Example message text to use as a chat suggestion. */
    suggestion: v.string().min(1).max(MAX_PROMPT_SUGGESTION_LENGTH).refine(
      (value) => isSafePromptText(value, MAX_PROMPT_SUGGESTION_LENGTH),
      "Prompt suggestion must contain safe visible text",
    ).optional(),
  }).strict().superRefine((config, context) => {
    if ((config.content === undefined) === (config.generate === undefined)) {
      context.addIssue({
        message: "Prompt configuration must define exactly one of content or generate",
      });
    }
    if (config.content !== undefined && isSafePromptContent(config.content)) {
      const analysis = analyzePromptTemplate(config.content);
      if (analysis.exceedsPlaceholderLimit) {
        context.addIssue({
          message: `Prompt content must contain at most ${MAX_PROMPT_PLACEHOLDERS} placeholders`,
          path: ["content"],
        });
      } else if (config.arguments !== undefined) {
        const argumentNames = new Set(config.arguments.map((argument) => argument.name));
        if (
          argumentNames.size !== analysis.placeholderNames.length ||
          analysis.placeholderNames.some((name) => !argumentNames.has(name))
        ) {
          context.addIssue({
            message: "Prompt argument definitions must match the static template placeholders",
            path: ["arguments"],
          });
        }
      }
    }
  })
);
