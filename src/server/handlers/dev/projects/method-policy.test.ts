import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createDevUiAssetProvider } from "#veryfront/extensions/dev-ui";
import { recordRequestPeerFromTransport } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import type { HandlerContext } from "#veryfront/types";
import { ProjectsHandler } from "./index.ts";

const PROVIDER = createDevUiAssetProvider("globalThis.__projectsMethodPolicy = true;");

function projectsRequest(pathname: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (!headers.has("host")) headers.set("host", "localhost");
  const request = new Request(`http://localhost${pathname}`, { ...init, headers });
  recordRequestPeerFromTransport(request, {
    runtime: "deno",
    transport: "tcp",
    hostname: "127.0.0.1",
  });
  return request;
}

function projectsContext(): HandlerContext {
  return {
    projectDir: "/project",
    projectSlug: undefined,
    parsedDomain: { isVeryfrontDomain: true },
    securityConfig: null,
  } as HandlerContext;
}

describe("ProjectsHandler method policy", () => {
  it("rejects non-read methods before consuming route work", async () => {
    let cancelled = false;
    let releaseCancellation!: () => void;
    const cancellationGate = new Promise<void>((resolve) => {
      releaseCancellation = resolve;
    });
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
          return cancellationGate;
        },
      }),
      duplex: "half",
    };
    const request = projectsRequest("/_projects", init);
    let responseSettled = false;
    const responsePromise = new ProjectsHandler(PROVIDER).handle(request, projectsContext());
    void responsePromise.then(() => {
      responseSettled = true;
    });
    await Promise.resolve();
    assertEquals(responseSettled, true);
    releaseCancellation();
    const response = (await responsePromise).response!;

    assertEquals(response.status, 405);
    assertEquals(response.headers.get("allow"), "GET, HEAD");
    assertEquals(response.headers.get("cache-control"), "no-store");
    assertEquals(cancelled, true);
  });

  it("gives HEAD the GET status and headers without a body", async () => {
    const handler = new ProjectsHandler(PROVIDER);
    for (const path of ["/_projects", "/_projects/ui/index.js", "/_projects/api/config"]) {
      const getResponse = (await handler.handle(
        projectsRequest(path),
        projectsContext(),
      )).response!;
      const headResponse = (await handler.handle(
        projectsRequest(path, { method: "HEAD" }),
        projectsContext(),
      )).response!;

      assertEquals(headResponse.status, getResponse.status, path);
      assertEquals(
        headResponse.headers.get("content-type"),
        getResponse.headers.get("content-type"),
        path,
      );
      assertEquals(await headResponse.text(), "", path);
    }

    const unavailable = (await new ProjectsHandler().handle(
      projectsRequest("/_projects", { method: "HEAD" }),
      projectsContext(),
    )).response!;
    assertEquals(unavailable.status, 503);
    assertEquals(await unavailable.text(), "");
  });
});
