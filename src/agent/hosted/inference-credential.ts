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
const EventTargetAddEventListener = EventTarget.prototype.addEventListener;
const EventTargetRemoveEventListener = EventTarget.prototype.removeEventListener;
const AbortSignalAbortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!
  .get!;

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
  options: { apiBaseUrl?: string; assertParentActive?: () => void } = {},
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
        ...(options.apiBaseUrl ? { apiBaseUrl: options.apiBaseUrl } : {}),
        assertInferenceCredentialActive() {
          options.assertParentActive?.();
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
  options: { apiBaseUrl?: string } = {},
): AgentModelRuntimeResolver | undefined {
  const storedCredential = inferenceCredentials.get(request);
  return typeof storedCredential === "string"
    ? createVeryfrontCloudInferenceModelResolver(storedCredential, options)
    : undefined;
}

const inheritedInferenceFactories = createPrivateWeakStore<
  object,
  (assertOwnerActive?: () => void) => AgentModelRuntimeResolver
>();

/** @internal Bind verified root inference authority to an owned runtime creation object. */
export function bindHostedChildInferenceAuthority(
  target: object,
  request: ParsedHostedChatRequest,
  options: { apiBaseUrl: string; signal?: AbortSignal },
): () => void {
  const credential = inferenceCredentials.get(request);
  if (!credential) return () => {};
  const signal = options.signal;
  const apiBaseUrl = options.apiBaseUrl;
  let active = true;
  const revoke = () => {
    active = false;
  };
  if (signal) {
    IntrinsicReflectApply(EventTargetAddEventListener, signal, ["abort", revoke, { once: true }]);
  }
  inheritedInferenceFactories.set(target, (assertOwnerActive) => {
    const assertParentActive = () => {
      assertOwnerActive?.();
      if (!active || (signal && IntrinsicReflectApply(AbortSignalAbortedGetter, signal, []))) {
        throw new TypeError("Hosted parent inference authority is no longer active");
      }
    };
    assertParentActive();
    return createVeryfrontCloudInferenceModelResolver(credential, {
      apiBaseUrl,
      assertParentActive,
    });
  });
  return () => {
    revoke();
    if (signal) IntrinsicReflectApply(EventTargetRemoveEventListener, signal, ["abort", revoke]);
  };
}

/** @internal Preserve private inference authority across owned context copies. */
export function inheritHostedChildInferenceAuthority(target: object, source: object): void {
  const factory = inheritedInferenceFactories.get(source);
  if (factory) inheritedInferenceFactories.set(target, factory);
}

/** @internal Create independent, single-call inference authority for a default child step. */
export function createHostedChildInferenceModelResolver(
  target: object,
): AgentModelRuntimeResolver | undefined {
  return inheritedInferenceFactories.get(target)?.();
}

/** @internal Restrict inherited authority to an immediate child's execution lifetime. */
export function scopeHostedChildInferenceAuthority(
  target: object,
  source: object,
  signal?: AbortSignal,
): () => void {
  const factory = inheritedInferenceFactories.get(source);
  if (!factory) return () => {};
  let active = true;
  const revoke = () => {
    active = false;
  };
  if (signal) {
    IntrinsicReflectApply(EventTargetAddEventListener, signal, ["abort", revoke, { once: true }]);
  }
  inheritedInferenceFactories.set(target, (assertDescendantActive) =>
    factory(() => {
      assertDescendantActive?.();
      if (!active || (signal && IntrinsicReflectApply(AbortSignalAbortedGetter, signal, []))) {
        throw new TypeError("Hosted child inference authority is no longer active");
      }
    }));
  return () => {
    revoke();
    if (signal) IntrinsicReflectApply(EventTargetRemoveEventListener, signal, ["abort", revoke]);
  };
}

/** @internal Own verified child authority from runtime construction through final cleanup. */
export async function createHostedRuntimeWithChildInferenceAuthority<
  T extends { cleanup: () => Promise<void> },
>(
  target: object,
  request: ParsedHostedChatRequest | undefined,
  options: { apiBaseUrl: string; signal?: AbortSignal },
  create: () => Promise<T>,
): Promise<T> {
  const revoke = request ? bindHostedChildInferenceAuthority(target, request, options) : () => {};
  try {
    const runtime = await create();
    let cleanupPromise: Promise<void> | undefined;
    return {
      ...runtime,
      cleanup: () => {
        revoke();
        return cleanupPromise ??= runtime.cleanup();
      },
    };
  } catch (error) {
    revoke();
    throw error;
  }
}
