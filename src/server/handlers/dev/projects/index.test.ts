import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createDevUiAssetProvider } from "#veryfront/extensions/dev-ui";
import { recordRequestPeerFromTransport } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import type { HandlerContext } from "../../types.ts";
import { ProjectsHandler } from "./index.ts";

const BUNDLE = "globalThis.__veryfrontProjectsTest = true;";
const PROVIDER = createDevUiAssetProvider(BUNDLE);

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

describe("ProjectsHandler", () => {
  it("does not expose the project chooser to a non-loopback peer", async () => {
    const request = new Request("http://localhost/_projects", {
      headers: { host: "localhost" },
    });
    recordRequestPeerFromTransport(request, {
      runtime: "deno",
      transport: "tcp",
      hostname: "192.168.1.25",
    });

    const result = await new ProjectsHandler(PROVIDER).handle(request, projectsContext());

    assertEquals(result.response, undefined);
    assertEquals(result.continue, true);
  });

  it("serves its shell and exact captured bundle", async () => {
    const handler = new ProjectsHandler(PROVIDER);
    const shell = (await handler.handle(
      projectsRequest("/_projects"),
      projectsContext(),
    )).response!;
    assertEquals(shell.status, 200);
    assertStringIncludes(await shell.text(), 'data-veryfront-dev-ui="projects"');

    const asset = (await handler.handle(
      projectsRequest("/_projects/ui/index.js"),
      projectsContext(),
    )).response!;
    assertEquals(asset.status, 200);
    assertEquals(await asset.text(), BUNDLE);

    const nested = (await handler.handle(
      projectsRequest("/_projects/ui/components/App.js"),
      projectsContext(),
    )).response!;
    assertEquals(nested.status, 404);
  });

  it("rejects asset mutations and fails closed without assets", async () => {
    const handler = new ProjectsHandler(PROVIDER);
    const mutation = (await handler.handle(
      projectsRequest("/_projects/ui/index.js", { method: "POST" }),
      projectsContext(),
    )).response!;
    assertEquals(mutation.status, 405);
    assertEquals(mutation.headers.get("allow"), "GET, HEAD");

    const unavailable = new ProjectsHandler();
    const unavailableShell = (await unavailable.handle(
      projectsRequest("/_projects"),
      projectsContext(),
    )).response!;
    assertEquals(unavailableShell.status, 503);
    assertEquals(unavailableShell.headers.get("cache-control"), "no-store");
    assertEquals(unavailableShell.headers.get("content-type"), "text/plain; charset=utf-8");
    assertStringIncludes(await unavailableShell.text(), "@veryfront/ext-dev-ui-react");

    const unavailableBundle = (await unavailable.handle(
      projectsRequest("/_projects/ui/index.js"),
      projectsContext(),
    )).response!;
    assertEquals(unavailableBundle.status, 503);
    assertEquals(unavailableBundle.headers.get("content-type"), "text/plain; charset=utf-8");
    assertStringIncludes(await unavailableBundle.text(), "@veryfront/ext-dev-ui-react");
  });
});
