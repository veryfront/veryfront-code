import {
  canIdentifyProxyWithoutHooks,
  isNativeErrorWithoutHooks,
  isProxyWithoutHooks,
  readNativeErrorNameWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";

export type AgentServiceFailureStage =
  | "request-build"
  | "request-fetch"
  | "response-read"
  | "result-processing";

const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const hasOwn = Object.hasOwn;

function ownData(value: Error, key: string): unknown {
  const descriptor = getOwnPropertyDescriptor(value, key);
  return descriptor && hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

function transportCode(value: unknown) {
  switch (value) {
    case "ECONNREFUSED":
    case "ECONNRESET":
    case "ETIMEDOUT":
    case "ENOTFOUND":
    case "EAI_AGAIN":
    case "ECONNABORTED":
    case "EPIPE":
    case "UND_ERR_CONNECT_TIMEOUT":
    case "UND_ERR_HEADERS_TIMEOUT":
    case "UND_ERR_BODY_TIMEOUT":
    case "UND_ERR_SOCKET":
    case "ERR_STREAM_PREMATURE_CLOSE":
      return value;
    default:
      return "redacted";
  }
}

function errorName(error: Error) {
  const descriptor = getOwnPropertyDescriptor(error, "name");
  if (descriptor && !hasOwn(descriptor, "value")) return "redacted";
  if (!descriptor) {
    const prototype = getPrototypeOf(error);
    if (prototype === null || isProxyWithoutHooks(prototype)) return "redacted";
    const inherited = getOwnPropertyDescriptor(prototype, "name");
    if (inherited && !hasOwn(inherited, "value")) return "redacted";
  }
  const name = readNativeErrorNameWithoutHooks(error);
  switch (name) {
    case "Error":
    case "TypeError":
    case "SyntaxError":
    case "RangeError":
    case "AbortError":
    case "TimeoutError":
    case "AggregateError":
      return name;
    default:
      return "redacted";
  }
}

/** Fixed failure metadata only; never reads messages, stacks or accessors. */
export function agentServiceFailureDiagnostic(stage: AgentServiceFailureStage, error: unknown): {
  stage: AgentServiceFailureStage;
  errorName: ReturnType<typeof errorName>;
  transportCode: ReturnType<typeof transportCode>;
} {
  const redacted = { stage, errorName: "redacted", transportCode: "redacted" } as const;
  if (
    !canIdentifyProxyWithoutHooks || isProxyWithoutHooks(error) || !isNativeErrorWithoutHooks(error)
  ) {
    return redacted;
  }
  try {
    let code: ReturnType<typeof transportCode> = transportCode(ownData(error, "code"));
    if (code === "redacted") {
      const cause = ownData(error, "cause");
      if (!isProxyWithoutHooks(cause) && isNativeErrorWithoutHooks(cause)) {
        code = transportCode(ownData(cause, "code"));
      }
    }
    return { stage, errorName: errorName(error), transportCode: code };
  } catch {
    return redacted;
  }
}
