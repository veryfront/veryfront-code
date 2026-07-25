import type { ModelRuntime } from "./types.ts";

export function getModelRuntimeId(model: ModelRuntime): string | undefined {
  const modelId = model.modelId;
  return typeof modelId === "string" ? modelId : undefined;
}

export function getModelRuntimeProvider(model: ModelRuntime): string | undefined {
  const provider = model.provider;
  return typeof provider === "string" ? provider : undefined;
}

export function hasLocalModelRuntimeMarker(model: ModelRuntime): boolean {
  return model._isVfLocalModel === true;
}

export function isLocalModelRuntime(model: ModelRuntime): boolean {
  return hasLocalModelRuntimeMarker(model) ||
    getModelRuntimeProvider(model) === "local" ||
    (getModelRuntimeId(model)?.startsWith("local/") ?? false);
}
