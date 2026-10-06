import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getModelCallCaptureReceiptSchema } from "./model-call-capture-receipt.ts";

const receipt = {
  eventId: "9007199254740993",
  projectId: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  modelCallId: "33333333-3333-4333-8333-333333333333",
};

describe("model call capture receipt", () => {
  it("preserves exact occurrence identity without converting it to a number", () => {
    assertEquals(getModelCallCaptureReceiptSchema().parse(receipt), receipt);
  });

  it("rejects absent binding fields, cursor substitutes, and additional authority claims", () => {
    for (
      const value of [
        { ...receipt, eventId: 9007199254740992 },
        { ...receipt, eventId: "" },
        { ...receipt, modelCallId: "caller-selected" },
        { ...receipt, projectId: undefined },
        { ...receipt, runId: undefined },
        { ...receipt, latestEventId: 9 },
        { ...receipt, canReadInput: true },
      ]
    ) {
      assertThrows(() => getModelCallCaptureReceiptSchema().parse(value));
    }
  });
});
