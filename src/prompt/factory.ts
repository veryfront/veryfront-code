import type { Prompt, PromptConfig } from "./types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { COMMON_BLOCKED_PATTERNS } from "#veryfront/agent/middleware/index.ts";

type PromptGenerateFn = (variables: Record<string, unknown>) => string | Promise<string>;

const BLOCKED_PROMPT_PATTERNS = COMMON_BLOCKED_PATTERNS.promptInjection;

/** Create a typed prompt definition. */
export function prompt(config: PromptConfig): Prompt {
  const { content, description, generate, suggestion } = config;
  const id = config.id ?? generatePromptId();

  return {
    id,
    description,
    suggestion,
    async getContent(variables?: Record<string, unknown>): Promise<string> {
      const resolvedVariables = variables ?? {};

      if (content) {
        return interpolateVariables(content, resolvedVariables);
      }

      if (generate) {
        return (generate as PromptGenerateFn)(resolvedVariables);
      }

      throw toError(
        createError({
          type: "agent",
          message: `Prompt "${id}" has no content or generator`,
        }),
      );
    },
  };
}

let promptIdCounter = 0;

function generatePromptId(): string {
  return `prompt_${Date.now()}_${promptIdCounter++}`;
}

function sanitizeVariableValue(value: string): string {
  return BLOCKED_PROMPT_PATTERNS.reduce((sanitizedValue, pattern) => {
    // The shared patterns are non-global, so a plain .replace() strips only the
    // first match and is bypassable by repetition. Use a per-call global-flagged
    // copy to strip every occurrence. A copy (not a mutation) is required because
    // these same regex objects are consumed with stateful .test() in validator.ts.
    const globalPattern = pattern.global
      ? pattern
      : new RegExp(pattern.source, `${pattern.flags}g`);
    return sanitizedValue.replace(globalPattern, "");
  }, value);
}

function interpolateVariables(
  template: string,
  variables: Record<string, unknown>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = variables[key];
    return value != null ? sanitizeVariableValue(String(value)) : match;
  });
}
