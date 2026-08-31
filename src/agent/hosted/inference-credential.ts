import { createVeryfrontCloudInferenceModel } from "#veryfront/provider/veryfront-cloud/provider.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";

import {
  type AgentModelRuntimeResolver,
  registerModelRuntimeResolverRevoker,
} from "../runtime/model-transport.ts";
import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";

const inferenceCredentials = createPrivateWeakStore<object, string>();
const VERYFRONT_CLOUD_MODEL_PREFIX = "veryfront-cloud/";
const IntrinsicReflectApply = Reflect.apply;
const StringStartsWith = String.prototype.startsWith;

/** @internal Bind a verified control-plane inference credential without exposing it on the request. */
export function registerHostedInferenceCredential(
  request: ParsedHostedChatRequest,
  credential: string | undefined,
): void {
  if (!credential) return;
  inferenceCredentials.set(request, credential);
}

/** @internal Create a model resolver without exposing verified inference authority. */
export function createVeryfrontCloudInferenceModelResolver(
  credential: string,
): AgentModelRuntimeResolver {
  let active = true;
  const resolver: AgentModelRuntimeResolver = (modelId) => {
    if (!IntrinsicReflectApply(StringStartsWith, modelId, [VERYFRONT_CLOUD_MODEL_PREFIX])) {
      return undefined;
    }

    return createVeryfrontCloudInferenceModel(
      modelId.slice(VERYFRONT_CLOUD_MODEL_PREFIX.length),
      credential,
      {
        assertInferenceCredentialActive() {
          if (!active) {
            throw new TypeError("Run-scoped inference credential is no longer active");
          }
        },
      },
    );
  };
  registerModelRuntimeResolverRevoker(resolver, () => {
    active = false;
  });
  return resolver;
}

/** @internal Create a model resolver without exposing verified inference authority. */
export function createHostedInferenceModelResolver(
  request: ParsedHostedChatRequest,
): AgentModelRuntimeResolver | undefined {
  const storedCredential = inferenceCredentials.get(request);
  return typeof storedCredential === "string"
    ? createVeryfrontCloudInferenceModelResolver(storedCredential)
    : undefined;
}
