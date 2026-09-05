/**
 * Workflow request-token boundary.
 *
 * This case replaces a public client prototype and installs a process-global
 * transport, so it belongs in the semantic integration suite.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { VeryfrontApiClient } from "#veryfront/platform/adapters/veryfront-api-client/client.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { api } from "../../../../../src/workflow/api.ts";

describe("workflow API private request token", () => {
  it("does not pass the tenant token through the public client prototype", async () => {
    const originalSetRequestToken = VeryfrontApiClient.prototype.setRequestToken;
    let observedToken: string | undefined;
    VeryfrontApiClient.prototype.setRequestToken = (token: string) => {
      observedToken = token;
    };

    try {
      await withMockFetch(
        async (_input, init) => {
          assertEquals(new Headers(init?.headers).get("Authorization"), "Bearer tenant-token");
          return Response.json({
            id: "file-1",
            path: "README.md",
            content: "ok",
            type: "file",
            size: 2,
            updated_at: "2026-09-05T00:00:00.000Z",
          });
        },
        () =>
          runWithRequestContext(
            {
              projectSlug: "acme",
              projectId: "project-1",
              token: "tenant-token",
              productionMode: false,
              branch: "main",
              environmentName: "preview",
            },
            async () => assertEquals(await api.files.read("README.md"), "ok"),
          ),
      );
      assertEquals(observedToken, undefined);
    } finally {
      VeryfrontApiClient.prototype.setRequestToken = originalSetRequestToken;
    }
  });
});
