import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createStreamState } from "./chat-stream-handler.ts";
import { createStreamLifecycleShadow } from "./stream-lifecycle-shadow.ts";

describe("stream lifecycle shadow", () => {
  it("reports only bounded divergence categories", () => {
    const shadow = createStreamLifecycleShadow({
      availableToolNames: ["create_file"],
      providerExecutedToolNames: [],
    });
    shadow.observePart({ type: "text-delta", text: "shadow secret" });
    const report = shadow.compareLegacySnapshot({
      ...createStreamState(),
      accumulatedText: "different secret",
    });
    assertEquals(report, { count: 1, categories: ["text"] });
    assertEquals(JSON.stringify(report).includes("secret"), false);
  });

  it("reports no divergence when legacy and shadow agree", () => {
    const shadow = createStreamLifecycleShadow({
      availableToolNames: ["create_file"],
      providerExecutedToolNames: [],
    });
    shadow.observePart({ type: "text-delta", text: "hello" });
    shadow.observePart({ type: "finish", finishReason: "stop" });
    const report = shadow.compareLegacySnapshot({
      ...createStreamState(),
      accumulatedText: "hello",
      finishReason: "stop",
    });
    assertEquals(report, { count: 0, categories: [] });
  });

  it("never reads from the provider", () => {
    const shadow = createStreamLifecycleShadow({
      availableToolNames: [],
      providerExecutedToolNames: [],
    });
    assertEquals("next" in shadow, false);
    assertEquals("open" in shadow, false);
  });
});
