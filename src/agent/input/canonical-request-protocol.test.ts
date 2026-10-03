import { computeHash } from "#veryfront/utils/hash-utils.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  createInputRequest,
  getFormInputToolInputSchema,
  getInputRequest,
} from "./request-protocol.ts";

it("creates and reads canonical input resources with stable mutation identity", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const toolCallId = "tool-" + "x".repeat(123);
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    requests.push(new Request(input, init));
    return Promise.resolve(
      Response.json({
        input_request_id: id,
        project_id: id,
        run_id: id,
        conversation_id: id,
        tool_call_id: toolCallId,
        title: "Choose",
        fields: [
          { name: "answer", label: "Answer", type: "text", required: true, default: "preset" },
          { name: "count", label: "Count", type: "number", default: 3 },
          { name: "enabled", label: "Enabled", type: "checkbox", default: true },
        ],
        status: "open",
        requested_responder_type: "human",
        response: null,
        created_at: "2026-10-03T12:00:00Z",
      }),
    );
  };
  try {
    const created = await createInputRequest({
      authToken: "invocation",
      apiUrl: "https://api.example.test",
      conversationId: id,
      runId: "original-public-id",
      canonicalRunId: id,
      toolCallId,
      form: getFormInputToolInputSchema().parse({
        title: "Choose",
        fields: [
          { name: "answer", label: "Answer", type: "text", required: true, defaultValue: "preset" },
          { name: "count", label: "Count", type: "number", defaultValue: "3" },
          { name: "enabled", label: "Enabled", type: "checkbox", defaultValue: true },
          { name: "secret", label: "Secret", type: "password", defaultValue: "must-not-send" },
        ],
      }),
      expiresAt: "2026-10-03T13:00:00Z",
    });
    assertEquals(created.id, id);
    assertEquals(requests[0]!.url, `https://api.example.test/runs/${id}/input-requests`);
    assertEquals(
      requests[0]!.headers.get("Idempotency-Key"),
      `runtime-input:${await computeHash(`${id}:${toolCallId}`)}`,
    );
    assertEquals(requests[0]!.headers.get("Idempotency-Key")!.length <= 128, true);
    const body = await requests[0]!.json();
    assertEquals(body.run_id, undefined);
    assertEquals(body.kind, undefined);
    assertEquals(body.fields.map((field: { default?: unknown }) => field.default), [
      "preset",
      3,
      true,
      undefined,
    ]);
    assertEquals(
      created.fields.map((field) =>
        field !== null && typeof field === "object" && "defaultValue" in field
          ? field.defaultValue
          : undefined
      ),
      ["preset", "3", true],
    );
    await getInputRequest({
      authToken: "invocation",
      apiUrl: "https://api.example.test",
      conversationId: id,
      inputRequestId: id,
    });
    assertEquals(requests[1]!.url, `https://api.example.test/input-requests/${id}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
