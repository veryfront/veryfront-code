import { assertEquals } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { VeryfrontApiClient, VeryfrontError } from "./veryfront-api-client/index.ts";

function assertVeryfrontError(error: unknown): VeryfrontError {
  assertEquals(error instanceof VeryfrontError, true);
  return error as VeryfrontError;
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
                    id: "00000000-0000-0000-0000-000000000001",
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
                id: "00000000-0000-0000-0000-000000000001",
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
                    id: "00000000-0000-0000-0000-000000000001",
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
                id: "00000000-0000-0000-0000-000000000001",
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
  });
});
