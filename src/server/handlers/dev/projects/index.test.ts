import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createDevUiAssetProvider } from "#veryfront/extensions/dev-ui";
import type { HandlerContext } from "../../types.ts";
import { ProjectsHandler } from "./index.ts";

const BUNDLE = "globalThis.__veryfrontProjectsTest = true;";
const PROVIDER = createDevUiAssetProvider(BUNDLE);

function projectsContext(): HandlerContext {
  return {
    projectDir: "/project",
    projectSlug: undefined,
    parsedDomain: { isVeryfrontDomain: true },
    securityConfig: null,
  } as HandlerContext;
}

describe("ProjectsHandler", () => {
  it("serves its shell and exact captured bundle", async () => {
    const handler = new ProjectsHandler(PROVIDER);
    const shell = (await handler.handle(
      new Request("https://veryfront.test/_projects"),
      projectsContext(),
    )).response!;
    assertEquals(shell.status, 200);
    assertStringIncludes(await shell.text(), 'data-veryfront-dev-ui="projects"');

    const asset = (await handler.handle(
      new Request("https://veryfront.test/_projects/ui/index.js"),
      projectsContext(),
    )).response!;
    assertEquals(asset.status, 200);
    assertEquals(await asset.text(), BUNDLE);

    const nested = (await handler.handle(
      new Request("https://veryfront.test/_projects/ui/components/App.js"),
      projectsContext(),
    )).response!;
    assertEquals(nested.status, 404);
  });

  it("rejects asset mutations and fails closed without assets", async () => {
    const handler = new ProjectsHandler(PROVIDER);
    const mutation = (await handler.handle(
      new Request("https://veryfront.test/_projects/ui/index.js", { method: "POST" }),
      projectsContext(),
    )).response!;
    assertEquals(mutation.status, 405);
    assertEquals(mutation.headers.get("allow"), "GET, HEAD");

    const unavailable = new ProjectsHandler();
    const unavailableShell = (await unavailable.handle(
      new Request("https://veryfront.test/_projects"),
      projectsContext(),
    )).response!;
    assertEquals(unavailableShell.status, 503);
    assertEquals(unavailableShell.headers.get("cache-control"), "no-store");
    assertEquals(unavailableShell.headers.get("content-type"), "text/plain; charset=utf-8");
    assertStringIncludes(await unavailableShell.text(), "@veryfront/ext-dev-ui-react");

    const unavailableBundle = (await unavailable.handle(
      new Request("https://veryfront.test/_projects/ui/index.js"),
      projectsContext(),
    )).response!;
    assertEquals(unavailableBundle.status, 503);
    assertEquals(unavailableBundle.headers.get("content-type"), "text/plain; charset=utf-8");
    assertStringIncludes(await unavailableBundle.text(), "@veryfront/ext-dev-ui-react");
  });
});
