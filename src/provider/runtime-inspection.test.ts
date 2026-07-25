import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime } from "./types.ts";
import {
  getModelRuntimeId,
  getModelRuntimeProvider,
  isLocalModelRuntime,
} from "./runtime-inspection.ts";

function runtimeWith(metadata: PropertyDescriptorMap): ModelRuntime {
  return Object.defineProperties({
    async doGenerate() {
      return {};
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  }, metadata) as ModelRuntime;
}

describe("provider/runtime-inspection", () => {
  it("reads model metadata accessors once before validating their value", () => {
    let modelIdReads = 0;
    const model = runtimeWith({
      modelId: {
        get() {
          modelIdReads += 1;
          return modelIdReads === 1 ? "local/demo" : undefined;
        },
      },
    });

    assertEquals(getModelRuntimeId(model), "local/demo");
    assertEquals(modelIdReads, 1);
  });

  it("reads provider metadata accessors once before validating their value", () => {
    let providerReads = 0;
    const model = runtimeWith({
      provider: {
        get() {
          providerReads += 1;
          return providerReads === 1 ? "local" : undefined;
        },
      },
    });

    assertEquals(getModelRuntimeProvider(model), "local");
    assertEquals(providerReads, 1);
  });

  it("classifies stateful local metadata without re-reading it", () => {
    let modelIdReads = 0;
    const model = runtimeWith({
      modelId: {
        get() {
          modelIdReads += 1;
          return modelIdReads === 1 ? "local/demo" : undefined;
        },
      },
    });

    assertEquals(isLocalModelRuntime(model), true);
    assertEquals(modelIdReads, 1);
  });
});
