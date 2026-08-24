import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { _resetShimForTests, propagation } from "#veryfront/observability/tracing/api-shim.ts";
import type { ProxyContext } from "./handler.ts";
import { createSplitForwardRequestInit } from "./split-forward-request.ts";

function previewContext(): ProxyContext {
  return {
    token: "trusted-token",
    projectSlug: "project",
    projectId: "project-id",
    environmentId: "environment-id",
    environmentName: "preview",
    environment: "preview",
    contentSourceId: "preview-main",
    host: "project.preview.veryfront.test",
    parsedDomain: {
      slug: "project",
      isVeryfrontDomain: true,
      environment: "preview",
      branch: null,
      isDraft: true,
      allowIframeEmbed: true,
    },
    isLocalProject: false,
  };
}

describe("split proxy forward request", () => {
  it("uses the shared end-to-end header policy", () => {
    const body = new ReadableStream<Uint8Array>();
    const request = new Request(
      "https://project.preview.veryfront.test/upload",
      {
        method: "POST",
        headers: {
          Connection: "keep-alive, x-remove-me",
          Host: "attacker.test",
          "Keep-Alive": "timeout=5",
          "Proxy-Authorization": "Basic secret",
          "Transfer-Encoding": "chunked",
          "X-Content-Source-Id": "caller-controlled",
          "X-Remove-Me": "connection-owned",
          "X-Token": "caller-controlled",
          "X-Preserve-Me": "end-to-end",
        },
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" },
    );
    const context: ProxyContext = {
      token: "trusted-token",
      projectSlug: "project",
      projectId: "project-id",
      environmentId: "environment-id",
      environmentName: "preview",
      environment: "preview",
      contentSourceId: "preview-main",
      host: "project.preview.veryfront.test",
      parsedDomain: {
        slug: "project",
        isVeryfrontDomain: true,
        environment: "preview",
        branch: null,
        isDraft: true,
        allowIframeEmbed: true,
      },
      isLocalProject: false,
    };
    const signal = new AbortController().signal;

    const init = createSplitForwardRequestInit(request, context, request.body, signal);
    const headers = new Headers(init.headers);

    assertEquals(init.method, "POST");
    assertEquals(init.redirect, "manual");
    assertStrictEquals(init.signal, signal);
    assertStrictEquals(init.body, request.body);
    assertEquals(init.duplex, "half");
    assertEquals(headers.get("connection"), null);
    assertEquals(headers.get("host"), null);
    assertEquals(headers.get("keep-alive"), null);
    assertEquals(headers.get("proxy-authorization"), null);
    assertEquals(headers.get("transfer-encoding"), null);
    assertEquals(headers.get("x-remove-me"), null);
    assertEquals(headers.get("x-preserve-me"), "end-to-end");
    assertEquals(headers.get("x-token"), "trusted-token");
    assertEquals(headers.get("x-content-source-id"), "preview-main");
    assertEquals(headers.get("x-project-id"), "project-id");
    assertEquals(headers.get("x-environment-id"), "environment-id");
    assertEquals(headers.get("x-environment-name"), "preview");
  });

  it("injects its own trace context after untrusted headers are removed", () => {
    const request = new Request("https://project.preview.veryfront.test/page", {
      headers: {
        traceparent: "00-deadbeefdeadbeefdeadbeefdeadbeef-1111111111111111-01",
      },
    });

    try {
      propagation.setGlobalPropagator({
        inject: (_ctx, carrier, setter) => {
          setter?.set(
            carrier,
            "traceparent",
            "00-11111111111111111111111111111111-2222222222222222-01",
          );
        },
        extract: (ctx) => ctx,
        fields: () => ["traceparent", "tracestate"],
      });

      const init = createSplitForwardRequestInit(
        request,
        previewContext(),
        null,
        new AbortController().signal,
      );
      const headers = new Headers(init.headers);

      assertEquals(
        headers.get("traceparent"),
        "00-11111111111111111111111111111111-2222222222222222-01",
        "the proxy must inject its own trace context into the renderer hop",
      );
      assertEquals(
        headers.get("traceparent")?.includes("deadbeef"),
        false,
        "a caller-supplied traceparent must be replaced, not forwarded",
      );
    } finally {
      _resetShimForTests();
    }
  });
});
