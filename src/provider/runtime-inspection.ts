import type { ModelRuntime } from "./types.ts";

function toRuntimeRecord(model: ModelRuntime): ModelRuntime {
  return model;
}

function readRuntimeField(model: ModelRuntime, key: PropertyKey): unknown {
  try {
    return Reflect.get(toRuntimeRecord(model), key);
  } catch {
    return undefined;
  }
}

export function getModelRuntimeId(model: ModelRuntime): string | undefined {
  const modelId = readRuntimeField(model, "modelId");
  return typeof modelId === "string" ? modelId : undefined;
}

export function getModelRuntimeProvider(model: ModelRuntime): string | undefined {
  const provider = readRuntimeField(model, "provider");
  return typeof provider === "string" ? provider : undefined;
}

export function hasLocalModelRuntimeMarker(model: ModelRuntime): boolean {
  return readRuntimeField(model, "_isVfLocalModel") === true;
}

export function isLocalModelRuntime(model: ModelRuntime): boolean {
  return hasLocalModelRuntimeMarker(model) ||
    getModelRuntimeProvider(model) === "local" ||
    (getModelRuntimeId(model)?.startsWith("local/") ?? false);
}
