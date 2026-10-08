import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withEnv } from "#veryfront/testing";
import { createVeryfrontCloudFetch } from "#veryfront/provider/veryfront-cloud/shared.ts";
import {
  runWithVeryfrontCloudContext,
  type VeryfrontCloudContext,
} from "#veryfront/provider/veryfront-cloud/context.ts";

describe("cloud billing transport dispatch", () => {
  it("leaves billing unused when the real pinned transport refuses modified request members", async () => {
    const { fetchWithPinnedAddresses } = await import(
      "#veryfront/platform/compat/http/pinned-fetch.ts"
    );
    const { __runWithOutboundFetchTransportForTests } = await import(
      "#veryfront/security/http/outbound-fetch.ts"
    );
    const { ClientRequest } = await import("node:http");
    const { channel } = await import("node:diagnostics_channel");
    const warmup = new AbortController();
    warmup.abort(new Error("warmup abort"));
    await assertRejects(() =>
      fetchWithPinnedAddresses(new URL("http://93.184.216.34/"), ["93.184.216.34"], {
        signal: warmup.signal,
      })
    );
    const original = Object.getOwnPropertyDescriptor(ClientRequest.prototype, "end");
    const originalEnd = ClientRequest.prototype.end;
    const context: VeryfrontCloudContext = { billingGroupId: "evalrun_pinned_refused" };
    const requests = channel("http.client.request.created");
    let created = 0;
    const observe = () => {
      created++;
    };
    const wrappedFetch = createVeryfrontCloudFetch(
      "vf_test_provider",
      "http://93.184.216.34/ai/v1",
    );
    requests.subscribe(observe);
    try {
      Object.defineProperty(ClientRequest.prototype, "end", {
        configurable: true,
        writable: true,
        value: function (...args: Parameters<typeof originalEnd>) {
          return Reflect.apply(originalEnd, this, args);
        },
      });
      await __runWithOutboundFetchTransportForTests(
        {
          fetch: () => {
            throw new Error("Unexpected unpinned request");
          },
          pinnedFetch: fetchWithPinnedAddresses,
          resolveHost: () => Promise.resolve(["93.184.216.34"]),
        },
        () =>
          assertRejects(
            () =>
              runWithVeryfrontCloudContext(
                context,
                () => wrappedFetch("http://93.184.216.34/ai/v1/chat/completions"),
              ),
            TypeError,
            "Refused a credential-bearing request",
          ),
      );
    } finally {
      if (original) Object.defineProperty(ClientRequest.prototype, "end", original);
      else Reflect.deleteProperty(ClientRequest.prototype, "end");
      requests.unsubscribe(observe);
    }
    assertEquals(created, 0);
    assertEquals(context.billingGroupUsed, undefined);
  });

  it("keeps billing used after socket dispatch when the caller aborts before observing the gateway response", async () => {
    const { fetchWithPinnedAddresses } = await import(
      "#veryfront/platform/compat/http/pinned-fetch.ts"
    );
    const { __runWithOutboundFetchTransportForTests } = await import(
      "#veryfront/security/http/outbound-fetch.ts"
    );
    const { createServer } = await import("node:http");
    const context: VeryfrontCloudContext = { billingGroupId: "evalrun_dispatched" };
    let received = 0;
    const caller = new AbortController();
    const server = createServer((request, response) => {
      received++;
      assertEquals(request.headers["x-veryfront-billing-group-id"], context.billingGroupId);
      caller.abort("Gateway response discarded");
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing server address");
      const baseUrl = `http://127.0.0.1:${address.port}/ai/v1`;
      const wrappedFetch = createVeryfrontCloudFetch("vf_test_provider", baseUrl);
      await withEnv({
        VERYFRONT_HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS: new URL(baseUrl).origin,
      }, () =>
        __runWithOutboundFetchTransportForTests(
          {
            fetch: () => {
              throw new Error("Unexpected unpinned request");
            },
            pinnedFetch: fetchWithPinnedAddresses,
            resolveHost: () => Promise.resolve(["127.0.0.1"]),
          },
          () =>
            assertRejects(() =>
              runWithVeryfrontCloudContext(
                context,
                () => wrappedFetch(`${baseUrl}/chat/completions`, { signal: caller.signal }),
              )
            ),
          { allowedResolvedAddresses: ["127.0.0.1"] },
        ));
      assertEquals(received, 1);
      assertEquals(context.billingGroupUsed, true);
      assertEquals(context.billingGroupRequestAdmitted, undefined);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve())
      );
    }
  });
});
