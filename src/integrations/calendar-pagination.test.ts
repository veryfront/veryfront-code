import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { maskOldToolOutputs } from "#veryfront/chat/message-prep.ts";
import type { ProviderModelMessage } from "#veryfront/chat/types.ts";
import { connectors } from "./_data.ts";
import { executeLocalIntegrationEndpoint } from "./local-endpoint-executor.ts";

const TOKEN = "opaque+/=next-page";

for (
  const [toolId, collection] of [
    ["calendar__list_events", "events"],
    ["calendar__list_calendars", "calendars"],
  ] as const
) {
  const endpoint = connectors.find((connector) => connector.name === "calendar")
    ?.tools.find((tool) => tool.id === toolId)?.endpoint;
  assertExists(endpoint);
  const baseArgs = toolId === "calendar__list_events" ? { calendarId: "primary" } : {};

  describe(toolId, () => {
    it("returns the native page and forwards its continuation token to the next request", async () => {
      const first = { kind: "calendar#page", items: [{ id: "first" }], nextPageToken: TOKEN };
      const last = { kind: "calendar#page", items: [{ id: "second" }], nextSyncToken: "sync" };
      const requests: URL[] = [];
      const execute = (args: Record<string, unknown>) =>
        executeLocalIntegrationEndpoint({
          connectorName: "calendar",
          toolId,
          endpoint,
          args: { ...baseArgs, maxResults: 1, ...args },
          authHeaders: {},
          allowedOrigin: "https://www.googleapis.com",
          transport: ({ url }) => {
            requests.push(url);
            return Promise.resolve(Response.json(requests.length === 1 ? first : last));
          },
        });
      assertEquals(await execute({}), first);
      assertEquals(await execute({ pageToken: TOKEN }), last);
      assertEquals(requests[0]!.searchParams.has("pageToken"), false);
      assertEquals(requests[1]!.searchParams.get("pageToken"), TOKEN);
      assertEquals(requests[1]!.searchParams.get("maxResults"), "1");
    });

    it("preserves an empty terminal page without inventing a continuation token", async () => {
      const page = { items: [], nextSyncToken: "sync" };
      assertEquals(
        await executeLocalIntegrationEndpoint({
          connectorName: "calendar",
          toolId,
          endpoint,
          args: baseArgs,
          authHeaders: {},
          allowedOrigin: "https://www.googleapis.com",
          transport: () => Promise.resolve(Response.json(page)),
        }),
        page,
      );
    });

    for (
      const [label, items, nextPageToken] of [
        ["nonempty page", [{ id: "first", summary: "First" }], TOKEN],
        ["empty intermediate page", [], TOKEN],
        ["empty terminal page", [], undefined],
        ["invalid nonempty collection", [null], TOKEN],
      ] as const
    ) {
      it(`retains the paging evidence for historical ${label}`, () => {
        const page = {
          items: [...items],
          ...(nextPageToken ? { nextPageToken } : {}),
          debug: "provider metadata ".repeat(400),
        };
        const messages: ProviderModelMessage[] = [
          { role: "user", content: "Read the first page" },
          {
            role: "assistant",
            content: [{ type: "tool-call", toolCallId: "page", toolName: toolId, input: {} }],
          },
          {
            role: "tool",
            content: [{
              type: "tool-result",
              toolCallId: "page",
              toolName: toolId,
              output: { type: "json", value: page },
            }],
          },
          { role: "user", content: "Continue from that result" },
        ];
        const masked = maskOldToolOutputs(messages)[2];
        if (masked?.role !== "tool" || masked.content[0]?.output.type !== "text") {
          throw new Error("Expected a compact historical tool result");
        }
        const output = masked.content[0].output.value;
        if (label === "invalid nonempty collection") {
          assertStringIncludes(output, "output omitted");
          return;
        }
        const summary = JSON.parse(output);
        assertEquals(summary.nextPageToken, nextPageToken);
        assertEquals(summary[`${collection}Count`], items.length);
        assertEquals(summary[collection], items);
        assertEquals(summary.debug, undefined);
      });
    }
  });
}
