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
const apply = Reflect.apply;
// Capture the host's branded accessor during trusted framework bootstrap.
const domExceptionName = typeof DOMException === "function"
  ? getOwnPropertyDescriptor(DOMException.prototype, "name")?.get
  : undefined;
// Deno's host accessor reads symbol-backed WebIDL slots, unlike Node's
// internal-slot accessor. Require those captured keys to remain own data.
const domExceptionSlots = typeof DOMException === "function"
  ? Object.getOwnPropertySymbols(new DOMException())
  : [];

function hasSafePrototypeChain(value: object): boolean {
  let prototype: object | null = value;
  for (let depth = 0; depth < 32; depth++) {
    if (prototype === null) return true;
    if (isProxyWithoutHooks(prototype)) return false;
    prototype = getPrototypeOf(prototype);
  }
  return false;
}

function nativeDomExceptionName(value: object): unknown {
  if (!domExceptionName) return undefined;
  try {
    for (const key of domExceptionSlots) {
      const descriptor = getOwnPropertyDescriptor(value, key);
      if (!descriptor || !hasOwn(descriptor, "value")) return undefined;
    }
    return apply(domExceptionName, value, []);
  } catch {
    return undefined;
  }
}

function ownData(value: object, key: string): unknown {
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

function errorName(error: object, domName: unknown) {
  const descriptor = getOwnPropertyDescriptor(error, "name");
  if (descriptor && !hasOwn(descriptor, "value")) return "redacted";
  if (!descriptor) {
    const prototype = getPrototypeOf(error);
    if (prototype === null || isProxyWithoutHooks(prototype)) return "redacted";
    const inherited = getOwnPropertyDescriptor(prototype, "name");
    if (inherited && !hasOwn(inherited, "value") && domName === undefined) return "redacted";
  }
  const nativeName = isNativeErrorWithoutHooks(error)
    ? readNativeErrorNameWithoutHooks(error)
    : undefined;
  const name = descriptor ? nativeName : domName ?? nativeName;
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

/** Fixed metadata only; no messages, stacks or project-owned accessors. */
export function agentServiceFailureDiagnostic(stage: AgentServiceFailureStage, error: unknown): {
  stage: AgentServiceFailureStage;
  errorName: ReturnType<typeof errorName>;
  transportCode: ReturnType<typeof transportCode>;
} {
  const redacted = { stage, errorName: "redacted", transportCode: "redacted" } as const;
  if (
    !canIdentifyProxyWithoutHooks || isProxyWithoutHooks(error) ||
    !isNativeErrorWithoutHooks(error)
  ) {
    return redacted;
  }
  try {
    // The host WebIDL brand check may traverse the entire prototype chain.
    if (!hasSafePrototypeChain(error)) return redacted;
    const domName = nativeDomExceptionName(error);
    let code: ReturnType<typeof transportCode> = transportCode(ownData(error, "code"));
    if (code === "redacted") {
      const cause = ownData(error, "cause");
      if (!isProxyWithoutHooks(cause) && isNativeErrorWithoutHooks(cause)) {
        code = transportCode(ownData(cause, "code"));
      }
    }
    return { stage, errorName: errorName(error, domName), transportCode: code };
  } catch {
    return redacted;
  }
}
