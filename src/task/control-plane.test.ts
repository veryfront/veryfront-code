import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "#veryfront/types";
import { listRuntimeTasks, RuntimeTaskListResponseSchema } from "./control-plane.ts";

function createHandlerContext(): HandlerContext {
  return {
    projectDir: "/project",
    adapter: {
      env: { get: () => undefined },
      fs: {},
    },
    securityConfig: null,
    cspUserHeader: null,
    projectSlug: "demo-project",
    projectId: "proj-1",
    isLocalProject: false,
  } as unknown as HandlerContext;
}

describe("task/control-plane", () => {
  describe("listRuntimeTasks", () => {
    it("returns canonical runtime tasks sorted by name", async () => {
      let discoveryCalls = 0;

      const response = await listRuntimeTasks(createHandlerContext(), {
        discoverTasks: async () => {
          discoveryCalls += 1;
          return {
            tasks: [
              {
                id: "sync-b",
                name: "Sync Beta",
                filePath: "tasks/sync-b.ts",
                exportName: "default",
                definition: {
                  name: "Sync Beta",
                  description: "Second sync task",
                  schedulable: false,
                  run: async () => undefined,
                },
              },
              {
                id: "sync-a",
                name: "Sync Alpha",
                filePath: "tasks/sync-a.ts",
                exportName: "default",
                definition: {
                  name: "Sync Alpha",
                  description: "Primary sync task",
                  inputSchema: { type: "object" },
                  outputSchema: { type: "object" },
                  run: async () => undefined,
                },
              },
            ],
            errors: [],
          };
        },
      });

      assertEquals(discoveryCalls, 1);
      assertEquals(
        response,
        RuntimeTaskListResponseSchema.parse({
          tasks: [
            {
              id: "sync-a",
              name: "Sync Alpha",
              description: "Primary sync task",
              target: "task:sync-a",
              sourcePath: "tasks/sync-a.ts",
              inputSchema: { type: "object" },
              outputSchema: { type: "object" },
              schedulable: true,
            },
            {
              id: "sync-b",
              name: "Sync Beta",
              description: "Second sync task",
              target: "task:sync-b",
              sourcePath: "tasks/sync-b.ts",
              inputSchema: null,
              outputSchema: null,
              schedulable: false,
            },
          ],
        }),
      );
    });
  });
});
