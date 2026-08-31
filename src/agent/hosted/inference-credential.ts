import { createVeryfrontCloudInferenceModel } from "#veryfront/provider/veryfront-cloud/provider.ts";

import type { AgentModelRuntimeResolver } from "../runtime/model-transport.ts";
import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";

const inferenceCredentials = new WeakMap<object, string>();
const VERYFRONT_CLOUD_MODEL_PREFIX = "veryfront-cloud/";
const IntrinsicReflectApply = Reflect.apply;
const WeakMapGet = WeakMap.prototype.get;
const WeakMapSet = WeakMap.prototype.set;
Object.freeze(inferenceCredentials);

/** @internal Bind a verified control-plane inference credential without exposing it on the request. */
export function registerHostedInferenceCredential(
  request: ParsedHostedChatRequest,
  credential: string | undefined,
): void {
  if (!credential) return;
  IntrinsicReflectApply(WeakMapSet, inferenceCredentials, [request, credential]);
}

/** @internal Create a model resolver without exposing verified inference authority. */
export function createVeryfrontCloudInferenceModelResolver(
  credential: string,
): AgentModelRuntimeResolver {
  return (modelId) => {
    if (!modelId.startsWith(VERYFRONT_CLOUD_MODEL_PREFIX)) {
      return undefined;
    }

    return createVeryfrontCloudInferenceModel(
      modelId.slice(VERYFRONT_CLOUD_MODEL_PREFIX.length),
      credential,
    );
  };
}

/** @internal Create a model resolver without exposing verified inference authority. */
export function createHostedInferenceModelResolver(
  request: ParsedHostedChatRequest,
): AgentModelRuntimeResolver | undefined {
  const storedCredential: unknown = IntrinsicReflectApply(
    WeakMapGet,
    inferenceCredentials,
    [request],
  );
  return typeof storedCredential === "string"
    ? createVeryfrontCloudInferenceModelResolver(storedCredential)
    : undefined;
}
