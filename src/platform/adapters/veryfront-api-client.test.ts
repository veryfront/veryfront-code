import { assertEquals } from "@veryfront/testing/assert";
import { beforeEach, describe, it } from "@veryfront/testing/bdd";
import { VeryfrontAPIClient, VeryfrontAPIError } from "./veryfront-api-client/index.ts";

describe("VeryfrontAPIClient", () => {
  const mockConfig = {
    apiBaseUrl: "https://api.test.com",
    apiToken: "test-token",
    projectSlug: "test-project",
  };

  let client: VeryfrontAPIClient;

  beforeEach(() => {
    client = new VeryfrontAPIClient({
      ...mockConfig,
      retry: {
        maxRetries: 2,
        initialDelay: 5,
        maxDelay: 25,
      },
    });
    // Use branch context for simpler mock responses
    client.setContext({ type: "branch", name: "main" });
  });

  describe("initialization", () => {
    it("should throw error if not initialized", () => {
      try {
        client.getProjectId();
        throw new Error("Should have thrown");
      } catch (error) {
        assertEquals(error instanceof VeryfrontAPIError, true);
        assertEquals((error as VeryfrontAPIError).message.includes("not initialized"), true);
      }
    });
  });

  describe("error handling", () => {
    it("should wrap API errors in VeryfrontAPIError", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = () => {
        return Promise.resolve(new Response("Not found", { status: 404, statusText: "Not Found" }));
      };

      try {
        await client.listProjects();
        throw new Error("Should have thrown");
      } catch (error) {
        assertEquals(error instanceof VeryfrontAPIError, true);
        assertEquals((error as VeryfrontAPIError).status, 404);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should not retry on 4xx errors", async () => {
      let callCount = 0;

      const originalFetch = globalThis.fetch;
      globalThis.fetch = () => {
        callCount++;
        return Promise.resolve(
          new Response("Bad request", { status: 400, statusText: "Bad Request" }),
        );
      };

      try {
        await client.listProjects();
        throw new Error("Should have thrown");
      } catch (error) {
        assertEquals(error instanceof VeryfrontAPIError, true);
        assertEquals(callCount, 1); // Should not retry
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("request retry logic", () => {
    it("should retry on 5xx errors", async () => {
      let callCount = 0;

      const originalFetch = globalThis.fetch;
      globalThis.fetch = () => {
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
      };

      try {
        const result = await client.listProjects();
        assertEquals(callCount, 3); // Should retry twice and succeed on third attempt
        assertEquals(result.length, 0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should respect maxRetries config", async () => {
      let callCount = 0;

      const clientWithRetries = new VeryfrontAPIClient({
        ...mockConfig,
        retry: {
          maxRetries: 1,
          initialDelay: 10,
          maxDelay: 100,
        },
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = () => {
        callCount++;
        return Promise.resolve(
          new Response("Server error", { status: 500, statusText: "Internal Server Error" }),
        );
      };

      try {
        await clientWithRetries.listProjects();
        throw new Error("Should have thrown");
      } catch (error) {
        assertEquals(error instanceof VeryfrontAPIError, true);
        assertEquals(callCount, 2); // Initial attempt + 1 retry
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("file operations", () => {
    it("should handle pagination in listAllFiles", async () => {
      const originalFetch = globalThis.fetch;
      let page = 0;

      globalThis.fetch = (url) => {
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

        // Match branch files endpoint
        if (urlStr.includes("/branches/") && urlStr.includes("/files")) {
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
          } else {
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
      };

      try {
        await client.initialize();
        const files = await client.listAllFiles();

        assertEquals(files.length, 3);
        assertEquals(files[0]?.path, "file1.ts");
        assertEquals(files[1]?.path, "file2.ts");
        assertEquals(files[2]?.path, "file3.ts");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should get file content as text", async () => {
      const originalFetch = globalThis.fetch;

      globalThis.fetch = (url) => {
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

        // Match branch file content endpoint
        if (urlStr.includes("/branches/") && urlStr.includes("/files/")) {
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

        // Match branch files list endpoint
        if (urlStr.includes("/branches/") && urlStr.includes("/files")) {
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
      };

      try {
        await client.initialize();
        const content = await client.getFileContent("test.ts");

        assertEquals(content, 'console.log("Hello")');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
