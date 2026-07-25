import type { Prompt, PromptConfig } from "./types.ts";
import { createError, toError } from "#veryfront/errors";

/** Create a typed prompt definition. */
export function prompt(config: PromptConfig): Prompt {
  const { content, description, generate, suggestion } = config;
  if (config.id !== undefined && config.id.trim().length === 0) {
    throw new TypeError("Prompt id must not be empty");
  }
  if (content === undefined && generate === undefined) {
    throw new TypeError("Prompt must define static content or a generator");
  }

  const id = config.id ?? generatePromptId();
  const generatedId = config.id === undefined ? id : undefined;

  const created: Prompt = {
    id,
    description,
    suggestion,
    async getContent(variables?: Record<string, unknown>): Promise<string> {
      const resolvedVariables = variables ?? {};

      if (content !== undefined) {
        return interpolateVariables(content, resolvedVariables);
      }

      if (generate) {
        const generated = await generate(resolvedVariables);
        if (typeof generated !== "string") {
          throw toError(
            createError({
              type: "agent",
              message: `Prompt "${id}" generator must return a string`,
            }),
          );
        }
        return generated;
      }

      // The factory validates this invariant before returning. Keep the guard
      // local so a future refactor cannot turn a malformed prompt into an
      // advertised runtime value.
      throw new TypeError(`Prompt "${id}" has no content or generator`);
    },
  };
  return generatedId === undefined ? created : { ...created, __veryfrontGeneratedId: generatedId };
}

let promptIdCounter = 0;

function generatePromptId(): string {
  return `prompt_${Date.now()}_${promptIdCounter++}`;
}

function interpolateVariables(
  template: string,
  variables: Record<string, unknown>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(variables, key)) return match;
    const value = variables[key];
    return value != null ? String(value) : match;
  });
}
