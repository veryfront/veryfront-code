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
  return model.executionMode === "server-local";
}

/**
 * Return whether a runtime supports tool calling.
 *
 * Existing runtimes predate capability metadata, so omission preserves their
 * historical behavior. An explicit `false` is authoritative regardless of
 * where inference executes.
 */
export function supportsModelRuntimeToolCalling(model: ModelRuntime): boolean {
  const capabilities = model.runtimeCapabilities;
  if (capabilities === undefined) return true;
  if (typeof capabilities !== "object" || capabilities === null) {
    throw new TypeError("Model runtime capabilities must be an object");
  }
  const toolCalling = capabilities.toolCalling;
  if (toolCalling === undefined) return true;
  if (typeof toolCalling !== "boolean") {
    throw new TypeError("Model runtime toolCalling capability must be a boolean");
  }
  return toolCalling;
}
