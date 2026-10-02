import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createGoogleModelRuntime } from "./google-provider.ts";
import { streamGoogleCompatibleParts } from "./google-stream.ts";

function response(name: string) {
  return {
    candidates: [{
      content: { parts: [{ functionCall: { name, args: {} } }] },
      finishReason: "STOP",
    }],
  };
}

describe("Google tool identities across model steps", () => {
  it("keeps streamed discovery and execution distinct and internally correlated", async () => {
    const readCall = async (name: string) => {
      const body = new Response(`data: ${JSON.stringify(response(name))}\n\n`).body!;
      const parts: Record<string, unknown>[] = [];
      for await (const part of streamGoogleCompatibleParts(body)) {
        parts.push(part as Record<string, unknown>);
      }
      const call = parts.find((part) => part.type === "tool-call")!;
      assertEquals(parts.find((part) => part.type === "tool-input-start")?.id, call.toolCallId);
      assertEquals(parts.find((part) => part.type === "tool-input-delta")?.id, call.toolCallId);
      return call.toolCallId;
    };
    assertNotEquals(await readCall("tool_search"), await readCall("veryfront__list_files"));
  });

  it("keeps generated calls distinct across responses", async () => {
    const runtime = createGoogleModelRuntime({
      apiKey: "test-key",
      fetch: () => Promise.resolve(Response.json(response("lookup"))),
    }, "gemini-2.5-pro");
    const first = await runtime.doGenerate({ prompt: [] });
    const second = await runtime.doGenerate({ prompt: [] });
    const id = (result: typeof first) => result.content?.find((part) => part.type === "tool-call");
    assertNotEquals(id(first), id(second));
  });
});
