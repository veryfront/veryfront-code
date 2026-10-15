import "../test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { parseRunReadMemberV1 } from "./parser.ts";

function requested(fields: Record<string, unknown>) {
  return {
    kind: "canonical" as const,
    metadata: {
      event_id: 1,
      run_id: "run_test",
      storage: "persisted" as const,
      view: "diagnostic" as const,
      recorded_at: "2026-10-12T00:00:00Z",
      event_class: null,
      is_error: false,
      span_id: null,
      turn_id: null,
      unrecoverable_fields: [],
    },
    event: {
      specversion: "1.0" as const,
      vfversion: "1" as const,
      id: "1",
      source: "https://events.test.invalid/store/runs/run_test",
      subject: "run_test",
      runid: "run_test",
      runkind: "agent" as const,
      recordedat: "2026-10-12T00:00:00Z",
      type: "com.veryfront.run.requested",
      datacontenttype: "application/json" as const,
      dataschema: "urn:veryfront:events:1:data:run.requested:diagnostic",
      data: {
        type: "com.veryfront.run.requested",
        messages: [],
        tools: [],
        context: [],
        integrationConnectionBindings: [],
        agentSource: { type: "branch", branch: "main" },
        ...fields,
      },
    },
  };
}

describe("canonical producer source refinements", () => {
  it("counts bounded payload strings in UTF-16 code units", async () => {
    const valid = requested({ context: [{ type: "text", text: "😀".repeat(8192) }] });
    assertEquals<unknown>(await parseRunReadMemberV1(valid), valid);
    await assertRejects(
      () =>
        parseRunReadMemberV1(requested({ context: [{ type: "text", text: "😀".repeat(8193) }] })),
      TypeError,
    );
  });
  it("enforces JSON context byte limits after structural validation", async () => {
    const valid = requested({ context: [{ type: "json", data: { x: "é".repeat(8188) } }] });
    assertEquals<unknown>(await parseRunReadMemberV1(valid), valid);
    await assertRejects(
      () =>
        parseRunReadMemberV1(
          requested({ context: [{ type: "json", data: { x: "é".repeat(8189) } }] }),
        ),
      TypeError,
    );
  });
  it("rejects untrimmed binding identifiers and preserves accepted data", async () => {
    const valid = requested({
      integrationConnectionBindings: [{
        integration: "github",
        connectionId: "11111111-1111-4111-8111-111111111111",
        connectionGenerationId: "11111111-1111-4111-8111-111111111111",
        ownerId: "11111111-1111-4111-8111-111111111111",
        scope: "user",
        ownerKind: "user",
      }],
    });
    assertEquals<unknown>(await parseRunReadMemberV1(valid), valid);
    await assertRejects(
      () =>
        parseRunReadMemberV1(
          requested({
            integrationConnectionBindings: [{
              integration: " github ",
              connectionId: "11111111-1111-4111-8111-111111111111",
              connectionGenerationId: "11111111-1111-4111-8111-111111111111",
              ownerId: "11111111-1111-4111-8111-111111111111",
              scope: "user",
              ownerKind: "user",
            }],
          }),
        ),
      TypeError,
    );
  });
});
