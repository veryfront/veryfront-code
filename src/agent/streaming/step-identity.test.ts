import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createAgUiChatUiChunkEncoder } from "../ag-ui/chat-ui-chunk-encoder.ts";
import { ConversationRunEventEncoder } from "../conversation/run-events.ts";
import { createMirroredStepChunk, getStepIdentity, retainStepIdentity } from "./step-identity.ts";

describe("private mirrored step identity", () => {
  it("keeps a validated producer identity ahead of local formatting allocation", () => {
    const producerStepId = "11111111-1111-4111-8111-111111111111";
    const chunk = createMirroredStepChunk({ type: "start-step" }, producerStepId);
    assertEquals(getStepIdentity(chunk), producerStepId);
    assertEquals(JSON.stringify(chunk), '{"type":"start-step"}');
    assertEquals(Object.getOwnPropertySymbols(chunk), []);

    const durable = new ConversationRunEventEncoder();
    const live = createAgUiChatUiChunkEncoder();
    assertEquals(durable.encode(chunk)[0]?.stepId, producerStepId);
    assertEquals(live.encode(chunk)[0]?.payload.stepId, producerStepId);
    assertEquals(durable.encode({ type: "finish-step" })[0]?.stepId, producerStepId);
    assertEquals(live.encode({ type: "finish-step" })[0]?.payload.stepId, producerStepId);
  });

  it("retains identity only through the explicit private normalization seam", () => {
    const chunk = createMirroredStepChunk({ type: "start-step" });
    const normalized = retainStepIdentity(chunk, { type: "step-start" });
    assertEquals(getStepIdentity(normalized), getStepIdentity(chunk));
    assertEquals(getStepIdentity({ ...chunk }), undefined);
    const decoded: unknown = JSON.parse(JSON.stringify(chunk));
    if (typeof decoded !== "object" || decoded === null) throw new TypeError("Expected chunk");
    assertEquals(getStepIdentity(decoded), undefined);
    assertEquals(JSON.stringify(normalized), '{"type":"step-start"}');
  });

  it("ignores caller fields when allocating a mirrored occurrence", () => {
    const caller: Parameters<typeof createMirroredStepChunk>[0] & { stepId: string } = {
      type: "start-step",
      stepId: "caller-forged-id",
    };
    const chunk = createMirroredStepChunk(caller);
    assertEquals(getStepIdentity(caller), undefined);
    assertNotEquals(getStepIdentity(chunk), caller.stepId);
    assertEquals(typeof getStepIdentity(chunk), "string");
    const next = createMirroredStepChunk(caller);
    assertNotEquals(getStepIdentity(next), getStepIdentity(chunk));
  });
});
