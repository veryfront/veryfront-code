import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";

const inferenceCredentials = new WeakMap<object, string>();
const IntrinsicReflectApply = Reflect.apply;
const WeakMapGet = WeakMap.prototype.get;
const WeakMapSet = WeakMap.prototype.set;

function getStoredHostedInferenceCredential(
  request: ParsedHostedChatRequest,
): string | undefined {
  const storedCredential: unknown = IntrinsicReflectApply(
    WeakMapGet,
    inferenceCredentials,
    [request],
  );
  return typeof storedCredential === "string" ? storedCredential : undefined;
}

/** @internal Bind a verified control-plane inference credential without exposing it on the request. */
export function registerHostedInferenceCredential(
  request: ParsedHostedChatRequest,
  credential: string | undefined,
): void {
  if (!credential) return;
  IntrinsicReflectApply(WeakMapSet, inferenceCredentials, [request, credential]);
}

/** @internal Read the verified credential without exposing it on the request value. */
export function getHostedInferenceCredential(
  request: ParsedHostedChatRequest,
): string | undefined {
  return getStoredHostedInferenceCredential(request);
}
