// This security boundary test intentionally mutates shared-realm prototypes,
// so it belongs in the semantic integration suite rather than a unit module.
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ProviderReplayCheckpoint } from "#veryfront/agent/runtime/provider-replay.ts";
import { createRunScopedProviderReplayCheckpointPersister } from "#veryfront/internal-agents/provider-replay-checkpoint-persister.ts";

const RUN_ID = "run_checkpoint_1";
const MESSAGE_ID = "10000000-1000-4000-8000-100000000001";
const testApply = Reflect.apply;

function checkpoint(): ProviderReplayCheckpoint {
  return {
    version: 1,
    messageId: MESSAGE_ID,
    provider: "anthropic",
    providerBlocks: [{
      type: "provider-block",
      provider: "anthropic",
      block: { type: "thinking", thinking: "", signature: "<REDACTED>" },
    }],
    providerBlockPositions: [0],
    providerMessageBlockCounts: [1],
    totalPartCount: 1,
  };
}

describe("run-scoped provider replay checkpoint intrinsic boundary", () => {
  it("keeps credential validation on captured intrinsics after project poisoning", async () => {
    const token = "writer-token-that-must-stay-private";
    const nativeTrim = String.prototype.trim;
    const nativeStringValueOf = String.prototype.valueOf;
    const nativeEncode = TextEncoder.prototype.encode;
    let observedTokenCalls = 0;

    try {
      String.prototype.trim = function () {
        const value = testApply(nativeStringValueOf, this, []) as string;
        if (value === token) observedTokenCalls++;
        return testApply(nativeTrim, this, []) as string;
      };
      TextEncoder.prototype.encode = (function (this: TextEncoder, value = "") {
        if (value === token) observedTokenCalls++;
        return testApply(nativeEncode, this, [value]) as Uint8Array;
      }) as typeof TextEncoder.prototype.encode;

      const persist = createRunScopedProviderReplayCheckpointPersister({
        apiUrl: "https://api.example.test",
        runId: RUN_ID,
        runEventAppendToken: token,
        fetch: () => Promise.resolve(Response.json({ appended_count: 1 })),
      });
      if (!persist) throw new Error("Expected a checkpoint persister");
      await persist(checkpoint());
    } finally {
      String.prototype.trim = nativeTrim;
      TextEncoder.prototype.encode = nativeEncode;
    }

    assertEquals(observedTokenCalls, 0);
  });
});
