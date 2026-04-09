import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { formatSSEEvent, formatSSEPrimingEvent, formatSSERetry } from "./sse.ts";

describe("mcp/sse", () => {
  it("formats a JSON-RPC message as an SSE event", () => {
    const event = formatSSEEvent({ jsonrpc: "2.0", id: 1, result: {} });
    assertEquals(event, 'data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n');
  });

  it("formats an SSE event with id", () => {
    const event = formatSSEEvent({ jsonrpc: "2.0", id: 1, result: {} }, "evt-1");
    assertEquals(event, 'id: evt-1\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n');
  });

  it("formats a retry field", () => {
    const event = formatSSERetry(5000);
    assertEquals(event, "retry: 5000\n\n");
  });

  it("formats an empty priming event with id", () => {
    const event = formatSSEPrimingEvent("stream-1");
    assertEquals(event, "id: stream-1\ndata: \n\n");
  });
});
