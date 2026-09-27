import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { formatProxyJsonLine, runWithProxyRequestContext } from "./logger.ts";

describe("proxy JSON log line", () => {
  it("stamps the resolved project and request with the snake_case fields the runtime uses", () => {
    const entry = JSON.parse(runWithProxyRequestContext(
      {
        requestId: "req-1",
        projectSlug: "northwind-inbox",
        projectId: "project-1",
        releaseId: "release-1",
        branchId: "branch-1",
        branchName: "main",
        domain: "northwind-inbox.production.veryfront.com",
        environment: "production",
      },
      () => formatProxyJsonLine("info", "200 POST /api/control-plane/runs/run-1/stream"),
    ));

    assertEquals(entry.project_id, "project-1");
    assertEquals(entry.project_slug, "northwind-inbox");
    assertEquals(entry.request_id, "req-1");
    assertEquals(entry.release_id, "release-1");
    assertEquals(entry.branch_id, "branch-1");
    assertEquals(entry.branch_name, "main");
    assertEquals(entry.projectId, "project-1");
    assertEquals(entry.requestId, "req-1");
  });

  it("leaves project fields out of lines logged outside a project request", () => {
    const entry = JSON.parse(formatProxyJsonLine("info", "Proxy listening"));

    assertEquals("project_id" in entry, false);
    assertEquals("projectId" in entry, false);
    assertEquals("request_id" in entry, false);
  });

  it("stamps the run a signed control-plane request addresses as run_id", () => {
    const entry = JSON.parse(runWithProxyRequestContext(
      { requestId: "req-1", projectId: "project-1", runId: "run_1" },
      () => formatProxyJsonLine("info", "200 POST /api/control-plane/runs/run_1/stream"),
    ));

    assertEquals(entry.run_id, "run_1");
    assertEquals("runId" in entry, false);
  });

  it("keeps the caller context and serialized error on the line", () => {
    const entry = JSON.parse(
      formatProxyJsonLine("error", "Upstream failed", { ms: 12 }, new Error("connection reset")),
    );

    assertEquals(entry.context, { ms: 12 });
    assertEquals(entry.error.message, "connection reset");
    assertEquals("run_id" in entry, false);
  });
});
