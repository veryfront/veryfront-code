import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getRuntimeForPlaywrightProject } from "./runtime.ts";

describe("Playwright runtime requests", () => {
  it("uses loopback transport while preserving the production virtual host", () => {
    const runtime = getRuntimeForPlaywrightProject("production-host");

    assertEquals(runtime.getApiRequest("alpha", "/api/status"), {
      url: "http://127.0.0.1:8080/api/status",
      headers: { host: "alpha.localhost:8080" },
    });
  });

  it("uses loopback transport while preserving the preview virtual host", () => {
    const runtime = getRuntimeForPlaywrightProject("preview-host");

    assertEquals(runtime.getApiRequest("alpha", "/api/status"), {
      url: "http://127.0.0.1:8080/api/status",
      headers: { host: "alpha.preview.localhost:8080" },
    });
  });
});
