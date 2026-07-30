import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime } from "./types.ts";
import {
  getModelRuntimeId,
  getModelRuntimeProvider,
  isLocalModelRuntime,
  supportsModelRuntimeToolCalling,
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

  it("classifies only runtimes that explicitly declare server-local execution", () => {
    let executionModeReads = 0;
    const model = runtimeWith({
      executionMode: {
        get() {
          executionModeReads += 1;
          return executionModeReads === 1 ? "server-local" : undefined;
        },
      },
    });

    assertEquals(isLocalModelRuntime(model), true);
    assertEquals(executionModeReads, 1);
    assertEquals(
      isLocalModelRuntime(runtimeWith({
        provider: { value: "local" },
        modelId: { value: "local/demo" },
      })),
      false,
    );
  });

  it("keeps tool support independent from execution placement", () => {
    assertEquals(
      supportsModelRuntimeToolCalling(runtimeWith({
        executionMode: { value: "server-local" },
        runtimeCapabilities: { value: { toolCalling: true } },
      })),
      true,
    );
    assertEquals(
      supportsModelRuntimeToolCalling(runtimeWith({
        executionMode: { value: "remote" },
        runtimeCapabilities: { value: { toolCalling: false } },
      })),
      false,
    );
    assertEquals(supportsModelRuntimeToolCalling(runtimeWith({})), true);
  });

  it("rejects malformed tool capability metadata", () => {
    assertThrows(
      () =>
        supportsModelRuntimeToolCalling(runtimeWith({
          runtimeCapabilities: { value: { toolCalling: "sometimes" } },
        })),
      TypeError,
      "must be a boolean",
    );
  });
});
