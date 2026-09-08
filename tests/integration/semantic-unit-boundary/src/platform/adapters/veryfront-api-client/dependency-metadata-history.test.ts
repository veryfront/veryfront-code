import "#veryfront/schemas/_test-setup.ts";

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { VeryfrontAPIOperations } from "#veryfront/platform/adapters/veryfront-api-client/operations.ts";

const PROJECT_ID = "10000000-1000-4000-8000-100000000001";

function createOps(token = "project-token"): VeryfrontAPIOperations {
  return new VeryfrontAPIOperations(
    "https://api.example.com",
    token,
    { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
    PROJECT_ID,
  );
}

function response(branch: string | null = null): Record<string, unknown> {
  return {
    version: 1,
    project_id: PROJECT_ID,
    branch,
    entries: [{ dependencies: { react: "19.1.0" }, expires_at: 1_800_000_000_000 }],
  };
}

describe("dependency metadata history API", () => {
  afterEach(() => restoreMockFetch());

  it("omits the branch query for main and uses the existing bearer token", async () => {
    let requestedUrl = "";
    let authorization = "";
    installMockFetch((_input, init) => {
      requestedUrl = String(_input);
      authorization =
        new Headers(init && "headers" in init ? init.headers : undefined).get("authorization") ??
          "";
      return Promise.resolve(Response.json(response()));
    });

    const history = await createOps().readDependencyMetadataHistory(
      "project-slug",
      PROJECT_ID,
      null,
    );

    assertEquals(new URL(requestedUrl).pathname, "/projects/project-slug/dependencies/history");
    assertEquals(new URL(requestedUrl).search, "");
    assertEquals(authorization, "Bearer project-token");
    assertEquals(requestedUrl.includes("/internal/"), false);
    assertEquals(history, {
      version: 1,
      projectId: PROJECT_ID,
      branch: null,
      entries: [{ dependencies: { react: "19.1.0" }, expiresAt: 1_800_000_000_000 }],
    });
  });

  it("preserves a named branch exactly in the query and response", async () => {
    let requestedUrl = "";
    const branch = "Feature/Exact Case";
    installMockFetch((input) => {
      requestedUrl = String(input);
      return Promise.resolve(Response.json(response(branch)));
    });

    const history = await createOps().readDependencyMetadataHistory(
      "project-slug",
      PROJECT_ID,
      branch,
    );

    assertEquals(new URL(requestedUrl).searchParams.get("branch"), branch);
    assertEquals(history.branch, branch);
  });

  it("preserves dependency names that overlap object internals", async () => {
    installMockFetch(() =>
      Promise.resolve(
        new Response(
          `{"version":1,"project_id":"${PROJECT_ID}","branch":null,"entries":[{"dependencies":{"__proto__":"proto-version","constructor":"constructor-version","toJSON":"json-version"},"expires_at":1800000000000}]}`,
          { headers: { "Content-Type": "application/json" } },
        ),
      )
    );

    const history = await createOps().readDependencyMetadataHistory(
      "project-slug",
      PROJECT_ID,
      null,
    );
    const entry = history.entries[0];
    assertExists(entry);
    const dependencies = entry.dependencies;

    assertEquals(Object.keys(dependencies).sort(), ["__proto__", "constructor", "toJSON"]);
    assertEquals(
      Object.getOwnPropertyDescriptor(dependencies, "__proto__")?.value,
      "proto-version",
    );
    assertEquals(
      Object.getOwnPropertyDescriptor(dependencies, "constructor")?.value,
      "constructor-version",
    );
    assertEquals(Object.getOwnPropertyDescriptor(dependencies, "toJSON")?.value, "json-version");
  });

  it("normalizes an explicit main branch to the omitted query", async () => {
    let requestedUrl = "";
    installMockFetch((input) => {
      requestedUrl = String(input);
      return Promise.resolve(Response.json(response()));
    });

    await createOps().readDependencyMetadataHistory("project-slug", PROJECT_ID, "main");

    assertEquals(new URL(requestedUrl).searchParams.has("branch"), false);
  });

  it("rejects response identity mismatches", async () => {
    installMockFetch(() =>
      Promise.resolve(Response.json({
        ...response("expected"),
        project_id: "20000000-2000-4000-8000-200000000002",
      }))
    );

    await assertRejects(
      () => createOps().readDependencyMetadataHistory("project-slug", PROJECT_ID, "expected"),
      Error,
      "identity",
    );

    restoreMockFetch();
    installMockFetch(() => Promise.resolve(Response.json(response("other"))));
    await assertRejects(
      () => createOps().readDependencyMetadataHistory("project-slug", PROJECT_ID, "expected"),
      Error,
      "identity",
    );
  });

  it("rejects invalid entries and more than sixteen candidates", async () => {
    for (
      const entries of [
        [{ dependencies: { react: 19 }, expires_at: 1_800_000_000_000 }],
        Array.from({ length: 17 }, () => ({ dependencies: {}, expires_at: 1_800_000_000_000 })),
        [{ dependencies: {}, expires_at: 1.5 }],
      ]
    ) {
      installMockFetch(() => Promise.resolve(Response.json({ ...response(), entries })));
      await assertRejects(() =>
        createOps().readDependencyMetadataHistory("project-slug", PROJECT_ID, null)
      );
      restoreMockFetch();
    }
  });

  it("bounds the response body before materializing it", async () => {
    const oversized = JSON.stringify({ ...response(), padding: "x".repeat(1024 * 1024) });
    installMockFetch(() => Promise.resolve(new Response(oversized)));

    const error = await assertRejects(() =>
      createOps().readDependencyMetadataHistory("project-slug", PROJECT_ID, null)
    );
    assertStringIncludes(String(error), "exceeded");
  });

  it("propagates API errors without retaining the response body in diagnostics", async () => {
    installMockFetch(() =>
      Promise.resolve(
        new Response('{"credential":"must-not-escape"}', {
          status: 403,
          statusText: "Forbidden",
        }),
      )
    );

    const error = await assertRejects(() =>
      createOps().readDependencyMetadataHistory("project-slug", PROJECT_ID, null)
    );
    assertStringIncludes(String(error), "403 Forbidden");
    assertEquals(String(error).includes("must-not-escape"), false);
  });
});
