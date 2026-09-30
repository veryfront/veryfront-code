import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { prepareProjectRequest } from "./project-runtime-context.ts";

const installation = {
  projectId: "installed-project-id",
  projectSlug: "installed-project",
  releaseId: "installed-release",
  environmentId: "installed-environment-id",
  environmentName: "staging",
};

describe("installed project HTTP identity", () => {
  it("does not let host, headers or query parameters replace the installed identity", async () => {
    const req = new Request("https://foreign.preview.veryfront.com/api/echo?slug=foreign", {
      headers: {
        "x-project-id": "foreign-project",
        "x-project-slug": "foreign",
        "x-project-path": "/foreign/source",
        "x-release-id": "foreign-release",
        "x-environment-id": "foreign-environment",
        "x-environment-name": "foreign-environment",
        "x-branch-name": "foreign-branch",
        "x-content-source-id": "foreign-source",
        "x-token": "synthetic-platform-token",
        authorization: "Bearer application-token",
      },
    });
    const prepared = await prepareProjectRequest({
      req,
      url: new URL(req.url),
      isProxyMode: false,
      installedProject: installation,
    });
    assertEquals(prepared.headers.projectId, installation.projectId);
    assertEquals(prepared.headers.projectSlug, installation.projectSlug);
    assertEquals(prepared.headers.releaseId, installation.releaseId);
    assertEquals(prepared.headers.environmentId, installation.environmentId);
    assertEquals(prepared.headers.environmentName, installation.environmentName);
    assertEquals(prepared.headers.projectPath, undefined);
    assertEquals(prepared.headers.contentSourceId, undefined);
    assertEquals(prepared.headers.branchName, undefined);
    assertEquals(prepared.requestContext, {
      slug: installation.projectSlug,
      branch: null,
      mode: "production",
      token: "",
    });
    assertEquals(prepared.trackingFacts.projectSlug, installation.projectSlug);
    assertEquals(prepared.loggerFacts.projectId, installation.projectId);
    assertEquals(req.headers.get("authorization"), "Bearer application-token");
  });
});
