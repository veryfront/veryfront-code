import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  deserializeRouteResponse,
  MAX_WORKER_RESPONSE_BODY_BYTES,
  MAX_WORKER_RESPONSE_HEADERS,
  normalizeRouteHeadResponse,
  serializeRouteResponse,
} from "./response-normalization.ts";
import { HTTP_OK } from "#veryfront/utils";

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

    let pulls = 0;
    const streamed = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls++;
          controller.enqueue(new Uint8Array([1]));
          controller.close();
        },
      }, { highWaterMark: 0 }),
    );
    const head = await serializeRouteResponse(streamed, "HEAD");
    assertEquals(head.body, null, "HEAD must not transfer a body");
    assertEquals(pulls, 0, "HEAD must not pull the handler's stream");
    assertEquals(streamed.bodyUsed, false, "HEAD must not consume the handler body");
  });

  it("keeps a HEAD response at 200 and drops its body", async () => {
    const head = normalizeRouteHeadResponse(new Response("hello"));

    assertEquals(head.status, HTTP_OK, "a HEAD response with no explicit status stays 200");
    assertEquals(await head.text(), "", "HEAD must not carry a body");
  });

  it("preserves an explicit HEAD status and its declared content length", async () => {
    const head = normalizeRouteHeadResponse(
      new Response("hello", { status: 201, headers: { "content-length": "5" } }),
    );

    assertEquals(head.status, 201, "an explicit HEAD status must survive normalization");
    assertEquals(await head.text(), "", "HEAD must not carry a body");
    assertEquals(
      head.headers.get("content-length"),
      "5",
      "HEAD preserves the declared content length",
    );
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

  it("rejects header catalogs over the transferred code-unit budget", async () => {
    // Independent literal for the 64KB header budget the module enforces.
    const maxHeaderCodeUnits = 64 * 1024;
    const name = "x-big";
    const atBudget = "a".repeat(maxHeaderCodeUnits - name.length);

    const accepted = deserializeRouteResponse({
      status: 200,
      statusText: "OK",
      headers: [[name, atBudget]],
      body: null,
    });
    assertEquals(
      accepted.headers.get(name)?.length,
      atBudget.length,
      "a header catalog exactly at the code-unit budget must still deserialize",
    );

    assertThrows(
      () =>
        deserializeRouteResponse({
          status: 200,
          statusText: "OK",
          headers: [[name, `${atBudget}a`]],
          body: null,
        }),
      Error,
      "API handler must return a Response",
      "a header catalog over the code-unit budget must be rejected",
    );

    await assertRejects(
      () => serializeRouteResponse(new Response(null, { headers: { [name]: `${atBudget}a` } })),
      Error,
      "API handler must return a Response",
      "an oversized header value must not cross the worker boundary",
    );
  });
});
