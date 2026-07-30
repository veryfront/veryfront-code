/**
 * Transformers-backed server-local model and embedding extension.
 *
 * The extension owns the third-party runtime, model catalog, native pipeline
 * caches, and provider registration lifecycle. Core sees only the standard
 * model and embedding runtime contracts.
 *
 * @module extensions/ext-llm-transformers
 */

import type { ExtensionFactory } from "veryfront/extensions";
import { hasEmbeddingProvider, registerEmbeddingProvider } from "veryfront/embedding";
import { hasModelProvider, registerModelProvider } from "veryfront/provider";
import { createLocalEmbeddingModel } from "./embedding-runtime-adapter.ts";
import { disposeLocalEmbeddingRuntimes } from "./local-embedding-engine.ts";
import { disposeLocalModelRuntimes, resetTransformersRuntimeDependency } from "./local-engine.ts";
import { createLocalModel } from "./model-runtime-adapter.ts";
import type { LocalRuntimeLifecycle } from "./runtime-lifecycle.ts";

export const LocalModelProviderContract = "ModelProvider:local";
export const LocalEmbeddingProviderContract = "EmbeddingProvider:local";

function throwProviderConflict(kind: "model" | "embedding"): never {
  throw new Error(
    `Cannot set up ext-llm-transformers: the local ${kind} provider is already registered`,
  );
}

function throwLifecycleErrors(errors: unknown[]): void {
  if (errors.length === 0) return;
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(errors, "Failed to dispose Transformers runtimes");
}

