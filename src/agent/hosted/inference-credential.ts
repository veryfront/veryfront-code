import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";
import type { AgentModelRuntimeResolver } from "../runtime/model-transport.ts";
import { resolveModel } from "#veryfront/provider";
import {
  createVeryfrontCloudModel,
  runWithVeryfrontCloudInferenceCredential,
} from "#veryfront/provider/veryfront-cloud/provider.ts";

const inferenceCredentials = new WeakMap<object, string>();
const VERYFRONT_CLOUD_MODEL_PREFIX = "veryfront-cloud/";
const IntrinsicReflectApply = Reflect.apply;
const WeakMapGet = WeakMap.prototype.get;
const WeakMapSet = WeakMap.prototype.set;

/** @internal Bind a verified control-plane inference credential without exposing it on the request. */
export function registerHostedInferenceCredential(
  request: ParsedHostedChatRequest,
  credential: string | undefined,
): void {
  if (!credential) return;
  IntrinsicReflectApply(WeakMapSet, inferenceCredentials, [request, credential]);
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
  if (typeof storedCredential !== "string") return undefined;
  return (modelId) => {
    if (modelId.startsWith(VERYFRONT_CLOUD_MODEL_PREFIX)) {
      return runWithVeryfrontCloudInferenceCredential(
        storedCredential,
        () => createVeryfrontCloudModel(modelId.slice(VERYFRONT_CLOUD_MODEL_PREFIX.length)),
      );
    }

    // Never let project/provider code inherit the run-scoped authority.
    return runWithVeryfrontCloudInferenceCredential(undefined, () => resolveModel(modelId));
  };
}
