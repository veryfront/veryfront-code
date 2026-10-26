import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { connectors } from "./_data.ts";
import { executeLocalIntegrationEndpoint } from "./local-endpoint-executor.ts";
import { MAX_INTEGRATION_TOOL_CALL_RESPONSE_BYTES } from "./limits.ts";

const tool = connectors.find((connector) => connector.name === "drive")!.tools.find(
  (tool) => tool.id === "drive__export_file",
)!;

function exportText(response: Response): Promise<unknown> {
  return executeLocalIntegrationEndpoint({
    connectorName: "drive",
    toolId: "drive__export_file",
    endpoint: tool.endpoint!,
    args: { fileId: "demo-doc", mimeType: "text/plain" },
    authHeaders: { Authorization: "Bearer synthetic" },
    allowedOrigin: "https://www.googleapis.com",
    transport: () => Promise.resolve(response),
  });
}

describe("Drive text export responses", () => {
  it("returns readable Unicode content and its media type", async () => {
    assertEquals(
      await exportText(
        new Response("Demo café 東京", {
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
      ),
      { content: "Demo café 東京", content_type: "text/plain" },
    );
  });

  it("preserves CSV text exports", async () => {
    assertEquals(
      await exportText(
        new Response("name,value\nDemo,42", {
          headers: { "content-type": "text/csv; charset=utf-8" },
        }),
      ),
      { content: "name,value\nDemo,42", content_type: "text/csv" },
    );
  });

  it("permits encoded text only for GET without a transform", async () => {
    for (
      const override of [{ method: "POST" as const }, {
        response: { encoding: "text" as const, transform: "content" },
      }]
    ) {
      await assertRejects(() =>
        executeLocalIntegrationEndpoint({
          connectorName: "drive",
          toolId: "drive__export_file",
          endpoint: { ...tool.endpoint!, ...override },
          args: { fileId: "demo-doc" },
          authHeaders: {},
          allowedOrigin: "https://www.googleapis.com",
          transport: () => {
            throw new Error("must not fetch");
          },
        })
      );
    }
  });

  it("rejects binary content and invalid UTF-8 instead of corrupting it", async () => {
    for (
      const response of [
        new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } }),
        new Response(new Uint8Array([0xff]), { headers: { "content-type": "text/plain" } }),
      ]
    ) await assertRejects(() => exportText(response));
  });

  it("rejects partial or oversized exports", async () => {
    for (
      const response of [
        new Response(null, { status: 204 }),
        new Response("partial", { status: 206, headers: { "content-type": "text/plain" } }),
        new Response("a".repeat(MAX_INTEGRATION_TOOL_CALL_RESPONSE_BYTES + 1), {
          headers: { "content-type": "text/plain" },
        }),
      ]
    ) await assertRejects(() => exportText(response));
  });
});
