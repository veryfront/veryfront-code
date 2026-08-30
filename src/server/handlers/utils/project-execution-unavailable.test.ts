import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { BaseHandler } from "#veryfront/security";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../types.ts";
import { buildProjectExecutionUnavailableResponse } from "./project-execution-unavailable.ts";

/** Exposes the protected helpers bag the way a real handler passes it in. */
class ProbeHandler extends BaseHandler {
  metadata: HandlerMetadata = { name: "ProbeHandler", priority: 1 as never, patterns: [] };
  handle(): Promise<HandlerResult> {
    return Promise.resolve(this.continue());
  }
  get exposedHelpers() {
    return this.helpers;
  }
}

function createCtx(): HandlerContext {
  return {
    projectDir: "/project",
    projectSlug: "demo-project",
    projectId: "proj-1",
    isLocalProject: false,
    securityConfig: null,
    adapter: { env: { get: () => undefined }, fs: {} },
  } as unknown as HandlerContext;
}

describe("server/handlers/utils/project-execution-unavailable", () => {
  it("builds the shared-runtime denial every gated surface answers with", async () => {
    const response = buildProjectExecutionUnavailableResponse(
      new ProbeHandler().exposedHelpers,
      new Request("https://example.com/api/agents", { method: "GET" }),
      createCtx(),
      { detail: "needs a dedicated runtime", instance: "/api/agents" },
    );

    assertEquals(response.status, 503);
    assertEquals(response.headers.get("content-type"), "application/problem+json");
    assertEquals(response.headers.get("cache-control"), "no-store");

    const body = await response.json() as Record<string, unknown>;
    assertEquals(
      body.type,
      "https://veryfront.com/docs/code/guides/errors#project-execution-unavailable",
    );
    assertEquals(body.detail, "needs a dedicated runtime");
    assertEquals(body.instance, "/api/agents");
  });
});
