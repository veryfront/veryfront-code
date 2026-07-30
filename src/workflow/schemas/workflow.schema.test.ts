import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getApprovalDecisionSchema, getPendingApprovalSchema } from "./workflow.schema.ts";

describe("workflow approval schemas", () => {
  it("accepts canonical approval identities", () => {
    assertEquals(
      getApprovalDecisionSchema().safeParse({ approved: true, approver: "editor@example.com" })
        .success,
      true,
    );
    assertEquals(
      getPendingApprovalSchema().safeParse({
        id: "approval-1",
        nodeId: "review",
        message: "Review",
        payload: {},
        approvers: ["editor@example.com", "publisher@example.com"],
        requestedAt: new Date(),
        status: "pending",
      }).success,
      true,
    );
  });

  it("rejects noncanonical and duplicate approval identities", () => {
    for (const approver of [" editor@example.com", "editor@example.com ", " "]) {
      assertEquals(
        getApprovalDecisionSchema().safeParse({ approved: true, approver }).success,
        false,
      );
    }
    assertEquals(
      getPendingApprovalSchema().safeParse({
        id: "approval-1",
        nodeId: "review",
        message: "Review",
        payload: {},
        approvers: ["editor@example.com", "editor@example.com"],
        requestedAt: new Date(),
        status: "pending",
      }).success,
      false,
    );
  });
});
