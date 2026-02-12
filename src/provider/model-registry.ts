/**
 * Model Registry - AI SDK Provider Adapter Layer
 *
 * Maps "provider/model" strings to AI SDK LanguageModel instances.
 * Thin abstraction that delegates to AI SDK provider packages
 * while maintaining control over the API surface.
 *
 * Project-scoped: each project gets its own provider namespace.
 * Auto-initialized providers from env vars are shared across all projects.
 *
 * @module
 */

import type { LanguageModel } from "ai";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  getAnthropicEnvConfig,
  getGoogleGenAIEnvConfig,
  getOpenAIEnvConfig,
} from "#veryfront/config/env.ts";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";
import { ProjectScopedRegistryManager } from "../ai/registry-manager.ts";

export type ModelProviderFactory = (modelId: string) => LanguageModel;

const manager = new ProjectScopedRegistryManager<ModelProviderFactory>(
  "model-provider",
);
let autoInitialized = false;

/**
 * Register an AI SDK model provider factory for the current project.
 *
 * @example
 * ```ts
 * import { createOpenAI } from "@ai-sdk/openai";
 * registerModelProvider("openai", (id) => createOpenAI({ apiKey })(id));
 * ```
 */
export function registerModelProvider(
  name: string,
  factory: ModelProviderFactory,
): void {
  manager.register(name, factory);
}

/**
 * Auto-initialize model providers from environment variables.
 * Registered as shared (available to all projects).
 * Called lazily on first access.
 */
function autoInitializeFromEnv(): void {
  if (autoInitialized) return;
  autoInitialized = true;

  const openaiConfig = getOpenAIEnvConfig();
  if (openaiConfig.apiKey && !manager.has("openai")) {
    try {
      const openai = createOpenAI({
        apiKey: openaiConfig.apiKey,
        baseURL: openaiConfig.baseURL,
      });
      manager.registerShared("openai", (id) => openai(id));
      agentLogger.debug(
        "Auto-initialized OpenAI model provider from environment",
      );
    } catch (error) {
      agentLogger.warn(
        "Failed to initialize OpenAI model provider:",
        error,
      );
    }
  }

  const anthropicConfig = getAnthropicEnvConfig();
  if (anthropicConfig.apiKey && !manager.has("anthropic")) {
    try {
      const anthropic = createAnthropic({
        apiKey: anthropicConfig.apiKey,
        baseURL: anthropicConfig.baseURL,
      });
      manager.registerShared("anthropic", (id) => anthropic(id));
      agentLogger.debug(
        "Auto-initialized Anthropic model provider from environment",
      );
    } catch (error) {
      agentLogger.warn(
        "Failed to initialize Anthropic model provider:",
        error,
      );
    }
  }

  const googleConfig = getGoogleGenAIEnvConfig();
  if (googleConfig.apiKey && !manager.has("google")) {
    try {
      const google = createGoogleGenerativeAI({
        apiKey: googleConfig.apiKey,
      });
      manager.registerShared("google", (id) => google(id));
      agentLogger.debug(
        "Auto-initialized Google model provider from environment",
      );
    } catch (error) {
      agentLogger.warn(
        "Failed to initialize Google model provider:",
        error,
      );
    }
  }
}

/**
 * Resolve a "provider/model" string to an AI SDK LanguageModel instance.
 *
 * Auto-initializes providers from environment on first call.
 *
 * @example
 * ```ts
 * const model = resolveModel("openai/gpt-4o");
 * ```
 */
export function resolveModel(modelString: string): LanguageModel {
  autoInitializeFromEnv();

  const slashIndex = modelString.indexOf("/");
  if (slashIndex === -1) {
    throw toError(
      createError({
        type: "config",
        message:
          `Invalid model string: "${modelString}". Expected "provider/model" (e.g. "openai/gpt-4o").`,
      }),
    );
  }

  const providerName = modelString.slice(0, slashIndex);
  const modelId = modelString.slice(slashIndex + 1);

  if (!providerName || !modelId) {
    throw toError(
      createError({
        type: "config",
        message:
          `Invalid model string: "${modelString}". Both provider and model name are required.`,
      }),
    );
  }

  const factory = manager.get(providerName);
  if (!factory) {
    const available = getRegisteredModelProviders().join(", ") || "none";
    throw toError(
      createError({
        type: "agent",
        message: `Model provider "${providerName}" not registered. Available: ${available}`,
      }),
    );
  }

  return factory(modelId);
}

/**
 * Check if a model provider is registered (project-scoped or shared).
 */
export function hasModelProvider(name: string): boolean {
  autoInitializeFromEnv();
  return manager.has(name);
}

/**
 * Get list of registered model provider names (project-scoped + shared).
 */
export function getRegisteredModelProviders(): string[] {
  autoInitializeFromEnv();
  return manager.getAllIds();
}

/**
 * Clear all registered model providers (for testing).
 */
export function clearModelProviders(): void {
  manager.clearAll();
  autoInitialized = false;
}
