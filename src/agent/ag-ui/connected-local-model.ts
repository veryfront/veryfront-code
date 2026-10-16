import type { ModelRuntime } from "#veryfront/provider";
import {
  readVeryfrontCloudModelFacts,
  registerVeryfrontCloudModelFacts,
} from "#veryfront/provider/veryfront-cloud/model-catalog.ts";

const createObject = Object.create;

/** @internal Each retry reads current lease authority without exposing its credential. */
export function createRenewingLocalModel(
  readCredential: () => string,
  build: (credential: string) => ModelRuntime,
): ModelRuntime {
  let credential = readCredential();
  let model = build(credential);
  const current = () => {
    const next = readCredential();
    if (next !== credential) {
      model = build(next);
      credential = next;
    }
    return model;
  };
  const initialFacts = readVeryfrontCloudModelFacts(model);
  const wrapped: ModelRuntime = createObject(model, {
    doStream: {
      value: (options: Parameters<ModelRuntime["doStream"]>[0]) => current().doStream(options),
    },
    doGenerate: {
      value: (options: Parameters<ModelRuntime["doGenerate"]>[0]) => current().doGenerate(options),
    },
    prepare: {
      value: async (signal?: AbortSignal) => {
        await current().prepare?.(signal);
      },
    },
  });
  if (initialFacts) {
    registerVeryfrontCloudModelFacts(
      wrapped,
      () => readVeryfrontCloudModelFacts(current()) ?? initialFacts,
    );
  }
  return wrapped;
}
