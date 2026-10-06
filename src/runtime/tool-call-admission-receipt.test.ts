import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getToolCallAdmissionReceiptSchema,
  getToolCallAdmissionWireReceiptSchema,
} from "./tool-call-admission-receipt.ts";

const receipt = {
  occurrenceId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
  admissionEventId: "9007199254740994",
  startEventId: "9007199254740993",
  toolCallId: "toolu_exact_raw",
  publicToolCallId: "toolu_public_raw",
  projectId: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
};

const wireReceipt = {
  occurrence_id: receipt.occurrenceId,
  admission_event_id: receipt.admissionEventId,
  start_event_id: receipt.startEventId,
  tool_call_id: receipt.toolCallId,
  public_tool_call_id: receipt.publicToolCallId,
  project_id: receipt.projectId,
  run_id: receipt.runId,
};

describe("tool call admission receipt", () => {
  it("normalizes only the private occurrence UUID", () => {
    assertEquals(getToolCallAdmissionReceiptSchema().parse(receipt), {
      ...receipt,
      occurrenceId: receipt.occurrenceId.toLowerCase(),
    });
  });

  it("rejects cursor substitutes, generated authority claims, and malformed raw ids", () => {
    for (
      const value of [
        { ...receipt, admissionEventId: 9007199254740994 },
        { ...receipt, admissionEventId: "" },
        { ...receipt, startEventId: "" },
        { ...receipt, occurrenceId: "toolu_exact_raw" },
        { ...receipt, toolCallId: "" },
        { ...receipt, publicToolCallId: "" },
        { ...receipt, latestEventId: 9 },
        { ...receipt, canReadInput: true },
      ]
    ) {
      assertThrows(() => getToolCallAdmissionReceiptSchema().parse(value));
    }
  });

  it("rejects unexpected wire authority fields before camel-case mapping", () => {
    assertThrows(() =>
      getToolCallAdmissionWireReceiptSchema().parse({
        ...wireReceipt,
        can_read_input: true,
      })
    );
  });
});
