import type { Prompt, PromptConfig } from "./types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { COMMON_BLOCKED_PATTERNS } from "../agent/middleware/security/validator.ts";

export function prompt(config: PromptConfig): Prompt {
  const id = config.id ?? generatePromptId();

  return {
    id,
    description: config.description,
    suggestion: config.suggestion,
    async getContent(variables?: Record<string, unknown>): Promise<string> {
      const vars = variables ?? {};

      if (config.content) {
        return interpolateVariables(config.content, vars);
      }

      if (config.generate) {
        return config.generate(vars);
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
  let sanitized = value;
  for (const pattern of COMMON_BLOCKED_PATTERNS.promptInjection) {
    sanitized = sanitized.replace(pattern, "");
  }
  return sanitized;
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
