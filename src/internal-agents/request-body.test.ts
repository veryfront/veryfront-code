import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  InternalAgentRequestBodyTooLargeError,
  readInternalAgentRequestBody,
} from "./request-body.ts";

describe("internal-agents/request-body", () => {
  it("returns an empty string when the request has no body", async () => {
    const request = new Request("https://veryfront.test/api/control-plane/runs/run_1/stream");

    assertEquals(await readInternalAgentRequestBody(request), "");
  });

  it("reads request bodies that stay within the configured limit", async () => {
    const request = new Request("https://veryfront.test/api/control-plane/runs/run_1/stream", {
      method: "POST",
      body: "ok",
    });

    assertEquals(await readInternalAgentRequestBody(request, 2), "ok");
  });

  it("maps oversized request bodies to an internal-agent-specific error", async () => {
    const request = new Request("https://veryfront.test/api/control-plane/runs/run_1/stream", {
      method: "POST",
      body: "too-large",
    });

    await assertRejects(
      () => readInternalAgentRequestBody(request, 3),
      InternalAgentRequestBodyTooLargeError,
      "Payload too large",
    );
  });

  it("rejects malformed UTF-8 instead of normalizing signed request bytes", async () => {
    const request = new Request("https://veryfront.test/api/control-plane/runs/run_1/stream", {
      method: "POST",
      body: new Uint8Array([0xc3, 0x28]),
    });

    await assertRejects(
      () => readInternalAgentRequestBody(request),
      Error,
      "valid UTF-8",
    );
  });

  it("preserves an explicit UTF-8 byte-order mark in the signed body", async () => {
    const request = new Request("https://veryfront.test/api/control-plane/runs/run_1/stream", {
      method: "POST",
      body: new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]),
    });

    assertEquals(await readInternalAgentRequestBody(request), "\uFEFF{}");
  });
});
