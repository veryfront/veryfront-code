
import type { Prompt, PromptConfig } from "../types/mcp.ts";
import { agentLogger } from "../../core/utils/logger/logger.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";

export function prompt(config: PromptConfig): Prompt {
  const id = config.id || generatePromptId();

  return {
    id,
    description: config.description,

    async getContent(
      variables?: Record<string, unknown>,
    ): Promise<string> {
      if (config.content) {
        return interpolateVariables(config.content, variables || {});
      }

      if (config.generate) {
        return await config.generate(variables || {});
      }

      throw toError(createError({
        type: "agent",
        message: `Prompt "${id}" has no content or generator`,
      }));
    },
  };
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
    const value = variables[key];
    return value !== undefined ? String(value) : match;
  });
}

class PromptRegistryClass {
  private prompts = new Map<string, Prompt>();

  register(id: string, promptInstance: Prompt): void {
    if (this.prompts.has(id)) {
      agentLogger.debug(`Prompt "${id}" is already registered. Overwriting.`);
    }

    this.prompts.set(id, promptInstance);
  }

  get(id: string): Prompt | undefined {
    return this.prompts.get(id);
  }

  async getContent(
    id: string,
    variables?: Record<string, unknown>,
  ): Promise<string> {
    const promptInstance = this.get(id);

    if (!promptInstance) {
      throw toError(createError({
        type: "agent",
        message: `Prompt "${id}" not found`,
      }));
    }

    return await promptInstance.getContent(variables);
  }

  getAll(): Map<string, Prompt> {
    return new Map(this.prompts);
  }

  clear(): void {
    this.prompts.clear();
  }
}

const PROMPT_REGISTRY_KEY = "__veryfront_prompt_registry__";
// deno-lint-ignore no-explicit-any
const _globalPrompt = globalThis as any;
export const promptRegistry: PromptRegistryClass = _globalPrompt[PROMPT_REGISTRY_KEY] ||=
  new PromptRegistryClass();
