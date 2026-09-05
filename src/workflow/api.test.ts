import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
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

  it("configures environment file context for release-less production tenants", async () => {
    await runWithRequestContext(
      {
        projectSlug: "acme",
        projectId: "project-1",
        token: "tenant-token",
        productionMode: true,
        environmentName: "Development",
      },
      async () => {
        assertEquals(
          api._getClient().getContext(),
          { type: "environment", name: "Development" },
          "release-less production tenants must resolve environment file context",
        );
      },
    );
  });

  it("keeps the tenant token out of public workflow accessors", async () => {
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
        assertThrows(
          () => api._getClient().getToken(),
          Error,
          "No API token available",
          "the public client view must not expose the request credential",
        );
        assertEquals("token" in api._getTenant(), false);
      },
    );
  });

  it("refuses a project slug that could escape the tenant", async () => {
    for (const slug of ["../other-project", "acme/../other", "acme project", ""]) {
      await runWithRequestContext(
        {
          projectSlug: slug,
          projectId: "project-1",
          token: "tenant-token",
          productionMode: false,
          branch: "main",
          environmentName: "preview",
        },
        () => {
          assertThrows(
            () => api._getClient(),
            Error,
            "Invalid project slug",
            `project slug ${
              JSON.stringify(slug)
            } must be rejected before it reaches the API client`,
          );
          return Promise.resolve();
        },
      );
    }
  });
});
