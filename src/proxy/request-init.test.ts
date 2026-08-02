import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { withProxyStreamingBodyDuplex } from "./request-init.ts";

Deno.test("proxy request init portability", async (t) => {
  await t.step("marks a forwarded ReadableStream without consuming it", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("streamed body"));
        controller.close();
      },
    });
    const controller = new AbortController();

    const init = withProxyStreamingBodyDuplex({
      method: "POST",
      body,
      signal: controller.signal,
    });

    assertEquals(init.duplex, "half");
    assertStrictEquals(init.body, body);
    assertStrictEquals(init.signal, controller.signal);
    assertEquals(body.locked, false);
    assertEquals(await new Response(body).text(), "streamed body");
  });

  await t.step("does not add duplex to non-stream bodies", () => {
    const source = {
      method: "POST",
      body: "buffered body",
    } satisfies RequestInit;
    const init = withProxyStreamingBodyDuplex(source);

    assertStrictEquals(init, source);
    assertEquals(init.duplex, undefined);
  });
});
