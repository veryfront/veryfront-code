import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { api } from "./api.ts";

describe("workflow api", () => {
  it("configures release-backed file context from the current tenant", async () => {
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
});
