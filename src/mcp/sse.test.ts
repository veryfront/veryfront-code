import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { SSEWriter } from "./sse.ts";

describe("mcp/sse", () => {
  it("formats a JSON-RPC message as an SSE event", () => {
    const writer = new SSEWriter();
    const event = writer.formatEvent({ jsonrpc: "2.0", id: 1, result: {} });
    assertEquals(event, "data: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n\n");
  });

  it("formats an SSE event with id", () => {
    const writer = new SSEWriter();
    const event = writer.formatEvent({ jsonrpc: "2.0", id: 1, result: {} }, "evt-1");
    assertEquals(event, "id: evt-1\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n\n");
  });

  it("formats a retry field", () => {
    const writer = new SSEWriter();
    const event = writer.formatRetry(5000);
    assertEquals(event, "retry: 5000\n\n");
  });

  it("formats an empty priming event with id", () => {
    const writer = new SSEWriter();
    const event = writer.formatPrimingEvent("stream-1");
    assertEquals(event, "id: stream-1\ndata: \n\n");
  });
});
