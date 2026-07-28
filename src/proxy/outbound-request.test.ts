import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import {
  createApiTargetUrl,
  createRendererTargetUrl,
  fetchWithProxyDeadline,
  ProxyOutboundRequestTimeoutError,
  waitForProxyDelay,
} from "./outbound-request.ts";

Deno.test("proxy outbound requests", async (t) => {
  await t.step("resolves renderer paths without authority reinterpretation", () => {
    const requestUrl = new URL("https://public.example//cms/page?state=private");
    const target = createRendererTargetUrl("http://renderer.internal", requestUrl);

    assertEquals(target.origin, "http://renderer.internal");
    assertEquals(target.pathname, "/cms/page");
    assertEquals(target.search, "?state=private");
  });

  await t.step("retains API base paths and rejects paths outside the BFF namespace", () => {
    const target = createApiTargetUrl(
      "https://api.example/control/v2",
      new URL("https://public.example/_vf/api/projects?id=project"),
    );
    assertEquals(
      target.toString(),
      "https://api.example/control/v2/projects?id=project",
    );

    assertThrows(
      () =>
        createApiTargetUrl(
          "https://api.example",
          new URL("https://public.example/projects"),
        ),
      TypeError,
      "outside the proxy API namespace",
    );
    assertThrows(
      () =>
        createRendererTargetUrl(
          "https://user:secret@renderer.example",
          new URL("https://public.example/"),
        ),
      TypeError,
      "credential-free",
    );
  });

  await t.step("enforces the deadline when fetch ignores cancellation", async () => {
    await assertRejects(
      () =>
        fetchWithProxyDeadline("https://api.example", {
          timeoutMs: 1,
          fetchImpl: () => new Promise<Response>(() => {}),
        }),
      ProxyOutboundRequestTimeoutError,
      "timed out after 1ms",
    );
  });

  await t.step("propagates caller cancellation and cancels late response bodies", async () => {
    const caller = new AbortController();
    const reason = new Error("client disconnected");
    let lateBodyCanceled = false;
    let receivedSignal: AbortSignal | undefined;
    const pending = fetchWithProxyDeadline("https://api.example", {
      timeoutMs: 100,
      signal: caller.signal,
      fetchImpl: (_input, init) => {
        receivedSignal = (init as { signal?: AbortSignal } | undefined)?.signal;
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                new Response(
                  new ReadableStream({
                    cancel() {
                      lateBodyCanceled = true;
                    },
                  }),
                ),
              ),
            5,
          )
        );
      },
    });

    caller.abort(reason);
    const caught = await pending.catch((error) => error);
    assertStrictEquals(caught, reason);
    assertEquals(receivedSignal?.aborted, true);
    await new Promise((resolve) => setTimeout(resolve, 15));
    assertEquals(lateBodyCanceled, true);
  });

  await t.step("marks forwarded ReadableStream bodies as half duplex", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("streamed body"));
        controller.close();
      },
    });
    let receivedInit: (RequestInit & { duplex?: "half" }) | undefined;

    const response = await fetchWithProxyDeadline("https://api.example/upload", {
      timeoutMs: 100,
      init: {
        method: "POST",
        body,
      },
      fetchImpl: (_input, init) => {
        receivedInit = init as RequestInit & { duplex?: "half" };
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    });

    assertEquals(response.status, 204);
    assertStrictEquals(receivedInit?.body, body);
    assertEquals(receivedInit?.duplex, "half");
  });

  await t.step("clears retry delays when the caller aborts", async () => {
    const caller = new AbortController();
    const reason = new Error("request closed");
    const pending = waitForProxyDelay(100, caller.signal);
    caller.abort(reason);
    assertStrictEquals(await pending.catch((error) => error), reason);
    await waitForProxyDelay(0);
  });
});
