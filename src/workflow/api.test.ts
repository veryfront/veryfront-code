import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { api } from "./api.ts";

const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");

afterEach(() => {
  if (originalApiUrl === undefined) Deno.env.delete("VERYFRONT_API_URL");
  else Deno.env.set("VERYFRONT_API_URL", originalApiUrl);
});

describe("workflow api", () => {
  it("configures release-backed file context from the current tenant", async () => {
    Deno.env.set("VERYFRONT_API_URL", "https://api.example.test");
    await runWithRequestContext(
      {
        projectSlug: "acme",
        projectId: "project-1",
        token: "tenant-token",
        productionMode: true,
        releaseId: "release-1",
        environmentName: "production",
      },
      async () => {
        assertEquals(api._getClient().getContext(), {
          type: "release",
          version: "release-1",
        });
      },
    );
  });

  it("configures branch file context for preview tenants", async () => {
    Deno.env.set("VERYFRONT_API_URL", "https://api.example.test");
    await runWithRequestContext(
      {
        projectSlug: "acme",
        projectId: "project-1",
        token: "tenant-token",
        productionMode: false,
        branch: "feature/demo",
        environmentName: "preview",
      },
      async () => {
        assertEquals(api._getClient().getContext(), {
          type: "branch",
          name: "feature/demo",
        });
      },
    );
  });

  it("requires an explicitly composed API endpoint", async () => {
    Deno.env.delete("VERYFRONT_API_URL");
    await runWithRequestContext(
      {
        projectSlug: "acme",
        projectId: "project-1",
        token: "tenant-token",
        productionMode: false,
        branch: "feature/demo",
      },
      async () => {
        assertThrows(
          () => api._getClient(),
          Error,
          "requires an explicit VERYFRONT_API_URL",
        );
        await Promise.resolve();
      },
    );
  });

  it("requires explicit branch authority for preview access", async () => {
    Deno.env.set("VERYFRONT_API_URL", "https://api.example.test");
    await runWithRequestContext(
      {
        projectSlug: "acme",
        projectId: "project-1",
        token: "tenant-token",
        productionMode: false,
      },
      async () => {
        assertThrows(
          () => api._getClient(),
          Error,
          "requires an explicit branch",
        );
        await Promise.resolve();
      },
    );
  });
});
