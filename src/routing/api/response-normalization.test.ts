import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  deserializeRouteResponse,
  MAX_WORKER_RESPONSE_BODY_BYTES,
  MAX_WORKER_RESPONSE_HEADERS,
  serializeRouteResponse,
} from "./response-normalization.ts";

describe("routing/api/response-normalization", () => {
  it("serializes a bounded response and omits the body for HEAD", async () => {
    const serialized = await serializeRouteResponse(
      new Response("hello", {
        status: 201,
        headers: { "x-test": "yes" },
      }),
      "GET",
    );
    assertEquals(serialized.status, 201);
    assertEquals(new TextDecoder().decode(serialized.body ?? undefined), "hello");

    const head = await serializeRouteResponse(new Response("ignored"), "HEAD");
    assertEquals(head.body, null);
  });

  it("rejects an oversized declared response without pulling its body", async () => {
    let pulls = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls++;
          controller.enqueue(new Uint8Array([1]));
          controller.close();
        },
      }, { highWaterMark: 0 }),
      {
        headers: {
          "content-length": String(MAX_WORKER_RESPONSE_BODY_BYTES + 1),
        },
      },
    );

    await assertRejects(
      () => serializeRouteResponse(response),
      Error,
      "response body exceeds",
    );
    assertEquals(pulls, 0);
  });

  it("cancels a chunked response as soon as it crosses the limit", async () => {
    const chunks = [
      new Uint8Array(MAX_WORKER_RESPONSE_BODY_BYTES),
      new Uint8Array(1),
    ];
    let pulls = 0;
    let cancellations = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          const chunk = chunks[pulls++];
          if (chunk) controller.enqueue(chunk);
          else controller.close();
        },
        cancel() {
          cancellations++;
        },
      }, { highWaterMark: 0 }),
    );

    await assertRejects(
      () => serializeRouteResponse(response),
      Error,
      "response body exceeds",
    );
    assertEquals(pulls, 2);
    assertEquals(cancellations, 1);
  });

  it("rejects oversized transferred bodies and header catalogs", () => {
    assertThrows(
      () =>
        deserializeRouteResponse({
          status: 200,
          statusText: "OK",
          headers: [],
          body: new Uint8Array(MAX_WORKER_RESPONSE_BODY_BYTES + 1),
        }),
      Error,
      "API handler must return a Response",
    );

    assertThrows(
      () =>
        deserializeRouteResponse({
          status: 200,
          statusText: "OK",
          headers: Array.from(
            { length: MAX_WORKER_RESPONSE_HEADERS + 1 },
            (_, index) => [`x-${index}`, "value"],
          ),
          body: null,
        }),
      Error,
      "API handler must return a Response",
    );
  });
});