const extTransformers: ExtensionFactory = () => {
  interface SetupGeneration {
    readonly abortController: AbortController;
    readonly detachContextAbort: () => void;
    readonly disposeEmbeddingRegistration: () => void;
    readonly disposeModelRegistration: () => void;
    readonly lifecycle: LocalRuntimeLifecycle;
  }

  let activeGeneration: SetupGeneration | undefined;
  let retiringGeneration: SetupGeneration | undefined;
  let teardownPromise: Promise<void> | undefined;

  return {
    name: "ext-llm-transformers",
    version: "0.1.0",
    contracts: {
      provides: [
        LocalModelProviderContract,
        LocalEmbeddingProviderContract,
      ],
    },
    capabilities: [
      {
        type: "env:read",
        keys: [
          "VERYFRONT_DISABLE_LOCAL_AI",
          "VERYFRONT_LOCAL_AI_DEVICE",
          "VERYFRONT_LOCAL_AI_MODEL_LOAD_TIMEOUT_MS",
          "VERYFRONT_LOCAL_AI_THINKING",
          "HF_TOKEN",
          "HF_ACCESS_TOKEN",
          "TESTING_REMOTELY",
          "npm_package_config_libvips",
        ],
      },
      { type: "fs:read", paths: [".cache/models"] },
      { type: "fs:write", paths: [".cache/models"] },
      { type: "native:ffi" },
      {
        type: "net:outbound",
        hosts: ["huggingface.co", "*.huggingface.co", "*.hf.co"],
      },
    ],
    setup(ctx) {
      if (activeGeneration) {
        throw new Error("ext-llm-transformers is already set up");
      }
      if (retiringGeneration || teardownPromise) {
        throw new Error("ext-llm-transformers teardown has not completed");
      }
      if (hasModelProvider("local")) throwProviderConflict("model");
      if (hasEmbeddingProvider("local")) throwProviderConflict("embedding");

      const abortController = new AbortController();
      const contextSignal = ctx.signal;
      const contextAbortReason = () =>
        contextSignal?.reason ?? new DOMException(
          "The Transformers extension context was revoked.",
          "AbortError",
        );
      const forwardContextAbort = () => {
        if (!abortController.signal.aborted) {
          abortController.abort(contextAbortReason());
        }
      };
      const detachContextAbort = () => {
        contextSignal?.removeEventListener("abort", forwardContextAbort);
      };
      const assertContextActive = () => {
        if (contextSignal?.aborted) throw contextAbortReason();
      };
      assertContextActive();
      contextSignal?.addEventListener("abort", forwardContextAbort, { once: true });
      const lifecycle: LocalRuntimeLifecycle = {
        signal: abortController.signal,
        assertActive() {
          if (activeGeneration?.lifecycle !== lifecycle || abortController.signal.aborted) {
            throw abortController.signal.reason ?? new DOMException(
              "The Transformers extension generation is no longer active.",
              "AbortError",
            );
          }
        },
      };
      const createModel = (modelId: string) => {
        lifecycle.assertActive();
        return createLocalModel(modelId, lifecycle);
      };
      const createEmbedding = (modelId: string) => {
        lifecycle.assertActive();
        return createLocalEmbeddingModel(modelId, lifecycle);
      };
      let disposeModel: (() => void) | undefined;
      let disposeEmbedding: (() => void) | undefined;
      try {
        assertContextActive();
        disposeModel = registerModelProvider("local", createModel);
        assertContextActive();
        disposeEmbedding = registerEmbeddingProvider(
          "local",
          createEmbedding,
        );
        assertContextActive();
        const generation: SetupGeneration = {
          abortController,
          detachContextAbort,
          disposeEmbeddingRegistration: disposeEmbedding,
          disposeModelRegistration: disposeModel,
          lifecycle,
        };
        activeGeneration = generation;
        ctx.provide(LocalModelProviderContract, createModel);
        assertContextActive();
        ctx.provide(LocalEmbeddingProviderContract, createEmbedding);
        assertContextActive();
        ctx.logger.debug(
          "[ext-llm-transformers] local model and embedding providers registered",
        );
      } catch (error) {
        activeGeneration = undefined;
        detachContextAbort();
        abortController.abort(
          new DOMException("Transformers extension setup failed.", "AbortError"),
        );
        const rollbackErrors: unknown[] = [];
        for (const dispose of [disposeEmbedding, disposeModel]) {
          if (!dispose) continue;
          try {
            dispose();
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
        }
        if (rollbackErrors.length === 0) throw error;
        retiringGeneration = {
          abortController,
          detachContextAbort,
          disposeEmbeddingRegistration: disposeEmbedding ?? (() => {}),
          disposeModelRegistration: disposeModel ?? (() => {}),
          lifecycle,
        };
        throw new AggregateError(
          [error, ...rollbackErrors],
          "Transformers extension setup failed and registration rollback was incomplete",
        );
      }
    },
    teardown() {
      if (teardownPromise) return teardownPromise;
      const generation = retiringGeneration ?? activeGeneration;
      if (!generation) return;

      if (activeGeneration === generation) {
        activeGeneration = undefined;
        retiringGeneration = generation;
        generation.detachContextAbort();
        generation.abortController.abort(
          new DOMException("The Transformers extension is shutting down.", "AbortError"),
        );
      }

      const registrationErrors: unknown[] = [];
      for (
        const dispose of [
          generation.disposeEmbeddingRegistration,
          generation.disposeModelRegistration,
        ]
      ) {
        try {
          dispose();
        } catch (error) {
          registrationErrors.push(error);
        }
      }

      const operation = (async () => {
        const results = await Promise.allSettled([
          disposeLocalEmbeddingRuntimes(),
          disposeLocalModelRuntimes(),
        ]);
        const errors = registrationErrors.concat(
          results.flatMap((result) => result.status === "rejected" ? [result.reason] : []),
        );
        throwLifecycleErrors(errors);
        resetTransformersRuntimeDependency();
        generation.detachContextAbort();
        if (retiringGeneration === generation) retiringGeneration = undefined;
      })();
      teardownPromise = operation;
      const clearTeardownPromise = () => {
        if (teardownPromise === operation) teardownPromise = undefined;
      };
      void operation.then(clearTeardownPromise, clearTeardownPromise);
      return operation;
    },
  };
};

export default extTransformers;
export { isLocalAIDisabled } from "./env.ts";
export {
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  DEFAULT_LOCAL_MODEL,
  getLocalEmbeddingModelIds,
  getLocalModelIds,
  resolveLocalEmbeddingModel,
  resolveLocalModel,
} from "./model-catalog.ts";
export type { ModelInfo } from "./model-catalog.ts";
