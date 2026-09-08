import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { VeryfrontFSAdapter } from "./adapter.ts";
import { MultiProjectFSAdapter } from "./multi-project-adapter.ts";

const PROJECT_ID = "10000000-1000-4000-8000-100000000001";

function createAdapter(): VeryfrontFSAdapter {
  return new VeryfrontFSAdapter({
    veryfront: {
      apiBaseUrl: "https://api.example.com",
      apiToken: "project-token",
      projectSlug: "project-slug",
      projectId: PROJECT_ID,
      cache: { enabled: false },
    },
  });
}

describe("VeryfrontFSAdapter dependency metadata history", () => {
  it("reads the exact active branch scope", async () => {
    const adapter = createAdapter();
    adapter.setContentContext({
      sourceType: "branch",
      projectSlug: "project-slug",
      branch: "feature/exact",
    });
    const calls: Array<string | null> = [];
    const history = {
      version: 1 as const,
      projectId: PROJECT_ID,
      branch: "feature/exact",
      entries: [] as const,
    };
    adapter.getClient().readDependencyMetadataHistory = (branch) => {
      calls.push(branch);
      return Promise.resolve(history);
    };

    assertEquals(await adapter.readDependencyMetadataHistory(), history);
    assertEquals(calls, ["feature/exact"]);
  });

  it("reads a request-level branch override instead of the adapter main branch", async () => {
    const adapter = createAdapter();
    adapter.setContentContext({
      sourceType: "branch",
      projectSlug: "project-slug",
      branch: "main",
    });
    adapter.setRequestBranch("feature/exact");
    const calls: Array<string | null> = [];
    adapter.getClient().readDependencyMetadataHistory = (branch) => {
      calls.push(branch);
      return Promise.resolve({ version: 1, projectId: PROJECT_ID, branch, entries: [] });
    };
    assertEquals((await adapter.readDependencyMetadataHistory()).branch, "feature/exact");
    assertEquals(calls, ["feature/exact"]);
    adapter.dispose();
  });

  it("isolates concurrent multi-project and branch request contexts", async () => {
    const adapter = new MultiProjectFSAdapter({
      veryfront: {
        apiBaseUrl: "https://api.example.com",
        proxyMode: true,
        cache: { enabled: false },
      },
    });
    const requests: Array<{ project: string; branch: string | null; authorization: string }> = [];
    installMockFetch(async (input, init) => {
      const url = new URL(String(input));
      const project = url.pathname.split("/")[2];
      assertExists(project);
      const branch = url.searchParams.get("branch");
      const projectId = project === "project-a"
        ? "10000000-1000-4000-8000-100000000001"
        : "20000000-2000-4000-8000-200000000002";
      if (url.pathname === `/projects/${project}`) {
        return Response.json({ id: projectId, name: project, slug: project });
      }
      if (url.pathname === `/projects/${project}/files`) {
        return Response.json({
          data: [],
          page_info: { self: null, first: null, next: null, prev: null },
        });
      }
      requests.push({
        project,
        branch,
        authorization:
          new Headers(init && "headers" in init ? init.headers : undefined).get("authorization") ??
            "",
      });
      await new Promise((resolve) => setTimeout(resolve, project === "project-a" ? 10 : 0));
      return Response.json({
        version: 1,
        project_id: projectId,
        branch,
        entries: [],
      });
    });

    try {
      const [a, b] = await Promise.all([
        adapter.runWithContext(
          "project-a",
          "token-a",
          () => adapter.readDependencyMetadataHistory(),
          "10000000-1000-4000-8000-100000000001",
          { branch: "branch-a" },
        ),
        adapter.runWithContext(
          "project-b",
          "token-b",
          () => adapter.readDependencyMetadataHistory(),
          "20000000-2000-4000-8000-200000000002",
          { branch: "branch-b" },
        ),
      ]);

      assertEquals(a.projectId, "10000000-1000-4000-8000-100000000001");
      assertEquals(a.branch, "branch-a");
      assertEquals(b.projectId, "20000000-2000-4000-8000-200000000002");
      assertEquals(b.branch, "branch-b");
      assertEquals(requests.sort((left, right) => left.project.localeCompare(right.project)), [
        { project: "project-a", branch: "branch-a", authorization: "Bearer token-a" },
        { project: "project-b", branch: "branch-b", authorization: "Bearer token-b" },
      ]);
    } finally {
      restoreMockFetch();
      adapter.dispose();
    }
  });

  it("rejects immutable release and environment sources without falling back to main", async () => {
    for (
      const context of [
        { sourceType: "release" as const, projectSlug: "project-slug", releaseId: "release-id" },
        {
          sourceType: "environment" as const,
          projectSlug: "project-slug",
          environmentName: "production",
          releaseId: "release-id",
        },
      ]
    ) {
      const adapter = createAdapter();
      adapter.setContentContext(context);
      let called = false;
      adapter.getClient().readDependencyMetadataHistory = () => {
        called = true;
        return Promise.reject(new Error("must not call"));
      };

      await assertRejects(
        () => adapter.readDependencyMetadataHistory(),
        Error,
        "branch sources",
      );
      assertEquals(called, false);
    }
  });
});
