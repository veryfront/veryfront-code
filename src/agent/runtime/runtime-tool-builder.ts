import type { JsonSchema } from "#veryfront/tool/schema";
import type { RuntimeToolSet } from "./runtime-tool-types.ts";

interface RuntimeJsonSchema<T = unknown> extends Record<string, unknown> {
  readonly jsonSchema: JsonSchema | PromiseLike<JsonSchema>;
  validate?: (value: unknown) => T | PromiseLike<T>;
}

type RuntimeLazySchema<T = unknown> = () => RuntimeJsonSchema<T>;

interface RuntimeToolDefinition {
  description: string;
  inputSchema: RuntimeJsonSchema;
  type?: "function" | "dynamic";
  execute?: (...args: unknown[]) => unknown;
  onInputAvailable?: (...args: unknown[]) => unknown;
  onInputStart?: (...args: unknown[]) => unknown;
  onInputDelta?: (...args: unknown[]) => unknown;
  needsApproval?: (...args: unknown[]) => unknown;
}

interface RuntimeProviderToolDefinition {
  type: "provider";
  id: string;
  args: Record<string, unknown>;
  inputSchema: RuntimeLazySchema;
  outputSchema?: RuntimeLazySchema;
  execute?: undefined;
  needsApproval?: undefined;
  toModelOutput?: undefined;
  onInputStart?: undefined;
  onInputDelta?: undefined;
  onInputAvailable?: undefined;
  supportsDeferredResults?: boolean;
}

export function createRuntimeJsonSchema(json: JsonSchema): RuntimeJsonSchema {
  return {
    ...json,
    jsonSchema: json,
  };
}

export function createLazyRuntimeJsonSchema(json: JsonSchema): RuntimeLazySchema {
  return () => createRuntimeJsonSchema(json);
}

export function createRuntimeTool(definition: {
  description: string;
  inputSchema: RuntimeJsonSchema;
  type?: "function" | "dynamic";
}): RuntimeToolDefinition {
  return {
    type: definition.type ?? "function",
    description: definition.description,
    inputSchema: definition.inputSchema,
  };
}

export function addRuntimeTool(
  toolSet: RuntimeToolSet,
  name: string,
  definition: RuntimeToolDefinition,
): void {
  toolSet[name] = definition;
}

export function createRuntimeProviderTool(definition: {
  id: string;
  args: Record<string, unknown>;
  inputSchema: RuntimeLazySchema;
  outputSchema?: RuntimeLazySchema;
  supportsDeferredResults?: boolean;
}): RuntimeProviderToolDefinition {
  return {
    type: "provider",
    id: definition.id,
    args: definition.args,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    supportsDeferredResults: definition.supportsDeferredResults,
  };
}
