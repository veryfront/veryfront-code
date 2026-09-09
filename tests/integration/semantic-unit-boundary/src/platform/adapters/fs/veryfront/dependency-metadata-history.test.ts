import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { VeryfrontFSAdapter } from "#veryfront/platform/adapters/fs/veryfront/adapter.ts";
import { MultiProjectFSAdapter } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";

const PROJECT_ID = "10000000-1000-4000-8000-100000000001";

async function rejectIfPendingAfter<T>(promise: Promise<T>, timeoutMs = 100): Promise<T> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("History reader did not settle promptly after cancellation")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

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
    const calls: Array<{ branch: string | null; signal?: AbortSignal }> = [];
    const controller = new AbortController();
    const history = {
      version: 1 as const,
      projectId: PROJECT_ID,
      branch: "feature/exact",
      entries: [] as const,
    };
    adapter.getClient().readDependencyMetadataHistory = (branch, signal) => {
      calls.push({ branch, signal });
      return Promise.resolve(history);
    };

    assertEquals(await adapter.readDependencyMetadataHistory(controller.signal), history);
    assertEquals(calls, [{ branch: "feature/exact", signal: controller.signal }]);
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

  it("stops waiting for direct adapter initialization without starting history transport", async () => {
    const adapter = createAdapter();
    adapter.setContentContext({
      sourceType: "branch",
      projectSlug: "project-slug",
      branch: "feature/exact",
    });
    let releaseInitialization!: () => void;
    const initialization = new Promise<void>((resolve) => {
      releaseInitialization = resolve;
    });
    let markInitializationStarted!: () => void;
    const initializationStarted = new Promise<void>((resolve) => {
      markInitializationStarted = resolve;
    });
    let historyCalls = 0;
    adapter.getClient().initialize = () => {
      markInitializationStarted();
      return initialization;
    };
    adapter.getClient().readDependencyMetadataHistory = () => {
      historyCalls++;
      return Promise.resolve({ version: 1, projectId: PROJECT_ID, branch: null, entries: [] });
    };
    const controller = new AbortController();
    const cancellation = new Error("direct initialization wait cancelled");
    const history = adapter.readDependencyMetadataHistory(controller.signal);
    await initializationStarted;

    controller.abort(cancellation);

    try {
      await assertRejects(
        () => rejectIfPendingAfter(history),
        Error,
        "direct initialization wait cancelled",
      );
      assertEquals(historyCalls, 0);
    } finally {
      releaseInitialization();
      await initialization;
      await Promise.resolve();
      assertEquals(historyCalls, 0);
      adapter.dispose();
    }
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

  it("forwards cancellation through the multi-project adapter", async () => {
    const adapter = new MultiProjectFSAdapter({
      veryfront: {
        apiBaseUrl: "https://api.example.com",
        proxyMode: true,
        cache: { enabled: false },
      },
    });
    const controller = new AbortController();
    const cancellation = new DOMException("multi-project history cancelled", "AbortError");
    let observedSignal: AbortSignal | null | undefined;
    let markHistoryStarted!: () => void;
    const historyStarted = new Promise<void>((resolve) => {
      markHistoryStarted = resolve;
    });
    installMockFetch((input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/dependencies/history")) {
        observedSignal = init && "signal" in init ? init.signal : undefined;
        markHistoryStarted();
        return new Promise<Response>((_resolve, reject) => {
          const rejectAbort = () => reject(observedSignal?.reason);
          if (observedSignal?.aborted) rejectAbort();
          else observedSignal?.addEventListener("abort", rejectAbort, { once: true });
        });
      }
      if (url.pathname.endsWith("/files")) {
        return Promise.resolve(Response.json({
          data: [],
          page_info: { self: null, first: null, next: null, prev: null },
        }));
      }
      if (url.pathname.startsWith("/projects/")) {
        return Promise.resolve(Response.json({
          id: PROJECT_ID,
          name: "project-a",
          slug: "project-a",
        }));
      }
      throw new Error(`Unexpected request path: ${url.pathname}`);
    });

    try {
      const history = adapter.runWithContext(
        "project-a",
        "token-a",
        () => adapter.readDependencyMetadataHistory(controller.signal),
        PROJECT_ID,
        { branch: "feature/exact" },
      );
      await historyStarted;

      assertEquals(observedSignal?.aborted, false);
      controller.abort(cancellation);
      assertEquals(observedSignal?.aborted, true);
      await assertRejects(() => history, DOMException, "multi-project history cancelled");
    } finally {
      restoreMockFetch();
      adapter.dispose();
    }
  });

  it("stops waiting for multi-project initialization without starting history transport", async () => {
    const adapter = new MultiProjectFSAdapter({
      veryfront: {
        apiBaseUrl: "https://api.example.com",
        proxyMode: true,
        cache: { enabled: false },
      },
    });
    let releaseInitialization!: () => void;
    const initialization = new Promise<void>((resolve) => {
      releaseInitialization = resolve;
    });
    let markInitializationStarted!: () => void;
    const initializationStarted = new Promise<void>((resolve) => {
      markInitializationStarted = resolve;
    });
    let historyCalls = 0;
    installMockFetch(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/dependencies/history")) {
        historyCalls++;
        return Response.json({
          version: 1,
          project_id: PROJECT_ID,
          branch: "feature/exact",
          entries: [],
        });
      }
      if (url.pathname.endsWith("/files")) {
        return Response.json({
          data: [],
          page_info: { self: null, first: null, next: null, prev: null },
        });
      }
      markInitializationStarted();
      await initialization;
      return Response.json({ id: PROJECT_ID, name: "project-a", slug: "project-a" });
    });
    const controller = new AbortController();
    const cancellation = new Error("multi-project initialization wait cancelled");
    const history = adapter.runWithContext(
      "project-a",
      "token-a",
      () => adapter.readDependencyMetadataHistory(controller.signal),
      PROJECT_ID,
      { branch: "feature/exact" },
    );
    await initializationStarted;

    controller.abort(cancellation);

    try {
      await assertRejects(
        () => rejectIfPendingAfter(history),
        Error,
        "multi-project initialization wait cancelled",
      );
      assertEquals(historyCalls, 0);
    } finally {
      releaseInitialization();
      await initialization;
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(historyCalls, 0);
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
