import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "#veryfront/types";
import { z } from "zod";
import { listRuntimeWorkflows, RuntimeWorkflowListResponseSchema } from "./control-plane.ts";

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

describe("workflow/control-plane", () => {
  describe("listRuntimeWorkflows", () => {
    it("returns canonical runtime workflows sorted by name", async () => {
      let discoveryCalls = 0;

      const response = await listRuntimeWorkflows(createHandlerContext(), {
        discoverWorkflows: async () => {
          discoveryCalls += 1;
          return {
            workflows: [
              {
                id: "sync-b",
                filePath: "app/workflows/sync-b.ts",
                exportName: "default",
                definition: {
                  id: "sync-b",
                  description: "Second sync workflow",
                  version: "2",
                  steps: [],
                },
              },
              {
                id: "sync-a",
                filePath: "app/workflows/sync-a.ts",
                exportName: "default",
                definition: {
                  id: "sync-a",
                  description: "Primary sync workflow",
                  inputSchema: z.object({ dryRun: z.boolean().optional() }),
                  outputSchema: z.object({ ok: z.boolean() }),
                  steps: [],
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
        RuntimeWorkflowListResponseSchema.parse({
          workflows: [
            {
              id: "sync-a",
              name: "sync-a",
              description: "Primary sync workflow",
              target: "workflow:sync-a",
              sourcePath: "app/workflows/sync-a.ts",
              version: null,
              inputSchema: {
                properties: {
                  dryRun: {
                    type: "boolean",
                  },
                },
                type: "object",
              },
              outputSchema: {
                properties: {
                  ok: {
                    type: "boolean",
                  },
                },
                required: ["ok"],
                type: "object",
              },
              schedulable: true,
            },
            {
              id: "sync-b",
              name: "sync-b",
              description: "Second sync workflow",
              target: "workflow:sync-b",
              sourcePath: "app/workflows/sync-b.ts",
              version: "2",
              inputSchema: null,
              outputSchema: null,
              schedulable: true,
            },
          ],
        }),
      );
    });
  });
});
