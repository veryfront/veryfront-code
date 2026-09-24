/** Internal source-owned diagnostic contract for integration operation failures. */
import {
  readIntegrationFailureCondition,
  readIntegrationHttpProblem,
} from "./integration-condition.ts";
import type {
  IntegrationFailureCondition,
  IntegrationHttpProblem,
} from "./integration-condition.ts";

interface IntegrationErrorFacts {
  outcomeUnknown: boolean;
  interrupted?: boolean;
  kind?: "http" | "transport" | "invalid_response" | "project_binding" | "unsupported_precondition";
  httpStatus?: number;
  httpProblem?: IntegrationHttpProblem;
  condition?: IntegrationFailureCondition;
}
export function createIntegrationErrorContext(
  facts: IntegrationErrorFacts,
): Record<string, unknown> {
  return { integrationOperation: true, ...facts, automaticReplay: false, retryable: false };
}
function dataProperties(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key];
      if (descriptor && "value" in descriptor) result[key] = descriptor.value;
    }
    return result;
  } catch {
    return undefined;
  }
}
/** Recognizes only an own data discriminator; validation still occurs before serialization. */
export function isIntegrationErrorContext(value: unknown): boolean {
  return dataProperties(value)?.integrationOperation === true;
}
/** Copy only validated safe facts. Accessors, prototypes, extensions and native payloads are excluded. */
export function readIntegrationErrorContext(value: unknown): Record<string, unknown> | undefined {
  const data = dataProperties(value);
  if (
    !data || data.integrationOperation !== true || typeof data.outcomeUnknown !== "boolean" ||
    data.automaticReplay !== false || data.retryable !== false
  ) return undefined;
  const condition = readIntegrationFailureCondition(dataProperties(data.condition));
  const httpProblem = readIntegrationHttpProblem(dataProperties(data.httpProblem));
  const kind = typeof data.kind === "string" &&
      ["http", "transport", "invalid_response", "project_binding", "unsupported_precondition"]
        .includes(data.kind)
    ? data.kind
    : undefined;
  return {
    ...(kind ? { kind } : {}),
    ...(data.interrupted === true ? { interrupted: true } : {}),
    outcomeUnknown: data.outcomeUnknown,
    automaticReplay: false,
    retryable: false,
    ...(typeof data.httpStatus === "number" && Number.isInteger(data.httpStatus) &&
        data.httpStatus >= 400 && data.httpStatus <= 599
      ? { httpStatus: data.httpStatus }
      : {}),
    ...(httpProblem ? { httpProblem } : {}),
    ...(condition ? { condition } : {}),
  };
}

/** Read only an own data context from the original throwable; generic boundaries discard it. */
export function readIntegrationThrowableContext(
  error: unknown,
): Record<string, unknown> | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "context");
    return descriptor && "value" in descriptor
      ? readIntegrationErrorContext(descriptor.value)
      : undefined;
  } catch {
    return undefined;
  }
}
