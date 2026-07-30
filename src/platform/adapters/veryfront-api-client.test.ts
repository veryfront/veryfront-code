import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { MAX_CSS_PIPELINE_IDENTITY_CODE_UNITS } from "#veryfront/utils";
import {
  createStyleArtifactTuple,
  VeryfrontApiClient,
  VeryfrontError,
} from "./veryfront-api-client/index.ts";

const STYLE_PROFILE_HASH_1 = "1".repeat(64);
const STYLE_PROFILE_HASH_2 = "2".repeat(64);
const STYLE_PROFILE_HASH_3 = "3".repeat(64);
const STYLE_PROFILE_HASH_4 = "4".repeat(64);
const ARTIFACT_HASH_1 = "a".repeat(64);
const ARTIFACT_HASH_2 = "b".repeat(64);

function assertVeryfrontError(error: unknown): VeryfrontError {
  assertEquals(error instanceof VeryfrontError, true);
  return error as VeryfrontError;
}

function requestMethod(init: unknown): string | undefined {
  if (!init || typeof init !== "object" || !("method" in init)) return undefined;
  const method = (init as { method?: unknown }).method;
  return typeof method === "string" ? method : undefined;
}

function requestJsonBody(init: unknown): Record<string, unknown> | null {
  if (!init || typeof init !== "object" || !("body" in init)) return null;
  const body = (init as { body?: unknown }).body;
  return typeof body === "string" ? JSON.parse(body) as Record<string, unknown> : null;
}

