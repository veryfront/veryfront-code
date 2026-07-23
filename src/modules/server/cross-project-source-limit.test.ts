import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  CrossProjectSourceEncodingError,
  CrossProjectSourceTooLargeError,
  readLimitedCrossProjectSource,
} from "./cross-project-source-limit.ts";

describe("modules/server/cross-project-source-limit", () => {
  it("rejects invalid byte limits", async () => {
    for (const maxBytes of [0, -1, Number.NaN, 1.5]) {
      await assertRejects(
        () => readLimitedCrossProjectSource(new Response("source"), "sensitive-url", maxBytes),
        RangeError,
        "maxBytes must be a positive safe integer",
      );
    }
  });

  it("rejects malformed UTF-8 instead of replacing bytes", async () => {
    const response = new Response(new Uint8Array([0xc3, 0x28]));

    await assertRejects(
      () => readLimitedCrossProjectSource(response, "sensitive-url"),
      CrossProjectSourceEncodingError,
      "valid UTF-8",
    );
  });

  it("cancels an unfinished response stream after decoding fails", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0xc3, 0x28]));
      },
      cancel() {
        cancelled = true;
      },
    });

    await assertRejects(
      () => readLimitedCrossProjectSource(new Response(body), "sensitive-url"),
      CrossProjectSourceEncodingError,
    );
    assertEquals(cancelled, true);
  });

  it("does not expose the registry URL in size errors", async () => {
    const secretUrl = "https://internal.example/tenant-secret/module.ts";

    const error = await assertRejects(
      () => readLimitedCrossProjectSource(new Response("too large"), secretUrl, 3),
      CrossProjectSourceTooLargeError,
    );

    assertEquals(error.message.includes(secretUrl), false);
  });
});
