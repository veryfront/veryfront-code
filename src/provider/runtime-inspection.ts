import type { ModelRuntime } from "./types.ts";

function toRuntimeRecord(model: ModelRuntime): ModelRuntime {
  return model;
}

export function getModelRuntimeId(model: ModelRuntime): string | undefined {
  const runtimeRecord = toRuntimeRecord(model);
  return typeof runtimeRecord.modelId === "string" ? runtimeRecord.modelId : undefined;
}

export function getModelRuntimeProvider(model: ModelRuntime): string | undefined {
  const runtimeRecord = toRuntimeRecord(model);
  return typeof runtimeRecord.provider === "string" ? runtimeRecord.provider : undefined;
}

export function hasLocalModelRuntimeMarker(model: ModelRuntime): boolean {
  return toRuntimeRecord(model)._isVfLocalModel === true;
}

export function isLocalModelRuntime(model: ModelRuntime): boolean {
  return hasLocalModelRuntimeMarker(model) ||
    getModelRuntimeProvider(model) === "local" ||
    (getModelRuntimeId(model)?.startsWith("local/") ?? false);
}