describe("VeryfrontApiClient", () => {
  const mockConfig = {
    apiBaseUrl: "https://api.test.com",
    apiToken: "test-token",
    projectSlug: "test-project",
  };

  let client: VeryfrontApiClient;

  beforeEach(() => {
    client = new VeryfrontApiClient({
      ...mockConfig,
      retry: {
        maxRetries: 2,
        initialDelay: 5,
        maxDelay: 25,
      },
    });

    client.setContext({ type: "branch", name: "main" });
  });

  describe("initialization", () => {
    it("should throw error if not initialized", () => {
      try {
        client.getProjectId();
        throw new Error("Should have thrown");
      } catch (error) {
        const apiError = assertVeryfrontError(error);
        assertEquals(apiError.message.includes("not initialized"), true);
      }
    });
  });

  describe("error handling", () => {
    it("should wrap API errors in VeryfrontAPIError", async () => {
      await withMockFetch(
        () => Promise.resolve(new Response("Not found", { status: 404, statusText: "Not Found" })),
        async () => {
          try {
            await client.listProjects();
            throw new Error("Should have thrown");
          } catch (error) {
            const apiError = assertVeryfrontError(error);
            assertEquals(apiError.status, 404);
          }
        },
      );
    });

    it("should not retry on 4xx errors", async () => {
      let callCount = 0;

      await withMockFetch(
        () => {
          callCount++;
          return Promise.resolve(
            new Response("Bad request", { status: 400, statusText: "Bad Request" }),
          );
        },
        async () => {
          try {
            await client.listProjects();
            throw new Error("Should have thrown");
          } catch (error) {
            assertVeryfrontError(error);
            assertEquals(callCount, 1);
          }
        },
      );
    });
  });

  describe("request retry logic", () => {
    it("should retry on 5xx errors", async () => {
      let callCount = 0;

      await withMockFetch(
        () => {
          callCount++;

          if (callCount < 3) {
            return Promise.resolve(
              new Response("Server error", { status: 500, statusText: "Internal Server Error" }),
            );
          }

          return Promise.resolve(
            new Response(JSON.stringify({ data: [] }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        },
        async () => {
          const result = await client.listProjects();
          assertEquals(callCount, 3);
          assertEquals(result.length, 0);
        },
      );
    });

    it("should respect maxRetries config", async () => {
      let callCount = 0;

      const clientWithRetries = new VeryfrontApiClient({
        ...mockConfig,
        retry: {
          maxRetries: 1,
          initialDelay: 10,
          maxDelay: 100,
        },
      });

      await withMockFetch(
        () => {
          callCount++;
          return Promise.resolve(
            new Response("Server error", { status: 500, statusText: "Internal Server Error" }),
          );
        },
        async () => {
          try {
            await clientWithRetries.listProjects();
            throw new Error("Should have thrown");
          } catch (error) {
            assertVeryfrontError(error);
            assertEquals(callCount, 2);
          }
        },
      );
    });
  });

  describe("file operations", () => {
    it("snapshots an immutable exact style artifact tuple", () => {
      const tuple = createStyleArtifactTuple({
        cssPipelineIdentity: "pipeline@1",
        styleProfileHash: STYLE_PROFILE_HASH_1,
        environmentName: "Preview",
      });

      assertEquals(tuple, {
        cssPipelineIdentity: "pipeline@1",
        styleProfileHash: STYLE_PROFILE_HASH_1,
        environmentName: "Preview",
      });
      assertEquals(Object.isFrozen(tuple), true);
    });

    it("should handle pagination in listAllFiles", async () => {
      let page = 0;

      await withMockFetch(
        (url) => {
          const urlStr = typeof url === "string" ? url : url.toString();

          if (urlStr.endsWith("/projects")) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  data: [{
                    id: "00000000-0000-4000-a000-000000000001",
                    name: "Test",
                    slug: "test-project",
                    created_at: "2024-01-01",
                    updated_at: "2024-01-01",
                  }],
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              ),
            );
          }

          if (urlStr.includes("/projects/test-project/files?") && urlStr.includes("branch=main")) {
            page++;

            if (page === 1) {
              return Promise.resolve(
                new Response(
                  JSON.stringify({
                    data: [
                      {
                        path: "file1.ts",
                        content: "// file1",
                        size: 100,
                        type: "file",
                        updated_at: "2024-01-01",
                      },
                      {
                        path: "file2.ts",
                        content: "// file2",
                        size: 200,
                        type: "file",
                        updated_at: "2024-01-01",
                      },
                    ],
                    page_info: {
                      self: null,
                      first: null,
                      next: "page2",
                      prev: null,
                    },
                  }),
                  { status: 200, headers: { "Content-Type": "application/json" } },
                ),
              );
            }

            return Promise.resolve(
              new Response(
                JSON.stringify({
                  data: [
                    {
                      path: "file3.ts",
                      content: "// file3",
                      size: 300,
                      type: "file",
                      updated_at: "2024-01-01",
                    },
                  ],
                  page_info: {
                    self: "page2",
                    first: null,
                    next: null,
                    prev: "page1",
                  },
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              ),
            );
          }

          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: "00000000-0000-4000-a000-000000000001",
                name: "Test",
                slug: "test-project",
                created_at: "2024-01-01",
                updated_at: "2024-01-01",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        },
        async () => {
          await client.initialize();
          const files = await client.listAllFiles();

          assertEquals(files.length, 3);
          assertEquals(files[0]?.path, "file1.ts");
          assertEquals(files[1]?.path, "file2.ts");
          assertEquals(files[2]?.path, "file3.ts");
        },
      );
    });

    it("should get file content as text", async () => {
      await withMockFetch(
        (url) => {
          const urlStr = typeof url === "string" ? url : url.toString();

          if (urlStr.endsWith("/projects")) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  data: [{
                    id: "00000000-0000-4000-a000-000000000001",
                    name: "Test",
                    slug: "test-project",
                    created_at: "2024-01-01",
                    updated_at: "2024-01-01",
                  }],
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              ),
            );
          }

          if (
            urlStr.includes("/projects/test-project/files/test.ts?") &&
            urlStr.includes("branch=main")
          ) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  path: "test.ts",
                  content: 'console.log("Hello")',
                  size: 21,
                  type: "file",
                  updated_at: "2024-01-01",
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              ),
            );
          }

          if (urlStr.includes("/projects/test-project/files?") && urlStr.includes("branch=main")) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  data: [],
                  page_info: {
                    has_next_page: false,
                    end_cursor: null,
                    has_previous_page: false,
                    start_cursor: null,
                  },
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              ),
            );
          }

          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: "00000000-0000-4000-a000-000000000001",
                name: "Test",
                slug: "test-project",
                created_at: "2024-01-01",
                updated_at: "2024-01-01",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        },
        async () => {
          await client.initialize();
          const content = await client.getFileContent("test.ts");
          assertEquals(content, 'console.log("Hello")');
        },
      );
    });

    it("should resolve a ready style artifact for the current project selector and CSS pipeline", async () => {
      const cssPipelineIdentity =
        '["veryfront.css-pipeline.v1","tailwindcss@4.1.0","lightningcss@1.29.1"]';
      await withMockFetch(
        (url, init) => {
          const urlStr = typeof url === "string" ? url : url.toString();

          if (urlStr.includes("/projects/test-project/style-artifacts/current?")) {
            assertEquals(requestMethod(init) ?? "GET", "GET");
            const params = new URL(urlStr, "https://veryfront.invalid").searchParams;
            assertEquals(params.get("style_profile_hash"), STYLE_PROFILE_HASH_1);
            assertEquals(params.get("css_pipeline_identity"), cssPipelineIdentity);
            assertEquals(params.get("branch"), "main");
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  status: "ready",
                  css_pipeline_identity: cssPipelineIdentity,
                  style_profile_hash: STYLE_PROFILE_HASH_1,
                  branch: "main",
                  artifact_hash: ARTIFACT_HASH_1,
                  asset_path: `/_vf/css/${ARTIFACT_HASH_1}.css`,
                  content_type: "text/css; charset=utf-8",
                  etag: `"${ARTIFACT_HASH_1}"`,
                  updated_at: "2026-03-22T00:00:00.000Z",
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              ),
            );
          }

          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: "00000000-0000-4000-a000-000000000001",
                name: "Test",
                slug: "test-project",
                created_at: "2024-01-01",
                updated_at: "2024-01-01",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        },
        async () => {
          const result = await client.resolveStyleArtifact({
            cssPipelineIdentity,
            styleProfileHash: STYLE_PROFILE_HASH_1,
            branch: "main",
          });

          assertEquals(result.status, "ready");
          if (result.status !== "ready") throw new Error("Expected ready style artifact");
          assertEquals(result.cssPipelineIdentity, cssPipelineIdentity);
          assertEquals(result.styleProfileHash, STYLE_PROFILE_HASH_1);
          assertEquals(result.branch, "main");
          assertEquals(result.artifactHash, ARTIFACT_HASH_1);
        },
      );
    });

    it("should register a style artifact with a PUT request", async () => {
      const cssPipelineIdentity =
        '["veryfront.css-pipeline.v1","tailwindcss@4.1.0","lightningcss@1.29.1"]';
      await withMockFetch(
        async (url, init) => {
          const urlStr = typeof url === "string" ? url : url.toString();

          if (urlStr.endsWith("/projects/test-project/style-artifacts/current")) {
            assertEquals(requestMethod(init), "PUT");
            const body = requestJsonBody(init);
            assertEquals(body?.css_pipeline_identity, cssPipelineIdentity);
            assertEquals(body?.style_profile_hash, STYLE_PROFILE_HASH_2);
            assertEquals(body?.environment_name, "Preview");
            assertEquals(body?.artifact_hash, ARTIFACT_HASH_2);
            assertEquals(body?.asset_path, `/_vf/css/${ARTIFACT_HASH_2}.css`);
            assertEquals(body?.content_type, "text/css; charset=utf-8");
            assertEquals(body?.etag, `"${ARTIFACT_HASH_2}"`);

            return new Response(
              JSON.stringify({
                status: "ready",
                css_pipeline_identity: cssPipelineIdentity,
                style_profile_hash: STYLE_PROFILE_HASH_2,
                environment_name: "Preview",
                artifact_hash: ARTIFACT_HASH_2,
                asset_path: `/_vf/css/${ARTIFACT_HASH_2}.css`,
                content_type: "text/css; charset=utf-8",
                etag: `"${ARTIFACT_HASH_2}"`,
                updated_at: "2026-03-22T00:00:00.000Z",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }

          return new Response("Not found", { status: 404, statusText: "Not Found" });
        },
        async () => {
          const result = await client.upsertStyleArtifact({
            cssPipelineIdentity,
            styleProfileHash: STYLE_PROFILE_HASH_2,
            environmentName: "Preview",
            status: "ready",
            artifactHash: ARTIFACT_HASH_2,
          });

          assertEquals(result.status, "ready");
          if (result.status !== "ready") throw new Error("Expected ready style artifact");
          assertEquals(result.assetPath, `/_vf/css/${ARTIFACT_HASH_2}.css`);
        },
      );
    });

    it("should parse non-ready style artifact states", async () => {
      const cssPipelineIdentity =
        '["veryfront.css-pipeline.v1","tailwindcss@4.1.0","lightningcss@1.29.1"]';
      await withMockFetch(
        (url, init) => {
          const urlStr = typeof url === "string" ? url : url.toString();

          if (urlStr.includes("/projects/test-project/style-artifacts/current?")) {
            assertEquals(requestMethod(init) ?? "GET", "GET");
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  status: "building",
                  css_pipeline_identity: cssPipelineIdentity,
                  style_profile_hash: STYLE_PROFILE_HASH_3,
                  branch: "main",
                  build_run_id: "run_11111111-1111-4111-a111-111111111111",
                  updated_at: "2026-03-22T00:00:00.000Z",
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              ),
            );
          }

          return Promise.resolve(
            new Response("Not found", { status: 404, statusText: "Not Found" }),
          );
        },
        async () => {
          const result = await client.resolveStyleArtifact({
            cssPipelineIdentity,
            styleProfileHash: STYLE_PROFILE_HASH_3,
            branch: "main",
          });

          assertEquals(result.status, "building");
          if (result.status !== "building") throw new Error("Expected building style artifact");
          assertEquals(result.buildRunId, "run_11111111-1111-4111-a111-111111111111");
        },
      );
    });

    it("should enqueue a style artifact build with a POST request", async () => {
      const cssPipelineIdentity =
        '["veryfront.css-pipeline.v1","tailwindcss@4.1.0","lightningcss@1.29.1"]';
      await withMockFetch(
        (url, init) => {
          const urlStr = typeof url === "string" ? url : url.toString();

          if (urlStr.endsWith("/projects/test-project/style-artifacts/current/builds")) {
            assertEquals(requestMethod(init), "POST");
            const body = requestJsonBody(init);
            assertEquals(body?.css_pipeline_identity, cssPipelineIdentity);
            assertEquals(body?.style_profile_hash, STYLE_PROFILE_HASH_4);
            assertEquals(body?.environment_name, "Production");
            assertEquals(body?.force, false);

            return Promise.resolve(
              new Response(
                JSON.stringify({
                  status: "building",
                  css_pipeline_identity: cssPipelineIdentity,
                  style_profile_hash: STYLE_PROFILE_HASH_4,
                  environment_name: "Production",
                  build_run_id: "run_22222222-2222-4222-a222-222222222222",
                  updated_at: "2026-03-22T00:00:00.000Z",
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              ),
            );
          }

          return Promise.resolve(
            new Response("Not found", { status: 404, statusText: "Not Found" }),
          );
        },
        async () => {
          const result = await client.ensureStyleArtifactBuild({
            cssPipelineIdentity,
            styleProfileHash: STYLE_PROFILE_HASH_4,
            environmentName: "Production",
          });

          assertEquals(result.status, "building");
          if (result.status !== "building") throw new Error("Expected building style artifact");
          assertEquals(result.buildRunId, "run_22222222-2222-4222-a222-222222222222");
        },
      );
    });

    it("rejects absent or mismatched style artifact tuple echoes for every operation", async () => {
      const cssPipelineIdentity = "pipeline@1";
      const operations = [
        () =>
          client.resolveStyleArtifact({
            cssPipelineIdentity,
            styleProfileHash: STYLE_PROFILE_HASH_1,
            environmentName: "Preview",
          }),
        () =>
          client.ensureStyleArtifactBuild({
            cssPipelineIdentity,
            styleProfileHash: STYLE_PROFILE_HASH_1,
            environmentName: "Preview",
          }),
        () =>
          client.upsertStyleArtifact({
            cssPipelineIdentity,
            styleProfileHash: STYLE_PROFILE_HASH_1,
            environmentName: "Preview",
            status: "failed",
            failureReason: "compile failed",
          }),
      ];

      for (const operation of operations) {
        for (const echoedIdentity of [undefined, "pipeline@2"]) {
          await withMockFetch(
            () =>
              Promise.resolve(
                new Response(
                  JSON.stringify({
                    status: "missing",
                    style_profile_hash: STYLE_PROFILE_HASH_1,
                    environment_name: "Preview",
                    ...(echoedIdentity === undefined
                      ? {}
                      : { css_pipeline_identity: echoedIdentity }),
                  }),
                  { status: 200, headers: { "Content-Type": "application/json" } },
                ),
              ),
            async () => {
              const error = assertVeryfrontError(
                await assertRejects(operation, VeryfrontError),
              );
              assertEquals(error.status, 502);
              assertEquals(error.slug, "api-client-error");
            },
          );
        }
      }
    });

    it("rejects hostile style artifact identities before issuing a request", async () => {
      let requestCount = 0;
      await withMockFetch(
        () => {
          requestCount += 1;
          return Promise.resolve(new Response("unexpected", { status: 500 }));
        },
        async () => {
          for (
            const cssPipelineIdentity of [
              "pipeline\nidentity",
              "x".repeat(MAX_CSS_PIPELINE_IDENTITY_CODE_UNITS + 1),
            ]
          ) {
            await assertRejects(
              () =>
                client.resolveStyleArtifact({
                  cssPipelineIdentity,
                  styleProfileHash: STYLE_PROFILE_HASH_1,
                  branch: "main",
                }),
              TypeError,
              "CSS pipeline identity",
            );
          }

          await assertRejects(
            () =>
              client.ensureStyleArtifactBuild({
                cssPipelineIdentity: "pipeline@1",
                styleProfileHash: "profile-1",
                branch: "main",
              }),
            TypeError,
            "Style profile hash",
          );

          await assertRejects(
            () =>
              client.upsertStyleArtifact({
                cssPipelineIdentity: "pipeline@1",
                styleProfileHash: STYLE_PROFILE_HASH_1,
                branch: "main",
                artifactHash: "not-a-sha256",
              }),
            TypeError,
            "Style artifact hash",
          );
        },
      );
      assertEquals(requestCount, 0);
    });

    it("requires exactly one canonical selector before issuing a request", async () => {
      let requestCount = 0;
      await withMockFetch(
        () => {
          requestCount += 1;
          return Promise.resolve(new Response("unexpected", { status: 500 }));
        },
        async () => {
          for (
            const selector of [
              {},
              { branch: "main", environmentName: "Preview" },
              { branch: " main" },
              { releaseId: "release\n1" },
            ]
          ) {
            await assertRejects(
              () =>
                client.resolveStyleArtifact({
                  cssPipelineIdentity: "pipeline@1",
                  styleProfileHash: STYLE_PROFILE_HASH_1,
                  ...selector,
                } as never),
              TypeError,
            );
          }
        },
      );
      assertEquals(requestCount, 0);
    });

    it("rejects mismatched selector and profile echoes", async () => {
      for (
        const responseTuple of [
          { style_profile_hash: STYLE_PROFILE_HASH_2, branch: "main" },
          { style_profile_hash: STYLE_PROFILE_HASH_1, branch: "other" },
          { style_profile_hash: STYLE_PROFILE_HASH_1, environment_name: "Preview" },
        ]
      ) {
        await withMockFetch(
          () =>
            Promise.resolve(
              new Response(
                JSON.stringify({
                  status: "missing",
                  css_pipeline_identity: "pipeline@1",
                  ...responseTuple,
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              ),
            ),
          async () => {
            const error = assertVeryfrontError(
              await assertRejects(
                () =>
                  client.resolveStyleArtifact({
                    cssPipelineIdentity: "pipeline@1",
                    styleProfileHash: STYLE_PROFILE_HASH_1,
                    branch: "main",
                  }),
                VeryfrontError,
              ),
            );
            assertEquals(error.status, 502);
          },
        );
      }
    });

    it("rejects status-invalid fields and non-canonical ready metadata", async () => {
      const invalidResponses = [
        {
          status: "missing",
          css_pipeline_identity: "pipeline@1",
          style_profile_hash: STYLE_PROFILE_HASH_1,
          branch: "main",
          artifact_hash: ARTIFACT_HASH_1,
        },
        {
          status: "building",
          css_pipeline_identity: "pipeline@1",
          style_profile_hash: STYLE_PROFILE_HASH_1,
          branch: "main",
        },
        {
          status: "ready",
          css_pipeline_identity: "pipeline@1",
          style_profile_hash: STYLE_PROFILE_HASH_1,
          branch: "main",
          artifact_hash: ARTIFACT_HASH_1,
          asset_path: "/wrong.css",
          content_type: "text/css; charset=utf-8",
          etag: `"${ARTIFACT_HASH_1}"`,
        },
      ];

      for (const response of invalidResponses) {
        await withMockFetch(
          () =>
            Promise.resolve(
              new Response(JSON.stringify(response), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }),
            ),
          async () => {
            const error = assertVeryfrontError(
              await assertRejects(
                () =>
                  client.resolveStyleArtifact({
                    cssPipelineIdentity: "pipeline@1",
                    styleProfileHash: STYLE_PROFILE_HASH_1,
                    branch: "main",
                  }),
                VeryfrontError,
              ),
            );
            assertEquals(error.status, 502);
          },
        );
      }
    });

    it("rejects a PUT acknowledgement for another artifact hash", async () => {
      await withMockFetch(
        () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                status: "ready",
                css_pipeline_identity: "pipeline@1",
                style_profile_hash: STYLE_PROFILE_HASH_1,
                branch: "main",
                artifact_hash: ARTIFACT_HASH_2,
                asset_path: `/_vf/css/${ARTIFACT_HASH_2}.css`,
                content_type: "text/css; charset=utf-8",
                etag: `"${ARTIFACT_HASH_2}"`,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          ),
        async () => {
          const error = assertVeryfrontError(
            await assertRejects(
              () =>
                client.upsertStyleArtifact({
                  cssPipelineIdentity: "pipeline@1",
                  styleProfileHash: STYLE_PROFILE_HASH_1,
                  branch: "main",
                  artifactHash: ARTIFACT_HASH_1,
                }),
              VeryfrontError,
            ),
          );
          assertEquals(error.status, 502);
        },
      );
    });

    it("rejects a PUT acknowledgement with another status", async () => {
      await withMockFetch(
        () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                status: "missing",
                css_pipeline_identity: "pipeline@1",
                style_profile_hash: STYLE_PROFILE_HASH_1,
                branch: "main",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          ),
        async () => {
          const error = assertVeryfrontError(
            await assertRejects(
              () =>
                client.upsertStyleArtifact({
                  cssPipelineIdentity: "pipeline@1",
                  styleProfileHash: STYLE_PROFILE_HASH_1,
                  branch: "main",
                  artifactHash: ARTIFACT_HASH_1,
                }),
              VeryfrontError,
            ),
          );
          assertEquals(error.status, 502);
        },
      );
    });

    it("does not invoke style artifact identity accessors", async () => {
      let getterCalls = 0;
      const input = {
        branch: "main",
        styleProfileHash: STYLE_PROFILE_HASH_1,
        get cssPipelineIdentity(): string {
          getterCalls += 1;
          return "pipeline@1";
        },
      };

      await assertRejects(
        () => client.resolveStyleArtifact(input),
        TypeError,
        "own data property",
      );
      assertEquals(getterCalls, 0);
    });
  });
});
