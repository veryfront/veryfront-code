import type { ModelRuntime } from "./types.ts";

export function getModelRuntimeId(model: ModelRuntime): string | undefined {
  const modelId = model.modelId;
  return typeof modelId === "string" ? modelId : undefined;
}

export function getModelRuntimeProvider(model: ModelRuntime): string | undefined {
  const provider = model.provider;
  return typeof provider === "string" ? provider : undefined;
}

export function isLocalModelRuntime(model: ModelRuntime): boolean {
  const executionMode = model.executionMode;
  if (executionMode === "server-local") return true;
  if (executionMode === "remote") return false;
  if (executionMode !== undefined) {
    throw new TypeError("Model runtime executionMode must be remote or server-local");
  }

  return model._isVfLocalModel === true ||
    getModelRuntimeProvider(model) === "local" ||
    (getModelRuntimeId(model)?.startsWith("local/") ?? false);
}

/**
 * Return whether a runtime supports tool calling.
 *
 * Existing runtimes predate capability metadata, so omission preserves their
 * historical behavior: legacy local runtimes do not receive tools and other
 * runtimes do. An explicit value is authoritative regardless of placement.
 */
export function supportsModelRuntimeToolCalling(model: ModelRuntime): boolean {
  const capabilities = model.runtimeCapabilities;
  if (capabilities === undefined) return !isLocalModelRuntime(model);
  if (typeof capabilities !== "object" || capabilities === null) {
    throw new TypeError("Model runtime capabilities must be an object");
  }
  const toolCalling = capabilities.toolCalling;
  if (toolCalling === undefined) return !isLocalModelRuntime(model);
  if (typeof toolCalling !== "boolean") {
    throw new TypeError("Model runtime toolCalling capability must be a boolean");
  }
  return toolCalling;
}
