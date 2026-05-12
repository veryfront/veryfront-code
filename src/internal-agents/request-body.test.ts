import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  InternalAgentRequestBodyTooLargeError,
  readInternalAgentRequestBody,
} from "./request-body.ts";

describe("internal-agents/request-body", () => {
  it("returns an empty string when the request has no body", async () => {
    const request = new Request("https://veryfront.test/internal/agents/stream");

    assertEquals(await readInternalAgentRequestBody(request), "");
  });

  it("reads request bodies that stay within the configured limit", async () => {
    const request = new Request("https://veryfront.test/internal/agents/stream", {
      method: "POST",
      body: "ok",
    });

    assertEquals(await readInternalAgentRequestBody(request, 2), "ok");
  });

  it("maps oversized request bodies to an internal-agent-specific error", async () => {
    const request = new Request("https://veryfront.test/internal/agents/stream", {
      method: "POST",
      body: "too-large",
    });

    await assertRejects(
      () => readInternalAgentRequestBody(request, 3),
      InternalAgentRequestBodyTooLargeError,
      "Payload too large",
    );
  });
});
