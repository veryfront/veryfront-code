import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  createProjectMetadataClient,
  PROJECT_METADATA_RESPONSE_LIMIT_BYTES,
  ProxyLookupAuthError,
  ProxyLookupFailure,
} from "./project-metadata-client.ts";

function makeFetch(
  handler: (url: URL, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(new URL(String(input)), init))) as typeof fetch;
}

function routingMetadata() {
  return {
    id: "project-1",
    slug: "storefront",
    environments: [{
      id: "environment-1",
      name: "production",
      domains: ["STORE.example.com."],
      active_release_id: "release-1",
    }],
  };
}

describe("proxy project metadata client", () => {
  it("normalizes lookup keys and snapshots validated routing metadata", async () => {
    let requestedUrl: URL | undefined;
    const client = createProjectMetadataClient({
      apiBaseUrl: "https://api.example.com/v1",
      fetchImpl: makeFetch((url) => {
        requestedUrl = url;
        return Response.json(routingMetadata());
      }),
    });

    const result = await client.lookupRouting("STOREFRONT", "service-token");

    assertEquals(requestedUrl?.pathname, "/v1/projects/-/proxy-routing/storefront");
    assertEquals(result?.slug, "storefront");
    assertEquals(result?.environments[0]?.domains, ["store.example.com"]);
    assertEquals(Object.isFrozen(result), true);
    assertEquals(Object.isFrozen(result?.environments), true);
  });

  it("distinguishes absence, authorization rejection, and upstream failure", async () => {
    const notFound = createProjectMetadataClient({
      apiBaseUrl: "https://api.example.com",
      fetchImpl: makeFetch(() => new Response(null, { status: 404 })),
    });
    assertEquals(await notFound.lookupDomain("missing.example.com", "token"), null);

    const unauthorized = createProjectMetadataClient({
      apiBaseUrl: "https://api.example.com",
      fetchImpl: makeFetch(() => new Response(null, { status: 401 })),
    });
    const authError = await assertRejects(
      () => unauthorized.lookupRouting("storefront", "token"),
      ProxyLookupAuthError,
    );
    assertEquals((authError as ProxyLookupAuthError).status, 401);

    const unavailable = createProjectMetadataClient({
      apiBaseUrl: "https://api.example.com",
      fetchImpl: makeFetch(() => new Response(null, { status: 500 })),
    });
    const failure = await assertRejects(
      () => unavailable.lookupAccess("storefront", "token", false),
      ProxyLookupFailure,
    );
    assertEquals((failure as ProxyLookupFailure).publicStatus, 502);
    assertEquals((failure as ProxyLookupFailure).upstreamStatus, 500);
  });

  it("records only non-sensitive upstream diagnostics", async () => {
    const rejected = createProjectMetadataClient({
      apiBaseUrl: "https://api.example.com",
      fetchImpl: makeFetch(() =>
        new Response(`{"error":"database unavailable"}${"x".repeat(512)}`, { status: 500 })
      ),
    });
    const failure = await assertRejects(
      () => rejected.lookupAccess("storefront", "token", false),
      ProxyLookupFailure,
      "Proxy access metadata request was rejected",
    ) as ProxyLookupFailure;
    assertEquals(failure.publicStatus, 502);
    assertEquals(failure.upstreamStatus, 500);
    assertEquals("upstreamBodySnippet" in failure, false);
    assertEquals(failure.message.includes("500"), false);

    const wrongContentType = createProjectMetadataClient({
      apiBaseUrl: "https://api.example.com",
      fetchImpl: makeFetch(() =>
        new Response("<html>maintenance</html>", {
          headers: { "Content-Type": "text/html" },
        })
      ),
    });
    const contentTypeFailure = await assertRejects(
      () => wrongContentType.lookupRouting("storefront", "token"),
      ProxyLookupFailure,
      "content type",
    ) as ProxyLookupFailure;
    assertEquals(contentTypeFailure.upstreamStatus, 200);
    assertEquals("upstreamBodySnippet" in contentTypeFailure, false);

    const invalidJson = createProjectMetadataClient({
      apiBaseUrl: "https://api.example.com",
      fetchImpl: makeFetch(() =>
        new Response("not json", {
          headers: { "Content-Type": "application/json" },
        })
      ),
    });
    const invalidFailure = await assertRejects(
      () => invalidJson.lookupRouting("storefront", "token"),
      ProxyLookupFailure,
      "invalid response",
    ) as ProxyLookupFailure;
    assertEquals(invalidFailure.upstreamStatus, 200);
    assertEquals("upstreamBodySnippet" in invalidFailure, false);
  });

  it("requires bounded JSON with the expected response schema", async () => {
    const wrongContentType = createProjectMetadataClient({
      apiBaseUrl: "https://api.example.com",
      fetchImpl: makeFetch(() =>
        new Response(JSON.stringify(routingMetadata()), {
          headers: { "Content-Type": "text/plain" },
        })
      ),
    });
    await assertRejects(
      () => wrongContentType.lookupRouting("storefront", "token"),
      ProxyLookupFailure,
      "content type",
    );

    const oversized = createProjectMetadataClient({
      apiBaseUrl: "https://api.example.com",
      fetchImpl: makeFetch(() =>
        new Response("{}", {
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(PROJECT_METADATA_RESPONSE_LIMIT_BYTES + 1),
          },
        })
      ),
    });
    await assertRejects(
      () => oversized.lookupRouting("storefront", "token"),
      ProxyLookupFailure,
      "invalid response",
    );

    const malformed = createProjectMetadataClient({
      apiBaseUrl: "https://api.example.com",
      fetchImpl: makeFetch(() =>
        Response.json({
          ...routingMetadata(),
          environments: [
            ...routingMetadata().environments,
            ...routingMetadata().environments,
          ],
        })
      ),
    });
    await assertRejects(
      () => malformed.lookupRouting("storefront", "token"),
      ProxyLookupFailure,
      "invalid response",
    );
  });

  it("requires an explicit protection decision from access metadata", async () => {
    const client = createProjectMetadataClient({
      apiBaseUrl: "https://api.example.com",
      fetchImpl: makeFetch(() =>
        Response.json({
          id: "project-1",
          slug: "storefront",
          environments: [{
            id: "environment-1",
            name: "production",
          }],
        })
      ),
    });

    await assertRejects(
      () => client.lookupAccess("storefront", "token", false),
      ProxyLookupFailure,
      "invalid response",
    );
  });

  it("enforces the deadline even when an injected fetch ignores abort", async () => {
    let calls = 0;
    const client = createProjectMetadataClient({
      apiBaseUrl: "https://api.example.com",
      timeoutMs: 1,
      maxInflight: 1,
      fetchImpl: makeFetch(() => {
        calls++;
        return new Promise<Response>(() => {});
      }),
    });

    const failure = await assertRejects(
      () => client.lookupRouting("storefront", "token"),
      ProxyLookupFailure,
      "timed out",
    );
    assertEquals((failure as ProxyLookupFailure).publicStatus, 504);

    const capacity = await assertRejects(
      () => client.lookupRouting("another-project", "token"),
      ProxyLookupFailure,
      "capacity",
    );
    assertEquals((capacity as ProxyLookupFailure).publicStatus, 503);
    assertEquals(calls, 1);
  });

  it("propagates caller cancellation without reclassifying it as an upstream failure", async () => {
    const client = createProjectMetadataClient({
      apiBaseUrl: "https://api.example.com",
      fetchImpl: makeFetch(() => new Promise<Response>(() => {})),
    });
    const controller = new AbortController();
    const reason = new DOMException("request disconnected", "AbortError");
    const pending = client.lookupRouting("storefront", "token", {
      signal: controller.signal,
    });

    controller.abort(reason);

    const error = await assertRejects(
      () => pending,
      DOMException,
      "request disconnected",
    );
    assertEquals(error, reason);
  });

  it("bounds concurrent metadata work", async () => {
    let release!: (response: Response) => void;
    let markStarted!: () => void;
    const response = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const client = createProjectMetadataClient({
      apiBaseUrl: "https://api.example.com",
      maxInflight: 1,
      fetchImpl: makeFetch(() => {
        markStarted();
        return response;
      }),
    });

    const first = client.lookupRouting("storefront", "token");
    await started;
    const failure = await assertRejects(
      () => client.lookupRouting("another-project", "token"),
      ProxyLookupFailure,
      "capacity",
    );
    assertEquals((failure as ProxyLookupFailure).publicStatus, 503);

    release(Response.json(routingMetadata()));
    assertEquals((await first)?.id, "project-1");
  });

  it("rejects unsafe construction and lookup inputs", async () => {
    await assertRejects(
      () =>
        Promise.resolve().then(() =>
          createProjectMetadataClient({
            apiBaseUrl: "file:///etc/passwd",
          })
        ),
      TypeError,
      "HTTP(S)",
    );

    const client = createProjectMetadataClient({
      apiBaseUrl: "https://api.example.com",
      fetchImpl: makeFetch(() => Response.json(routingMetadata())),
    });
    await assertRejects(
      () => client.lookupRouting("../other-project", "token"),
      TypeError,
      "lookup key",
    );
  });
});
