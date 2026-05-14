import { defineSchema } from "#veryfront/schemas/index.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import type { AgUiRuntimeRequest } from "../runtime/ag-ui-contract.ts";

export type AgUiForwardedConfigOptions<TConfig> = {
  schema: Schema<TConfig>;
  namespace?: string;
};

export function createAgUiRuntimeContextMap(
  input: Pick<AgUiRuntimeRequest, "context">,
): Map<string, string> {
  const contextMap = new Map<string, string>();

  for (const entry of input.context) {
    if ("description" in entry) {
      contextMap.set(entry.description, entry.value);
    }
  }

  return contextMap;
}

export function parseAgUiContextJsonValue(raw: string | undefined): unknown {
  if (raw === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function parseAgUiContextString(raw: string | undefined): string | undefined {
  const parsed = parseAgUiContextJsonValue(raw);
  return typeof parsed === "string" && parsed.trim().length > 0 ? parsed : undefined;
}

export function parseAgUiContextNullableString(raw: string | undefined): string | null | undefined {
  const parsed = parseAgUiContextJsonValue(raw);
  if (parsed === null) {
    return null;
  }

  return typeof parsed === "string" && parsed.trim().length > 0 ? parsed : undefined;
}

export function parseAgUiContextBoolean(raw: string | undefined): boolean | undefined {
  const parsed = parseAgUiContextJsonValue(raw);
  return typeof parsed === "boolean" ? parsed : undefined;
}

export function parseAgUiContextSchema<TValue>(
  raw: string | undefined,
  schema: Schema<TValue>,
): TValue | undefined {
  const parsed = parseAgUiContextJsonValue(raw);
  const result = schema.safeParse(parsed);
  return result.success ? result.data : undefined;
}

export function deriveAgUiForwardedConfig<TConfig>(
  input: Pick<AgUiRuntimeRequest, "forwardedProps">,
  options: AgUiForwardedConfigOptions<TConfig>,
): TConfig | undefined {
  const getRecordSchema = defineSchema((v) => v.record(v.string(), v.unknown()));
  const forwardedProps = getRecordSchema().safeParse(input.forwardedProps);
  if (!forwardedProps.success) {
    return undefined;
  }

  if (options.namespace) {
    const nestedConfig = options.schema.safeParse(forwardedProps.data[options.namespace]);
    if (nestedConfig.success) {
      return nestedConfig.data;
    }
  }

  const rootConfig = options.schema.safeParse(forwardedProps.data);
  return rootConfig.success ? rootConfig.data : undefined;
}
